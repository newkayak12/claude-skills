import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenDialog } from '../dialog.mjs';

// A stub execFile: records file and argv, answers (err, stdout) from `answer`.
function stub(answer) {
  const calls = [];
  const run = (file, args, cb) => (calls.push({ file, args }), answer(cb));
  return { calls, run };
}

test('runs osascript through execFile with a hidden-answer script holding the prompt label', async () => {
  const s = stub((cb) => cb(null, 'ignored\n'));
  await hiddenDialog('Access Key ID', { run: s.run });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].file, 'osascript');
  const script = s.calls[0].args[1];
  assert.equal(s.calls[0].args[0], '-e');
  assert.match(script, /with hidden answer/);
  assert.match(script, /"Access Key ID"/);
  assert.equal(s.calls[0].args.at(-1), 'text returned of result');
});

test('returns the trimmed answer', async () => {
  const s = stub((cb) => cb(null, '  AKIAFAKEFAKEFAKE0000\n'));
  assert.equal(await hiddenDialog('Access Key ID', { run: s.run }), 'AKIAFAKEFAKEFAKE0000');
});

test('the answer is never in argv', async () => {
  const s = stub((cb) => cb(null, 'FAKESECRETVALUE\n'));
  await hiddenDialog('Secret Access Key', { run: s.run });
  assert.equal(JSON.stringify(s.calls).includes('FAKESECRETVALUE'), false);
});

test('Cancel (code -128) returns null', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('x'), { code: -128 }), ''));
  assert.equal(await hiddenDialog('Access Key ID', { run: s.run }), null);
});

test('Cancel as osascript reports it (exit 1, "User canceled. (-128)" on stderr) returns null', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed'), { code: 1, stderr: '0:61: execution error: User canceled. (-128)\n' }), ''));
  assert.equal(await hiddenDialog('Access Key ID', { run: s.run }), null);
});

test('another failure throws a fixed message without the answer or stderr text', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('Command failed: leak-FAKESECRETVALUE'), { code: 1, stderr: 'boom FAKESECRETVALUE' }), 'FAKESECRETVALUE'));
  await assert.rejects(hiddenDialog('Access Key ID', { run: s.run }), (e) => {
    assert.equal(e.message, 'Hidden-answer dialog failed');
    assert.equal(e.message.includes('FAKESECRETVALUE'), false);
    return true;
  });
});

test('a missing osascript names the missing piece', async () => {
  const s = stub((cb) => cb(Object.assign(new Error('spawn osascript ENOENT'), { code: 'ENOENT' }), ''));
  await assert.rejects(hiddenDialog('Access Key ID', { run: s.run }), /osascript.*not found/);
});

test('quotes and newlines in the prompt cannot break out of the script string', async () => {
  const s = stub((cb) => cb(null, 'x'));
  await hiddenDialog('a" & (do shell script "id") & "\nb', { run: s.run });
  const script = s.calls[0].args[1];
  assert.match(script, /^display dialog "a\\" & \(do shell script \\"id\\"\) & \\" b" default answer/);
});
