'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMANDS,
  parseBridgeLine,
  buildCommand,
  isValidCommand,
} = require('../src/shared/protocol.js');

test('COMMANDS lists every supported command', () => {
  assert.deepEqual([...COMMANDS].sort(), ['next', 'pause', 'play', 'prev', 'seek', 'toggle']);
});

test('parseBridgeLine returns null for empty, blank or non-string input', () => {
  assert.equal(parseBridgeLine(''), null);
  assert.equal(parseBridgeLine('   '), null);
  assert.equal(parseBridgeLine(null), null);
  assert.equal(parseBridgeLine(undefined), null);
  assert.equal(parseBridgeLine(42), null);
});

test('parseBridgeLine returns null for malformed JSON', () => {
  assert.equal(parseBridgeLine('{not json'), null);
  assert.equal(parseBridgeLine('WARNING: something from powershell'), null);
});

test('parseBridgeLine returns null for non-object JSON and unknown types', () => {
  assert.equal(parseBridgeLine('[]'), null);
  assert.equal(parseBridgeLine('"state"'), null);
  assert.equal(parseBridgeLine('{"payload":{}}'), null);
  assert.equal(parseBridgeLine('{"type":"bogus","payload":{}}'), null);
});

test('parseBridgeLine parses ready messages', () => {
  assert.deepEqual(parseBridgeLine('{"type":"ready"}'), { type: 'ready', payload: null });
});

test('parseBridgeLine tolerates a BOM and surrounding whitespace / CR', () => {
  assert.deepEqual(parseBridgeLine('﻿{"type":"ready"}\r'), { type: 'ready', payload: null });
});

test('parseBridgeLine normalizes a full state payload', () => {
  const line = JSON.stringify({
    type: 'state',
    payload: {
      hasSession: true,
      app: 'Spotify.exe',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      status: 'Playing',
      position: 12.5,
      duration: 200,
    },
  });
  assert.deepEqual(parseBridgeLine(line), {
    type: 'state',
    payload: {
      hasSession: true,
      app: 'Spotify.exe',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      status: 'playing',
      position: 12.5,
      duration: 200,
    },
  });
});

test('parseBridgeLine fills defaults for missing or invalid state fields', () => {
  const line = JSON.stringify({
    type: 'state',
    payload: { hasSession: 'yes', title: 5, position: -3, duration: 'abc', status: null },
  });
  assert.deepEqual(parseBridgeLine(line).payload, {
    hasSession: false,
    app: '',
    title: '',
    artist: '',
    album: '',
    status: 'unknown',
    position: 0,
    duration: 0,
  });
});

test('parseBridgeLine accepts a state message without payload as empty state', () => {
  const msg = parseBridgeLine('{"type":"state"}');
  assert.equal(msg.type, 'state');
  assert.equal(msg.payload.hasSession, false);
});

test('parseBridgeLine parses art messages with data', () => {
  const msg = parseBridgeLine('{"type":"art","payload":{"mime":"image/png","data":"iVBORw0KGgo="}}');
  assert.deepEqual(msg, { type: 'art', payload: { mime: 'image/png', data: 'iVBORw0KGgo=' } });
});

test('parseBridgeLine normalizes art with null or invalid data to null', () => {
  assert.deepEqual(parseBridgeLine('{"type":"art","payload":{"mime":"image/png","data":null}}').payload, {
    mime: 'image/png',
    data: null,
  });
  assert.deepEqual(parseBridgeLine('{"type":"art","payload":{"data":"not base64!!"}}').payload, {
    mime: 'image/png',
    data: null,
  });
});

test('parseBridgeLine rejects non-image mime types in art', () => {
  const msg = parseBridgeLine('{"type":"art","payload":{"mime":"text/html","data":"AAAA"}}');
  assert.equal(msg.payload.mime, 'image/png');
});

test('parseBridgeLine parses error messages', () => {
  assert.deepEqual(parseBridgeLine('{"type":"error","payload":{"message":"boom"}}'), {
    type: 'error',
    payload: { message: 'boom' },
  });
  assert.deepEqual(parseBridgeLine('{"type":"error"}').payload, { message: 'Unknown error' });
});

test('buildCommand builds simple commands', () => {
  for (const name of ['toggle', 'play', 'pause', 'next', 'prev']) {
    assert.equal(buildCommand(name), name);
  }
});

test('buildCommand builds seek with a numeric argument', () => {
  assert.equal(buildCommand('seek', 12.5), 'seek 12.5');
  assert.equal(buildCommand('seek', 0), 'seek 0');
  assert.equal(buildCommand('seek', 10.123456), 'seek 10.123');
});

test('buildCommand throws on unknown commands', () => {
  assert.throws(() => buildCommand('rm -rf'), TypeError);
  assert.throws(() => buildCommand(''), TypeError);
  assert.throws(() => buildCommand(undefined), TypeError);
});

test('buildCommand throws on invalid seek arguments', () => {
  assert.throws(() => buildCommand('seek'), TypeError);
  assert.throws(() => buildCommand('seek', -1), TypeError);
  assert.throws(() => buildCommand('seek', NaN), TypeError);
  assert.throws(() => buildCommand('seek', Infinity), TypeError);
  assert.throws(() => buildCommand('seek', '12'), TypeError);
});

test('isValidCommand mirrors buildCommand validation', () => {
  assert.equal(isValidCommand('toggle'), true);
  assert.equal(isValidCommand('seek', 3), true);
  assert.equal(isValidCommand('seek', -3), false);
  assert.equal(isValidCommand('nope'), false);
});
