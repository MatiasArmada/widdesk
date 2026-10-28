# media-bridge.ps1
# Long-lived bridge between the widget and Windows System Media Transport Controls (SMTC).
#
# Output (stdout): one compact JSON object per line:
#   {"type":"ready"}
#   {"type":"state","payload":{...}}
#   {"type":"art","payload":{"mime":"image/png","data":"<base64>|null"}}
#   {"type":"error","payload":{"message":"..."}}
# Input (stdin): one command per line: toggle | play | pause | next | prev | seek <seconds>
# The script exits when stdin is closed (the parent process went away).

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$stdout = [Console]::Out

function Write-Message([string]$type, $payload) {
    $msg = [ordered]@{ type = $type }
    if ($null -ne $payload) { $msg.payload = $payload }
    $json = ConvertTo-Json -InputObject $msg -Compress -Depth 4
    $stdout.WriteLine($json)
    $stdout.Flush()
}

$script:lastErrorText = ''
$script:lastErrorAt = [DateTime]::MinValue
function Write-BridgeError([string]$message) {
    # Avoid flooding the app with the same error every poll.
    $now = [DateTime]::UtcNow
    if ($message -eq $script:lastErrorText -and ($now - $script:lastErrorAt).TotalSeconds -lt 10) { return }
    $script:lastErrorText = $message
    $script:lastErrorAt = $now
    Write-Message 'error' ([ordered]@{ message = $message })
}

# --- Media key fallback (used when no SMTC session exists) ----------------------
Add-Type -Namespace WidgetBridge -Name Keys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@

