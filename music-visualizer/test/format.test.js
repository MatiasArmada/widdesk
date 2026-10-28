'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTime, clamp, progressRatio, prettyAppName } = require('../src/shared/format.js');

test('formatTime formats under an hour as m:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(599.9), '9:59');
  assert.equal(formatTime(3599), '59:59');
});

test('formatTime formats an hour or more as h:mm:ss', () => {
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(36000 + 59), '10:00:59');
});

test('formatTime returns 0:00 for invalid input', () => {
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(Infinity), '0:00');
  assert.equal(formatTime(undefined), '0:00');
  assert.equal(formatTime('12'), '0:00');
});

test('clamp limits a value to a range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('clamp returns min for NaN', () => {
  assert.equal(clamp(NaN, 2, 10), 2);
});

test('progressRatio returns position/duration clamped to [0,1]', () => {
  assert.equal(progressRatio(50, 200), 0.25);
  assert.equal(progressRatio(250, 200), 1);
  assert.equal(progressRatio(-5, 200), 0);
});

test('progressRatio returns 0 when duration is zero or invalid', () => {
  assert.equal(progressRatio(10, 0), 0);
  assert.equal(progressRatio(10, -1), 0);
  assert.equal(progressRatio(10, NaN), 0);
  assert.equal(progressRatio(NaN, 100), 0);
});

test('prettyAppName maps well-known apps', () => {
  assert.equal(prettyAppName('Spotify.exe'), 'Spotify');
  assert.equal(prettyAppName('Chrome'), 'Chrome');
  assert.equal(prettyAppName('MSEdge'), 'Edge');
  assert.equal(prettyAppName('firefox.exe'), 'Firefox');
  assert.equal(prettyAppName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify');
});

test('prettyAppName derives a readable name from unknown ids', () => {
  assert.equal(prettyAppName('vlc.exe'), 'vlc');
  assert.equal(prettyAppName('Contoso.Player_abc123!App'), 'Contoso Player');
  assert.equal(prettyAppName('C:\\Apps\\foobar2000.exe'), 'foobar2000');
});

test('prettyAppName returns empty string for empty or invalid input', () => {
  assert.equal(prettyAppName(''), '');
  assert.equal(prettyAppName(null), '');
});
