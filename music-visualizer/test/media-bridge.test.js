'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { MediaBridge } = require('../src/main/media-bridge.js');

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

test('spawns PowerShell with a process-scoped execution policy bypass', { skip: process.platform !== 'win32' }, () => {
  const calls = [];
  const bridge = new MediaBridge({
    scriptPath: 'bridge.ps1',
    spawnFn: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return fakeChild();
    },
    log: { warn() {}, error() {} },
  });

  bridge.start();
  bridge.stop();

  assert.equal(calls.length, 1);
  const { cmd, args } = calls[0];
  assert.equal(cmd, 'powershell.exe');
  const policyIndex = args.indexOf('-ExecutionPolicy');
  assert.notEqual(policyIndex, -1, 'expected -ExecutionPolicy argument');
  assert.equal(args[policyIndex + 1], 'Bypass');
  // PowerShell treats everything after -File as script arguments.
  assert.ok(policyIndex < args.indexOf('-File'), '-ExecutionPolicy must precede -File');
  assert.equal(args[args.indexOf('-File') + 1], 'bridge.ps1');
});