function Send-MediaKey([byte]$vk) {
    [WidgetBridge.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    [WidgetBridge.Keys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
}
$VK_MEDIA_NEXT = 0xB0
$VK_MEDIA_PREV = 0xB1
$VK_MEDIA_PLAY_PAUSE = 0xB3

# --- WinRT interop ---------------------------------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

function Await($op, [Type]$type, [int]$timeoutMs = 5000) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait($timeoutMs)) { throw "WinRT operation timed out after $timeoutMs ms" }
    $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$SessionManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$MediaPropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$StreamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
# PowerShell sees WinRT streams as System.__ComObject, so normal overload resolution
# for AsStreamForRead fails; invoking via reflection performs the interface cast at runtime.
$AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

try {
    $mgr = Await ($SessionManagerType::RequestAsync()) $SessionManagerType 10000
}
catch {
    Write-BridgeError ("Could not access media session manager: " + $_.Exception.Message)
    $mgr = $null
}

$MAX_ART_BYTES = 512KB

function Get-CurrentSession {
    if ($null -eq $mgr) { return $null }
    try { return $mgr.GetCurrentSession() } catch { return $null }
}

function Read-Thumbnail($thumbRef) {
    # Returns @{ mime; data } where data is base64 or $null.
    $result = [ordered]@{ mime = 'image/png'; data = $null }
    if ($null -eq $thumbRef) { return $result }
    $stream = $null
    $netStream = $null
    $memory = $null
    try {
        $stream = Await ($thumbRef.OpenReadAsync()) $StreamType 5000
        if ($null -eq $stream) { return $result }
        # Size/ContentType are not reachable on the __ComObject wrapper (StrictMode throws),
        # so the byte cap is enforced after copying; Chromium sniffs the real image format.
        $netStream = $AsStreamForRead.Invoke($null, @($stream))
        $memory = New-Object System.IO.MemoryStream
        $netStream.CopyTo($memory)
        if ($memory.Length -gt 0 -and $memory.Length -le $MAX_ART_BYTES) {
            $result.data = [Convert]::ToBase64String($memory.ToArray())
        }
    }
    catch {
        $result.data = $null
        Write-BridgeError ("Could not read album art: " + $_.Exception.Message)
    }
    finally {
        if ($null -ne $memory) { $memory.Dispose() }
        if ($null -ne $netStream) { $netStream.Dispose() }
        if ($null -ne $stream) { try { $stream.Dispose() } catch { } }
    }
    return $result
}

function Get-StatusName($session) {
    try {
        $status = [string]$session.GetPlaybackInfo().PlaybackStatus
        if ([string]::IsNullOrEmpty($status)) { return 'unknown' }
        return $status.ToLowerInvariant()
    }
    catch { return 'unknown' }
}

function Get-MediaSnapshot {
    $session = Get-CurrentSession
    if ($null -eq $session) {
        return [ordered]@{
            hasSession = $false; app = ''; title = ''; artist = ''; album = ''
            status = 'stopped'; position = 0; duration = 0; thumb = $null
        }
    }

    $props = $null
    try { $props = Await ($session.TryGetMediaPropertiesAsync()) $MediaPropsType 3000 } catch { $props = $null }
    $status = Get-StatusName $session

    $position = 0.0
    $duration = 0.0
    try {
        $tl = $session.GetTimelineProperties()
        $duration = ($tl.EndTime - $tl.StartTime).TotalSeconds
        $position = ($tl.Position - $tl.StartTime).TotalSeconds
        # Apps update the timeline sparsely; extrapolate while playing.
        if ($status -eq 'playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
            $elapsed = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
            if ($elapsed -gt 0 -and $elapsed -lt 86400) { $position += $elapsed }
        }
        if ($duration -lt 0) { $duration = 0 }
        if ($position -lt 0) { $position = 0 }
        if ($duration -gt 0 -and $position -gt $duration) { $position = $duration }
    }
    catch { }

    $title = ''; $artist = ''; $album = ''; $thumb = $null
    if ($null -ne $props) {
        $title = [string]$props.Title
        $artist = [string]$props.Artist
        $album = [string]$props.AlbumTitle
        if ([string]::IsNullOrEmpty($artist)) { $artist = [string]$props.AlbumArtist }
        $thumb = $props.Thumbnail
    }

    $app = ''
    try { $app = [string]$session.SourceAppUserModelId } catch { }

    return [ordered]@{
        hasSession = $true; app = $app; title = $title; artist = $artist; album = $album
        status = $status; position = [Math]::Round($position, 2); duration = [Math]::Round($duration, 2)
        thumb = $thumb
    }
}

function Invoke-BridgeCommand([string]$line) {
    $parts = $line.Trim() -split '\s+', 2
    $name = $parts[0].ToLowerInvariant()
    if ([string]::IsNullOrEmpty($name)) { return }

    $session = Get-CurrentSession
    if ($null -eq $session) {
        switch ($name) {
            'toggle' { Send-MediaKey $VK_MEDIA_PLAY_PAUSE }
            'play' { Send-MediaKey $VK_MEDIA_PLAY_PAUSE }
            'pause' { Send-MediaKey $VK_MEDIA_PLAY_PAUSE }
            'next' { Send-MediaKey $VK_MEDIA_NEXT }
            'prev' { Send-MediaKey $VK_MEDIA_PREV }
            'seek' { Write-BridgeError 'Cannot seek: no active media session' }
            default { Write-BridgeError "Unknown command: $name" }
        }
        return
    }

    $op = $null
    switch ($name) {
        'toggle' { $op = $session.TryTogglePlayPauseAsync() }
        'play' { $op = $session.TryPlayAsync() }
        'pause' { $op = $session.TryPauseAsync() }
        'next' { $op = $session.TrySkipNextAsync() }
        'prev' { $op = $session.TrySkipPreviousAsync() }
        'seek' {
            $seconds = 0.0
            $ok = ($parts.Count -eq 2) -and [double]::TryParse($parts[1],
                [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$seconds)
            if (-not $ok -or $seconds -lt 0 -or [double]::IsInfinity($seconds)) {
                Write-BridgeError "Invalid seek argument: $line"
                return
            }
            $start = [TimeSpan]::Zero
            try { $start = $session.GetTimelineProperties().StartTime } catch { }
            $ticks = [long]($seconds * 1e7) + $start.Ticks
            $op = $session.TryChangePlaybackPositionAsync($ticks)
        }
        default { Write-BridgeError "Unknown command: $name"; return }
    }

    $accepted = Await $op ([bool]) 5000
    if (-not $accepted) { Write-BridgeError "The media app rejected '$name'" }
}

# --- Main loop -------------------------------------------------------------------
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$pending = $stdin.ReadLineAsync()

$lastKey = $null
$lastEmitAt = [DateTime]::MinValue
$lastPos = 0.0
$lastStatus = ''
$artKey = $null
$artAttempts = 0
$lastArtData = $null
# Polls (~400 ms each) to keep re-reading art after a track change: apps often expose the
# previous track's thumbnail for a while, so the first non-empty read is not trustworthy.
$ART_WATCH_POLLS = 15
$forceEmit = $false

Write-Message 'ready' $null

while ($true) {
    # 1) Commands (non-blocking wait doubles as the poll interval).
    try {
        if ($pending.Wait(400)) {
            $line = $pending.Result
            if ($null -eq $line) { exit 0 }
            try { Invoke-BridgeCommand $line } catch { Write-BridgeError ("Command failed: " + $_.Exception.Message) }
            $forceEmit = $true
            $pending = $stdin.ReadLineAsync()
        }
    }
    catch {
        # stdin is broken: the parent is gone.
        exit 0
    }

    # 2) State polling.
    try {
        $snap = Get-MediaSnapshot
        $key = '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f $snap.hasSession, $snap.app, $snap.title, $snap.artist, $snap.album, $snap.status, $snap.duration
        $now = [DateTime]::UtcNow
        $sinceEmit = ($now - $lastEmitAt).TotalSeconds

        $expectedPos = $lastPos
        if ($lastStatus -eq 'playing') { $expectedPos += $sinceEmit }
        $drift = [Math]::Abs($snap.position - $expectedPos)

        $changed = ($key -ne $lastKey)
        $jumped = ($drift -gt 1.5) -and ($sinceEmit -ge 1)
        $heartbeat = ($sinceEmit -ge 5) -and $snap.hasSession

        if ($changed -or $jumped -or $heartbeat -or ($forceEmit -and $sinceEmit -ge 0.3)) {
            $payload = [ordered]@{
                hasSession = $snap.hasSession; app = $snap.app; title = $snap.title; artist = $snap.artist
                album = $snap.album; status = $snap.status; position = $snap.position; duration = $snap.duration
            }
            Write-Message 'state' $payload
            $lastKey = $key
            $lastEmitAt = $now
            $lastPos = $snap.position
            $lastStatus = $snap.status
            $forceEmit = $false
        }

        # 3) Album art: after a track change, keep re-reading for a while and emit whenever the
        #    bytes change, because apps publish the new thumbnail late (stale art first).
        $trackKey = '{0}|{1}|{2}' -f $snap.app, $snap.title, $snap.artist
        if ($trackKey -ne $artKey) {
            $artKey = $trackKey
            $artAttempts = 0
            if (-not $snap.hasSession) {
                $lastArtData = $null
                Write-Message 'art' ([ordered]@{ mime = 'image/png'; data = $null })
            }
        }
        if ($snap.hasSession -and $artAttempts -lt $ART_WATCH_POLLS) {
            $art = Read-Thumbnail $snap.thumb
            $artAttempts++
            if ($null -ne $art.data -and $art.data -ne $lastArtData) {
                $lastArtData = $art.data
                Write-Message 'art' $art
            }
            elseif ($artAttempts -ge $ART_WATCH_POLLS -and $null -eq $art.data -and $null -ne $lastArtData) {
                # The track never got art: clear the previous track's cover.
                $lastArtData = $null
                Write-Message 'art' $art
            }
        }
    }
    catch {
        Write-BridgeError ("Polling failed: " + $_.Exception.Message)
    }
}
