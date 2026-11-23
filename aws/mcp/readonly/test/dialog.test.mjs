import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { hiddenDialog } from '../dialog.mjs';

// A stub execFile: records file and argv, answers (err, stdout) from `answer`.
function stub(answer) {
  const calls = [];
  const run = (file, args, cb) => (calls.push({ file, args }), answer(cb));
  return { calls, run };
}

test('runs osascript through execFile with a hidden-answer script holding the prompt label', async () => {
  const s = stub((cb) => cb(null, 'ignored\n'));
  await hiddenDialog('AWS username', { run: s.run });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].file, 'osascript');
  const script = s.calls[0].args[1];
  assert.equal(s.calls[0].args[0], '-e');
  assert.match(script, /with hidden answer/);
  assert.match(script, /"AWS username"/);
  assert.equal(s.calls[0].args.at(-1), 'text returned of result');
});

test('returns the trimmed answer', async () => {
  const s = stub((cb) => cb(null, '  AKIAFAKEFAKEFAKE0000\n'));
  assert.equal(await hiddenDialog('AWS username', { run: s.run }), 'AKIAFAKEFAKEFAKE0000');
});

test('the answer is never in argv', async () => {
  const s = stub((cb) => cb(null, 'FAKESECRETVALUE\n'));
  await hiddenDialog('AWS password', { run: s.run });
  assert.equal(JSON.stringify(s.calls).includes('FAKESECRETVALUE'), false);
});

test('Cancel (code -128) returns null', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('x'), { code: -128 }), ''));
  assert.equal(await hiddenDialog('AWS username', { run: s.run }), null);
});

test('Cancel as execFile delivers it (exit 1, no err.stderr, "User canceled. (-128)" as the 3rd argument) returns null', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed: osascript'), { code: 1 }), '', '0:61: execution error: User canceled. (-128)\n'));
  assert.equal(await hiddenDialog('AWS username', { run: s.run }), null);
});

test('Cancel is also read from err.message when no stderr argument arrives', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed: osascript\n0:61: execution error: User canceled. (-128)'), { code: 1 }), ''));
  assert.equal(await hiddenDialog('AWS username', { run: s.run }), null);
});

test('another failure names only the osascript error number, never stderr, message or stdout text', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed: leak-FAKESECRETVALUE'), { code: 1 }), 'FAKESECRETVALUE', 'boom FAKESECRETVALUE (-1743)'));
  await assert.rejects(hiddenDialog('AWS username', { run: s.run }), (e) => {
    assert.equal(e.message, 'Hidden-answer dialog failed (osascript error -1743)');
    assert.equal(e.message.includes('FAKESECRETVALUE'), false);
    return true;
  });
});

test('a failure with no error number throws the bare fixed message', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed: leak-FAKESECRETVALUE'), { code: 1 }), 'FAKESECRETVALUE', 'boom FAKESECRETVALUE'));
  await assert.rejects(hiddenDialog('AWS username', { run: s.run }), (e) => {
    assert.equal(e.message, 'Hidden-answer dialog failed');
    return true;
  });
});

test('real osascript Cancel (error number -128) through execFile returns null', { skip: process.platform !== 'darwin' }, async () => {
  const run = (file, args, cb) => execFile('osascript', ['-e', 'error number -128'], cb);
  assert.equal(await hiddenDialog('AWS username', { run }), null);
});

test('real osascript failure names the error number and not the error text', { skip: process.platform !== 'darwin' }, async () => {
  const run = (file, args, cb) => execFile('osascript', ['-e', 'error "LEAKTEXT" number -1743'], cb);
  await assert.rejects(hiddenDialog('AWS username', { run }), (e) => {
    assert.equal(e.message, 'Hidden-answer dialog failed (osascript error -1743)');
    return true;
  });
});

test('a missing osascript names the missing piece', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('spawn osascript ENOENT'), { code: 'ENOENT' }), ''));
  await assert.rejects(hiddenDialog('AWS username', { run: s.run }), /osascript.*not found/);
});

test('quotes and newlines in the prompt cannot break out of the script string', async () => {
  const s = stub((cb) => cb(null, 'x'));
  await hiddenDialog('a" & (do shell script "id") & "\nb', { run: s.run });
  const script = s.calls[0].args[1];
  assert.match(script, /^display dialog "a\\" & \(do shell script \\"id\\"\) & \\" b" default answer/);
});
