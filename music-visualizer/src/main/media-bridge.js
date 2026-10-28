'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { parseBridgeLine, buildCommand } = require('../shared/protocol.js');

const DEFAULT_SCRIPT = path.join(__dirname, 'media-bridge.ps1');
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const STABLE_RUN_MS = 15000;
const MAX_BUFFER_CHARS = 4 * 1024 * 1024;

/**
 * Supervises the long-lived PowerShell SMTC bridge.
 *
 * Events:
 *   'message' ({type, payload})  every valid line from the bridge
 *   'exit'    ({code, signal})   the child exited (a restart may follow)
 */
class MediaBridge extends EventEmitter {
  constructor({ scriptPath = DEFAULT_SCRIPT, spawnFn = spawn, log = console } = {}) {
    super();
    this.scriptPath = scriptPath;
    this.spawnFn = spawnFn;
    this.log = log;
    this.child = null;
    this.stopped = true;
    this.backoffMs = MIN_BACKOFF_MS;
    this.restartTimer = null;
    this.buffer = '';
  }

  start() {
    if (process.platform !== 'win32') {
      this.log.warn('[media-bridge] SMTC is only available on Windows; media controls disabled.');
      return;
    }
    this.stopped = false;
    this.#spawnChild();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Sends a validated command. Returns false when invalid or the bridge is down.
   * @param {string} name
   * @param {unknown} [arg]
   */
  send(name, arg) {
    let line;
    try {
      line = buildCommand(name, arg);
    } catch (err) {
      this.log.warn(`[media-bridge] rejected command: ${err.message}`);
      return false;
    }
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed || !child.stdin.writable) return false;
    try {
      child.stdin.write(`${line}\n`);
      return true;
    } catch (err) {
      this.log.warn(`[media-bridge] write failed: ${err.message}`);
      return false;
    }
  }

  #spawnChild() {
    this.buffer = '';
    let child;
    try {
      child = this.spawnFn(
        'powershell.exe',
        // Process-scoped bypass: the default Windows policy (Restricted) would block the script.
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      this.log.error(`[media-bridge] spawn failed: ${err.message}`);
      this.#scheduleRestart();
      return;
    }
    this.child = child;
    const spawnedAt = Date.now();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) this.log.warn(`[media-bridge] stderr: ${text.slice(0, 500)}`);
    });
    child.stdin.on('error', () => {
      /* EPIPE when the child dies; handled by 'exit' */
    });
    child.on('error', (err) => {
      this.log.error(`[media-bridge] process error: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.emit('exit', { code, signal });
      if (!this.stopped) {
        // A child that ran for a while was healthy: start the backoff over.
        if (Date.now() - spawnedAt > STABLE_RUN_MS) this.backoffMs = MIN_BACKOFF_MS;
        this.log.warn(`[media-bridge] exited (code=${code}, signal=${signal}); restarting in ${this.backoffMs} ms`);
        this.#scheduleRestart();
      }
    });
  }

  #scheduleRestart() {
    if (this.stopped) return;
    clearTimeout(this.restartTimer);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped) this.#spawnChild();
    }, delay);
  }

  #onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.#onLine(line);
    }
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      this.log.warn('[media-bridge] dropping oversized partial line');
      this.buffer = '';
    }
  }

  #onLine(line) {
    const msg = parseBridgeLine(line);
    if (!msg) return;
    this.emit('message', msg);
  }
}

module.exports = { MediaBridge };
