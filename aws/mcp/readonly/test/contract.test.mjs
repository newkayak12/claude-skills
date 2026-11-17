import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_ONLY, ok, err, header, defineTool } from '../contract.mjs';

test('READ_ONLY is the four annotation hints', () => {
  assert.deepEqual(READ_ONLY, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
});

test('ok returns text content with no isError', () => {
  assert.deepEqual(ok('hi'), { content: [{ type: 'text', text: 'hi' }] });
  assert.equal('isError' in ok('hi'), false);
});

test('err returns the same shape with isError true', () => {
  assert.deepEqual(err('bad'), { content: [{ type: 'text', text: 'bad' }], isError: true });
});

test('header builds the first answer line', () => {
  assert.equal(header({ profile: 'dev', account: '123456789012', region: 'us-east-1' }), 'profile dev · account 123456789012 · region us-east-1');
});

test('header shows a dash for a missing part', () => {
  assert.equal(header({ profile: null }), 'profile - · account - · region -');
});

test('defineTool returns a valid definition and keeps annotations optional', () => {
  const handler = async () => ok('x');
  const def = { name: 't', description: 'd', inputSchema: { type: 'object', properties: {} }, handler };
  assert.equal(defineTool(def), def);
  const withAnn = { ...def, annotations: READ_ONLY };
  assert.equal(defineTool(withAnn).annotations, READ_ONLY);
});

test('defineTool rejects a definition missing a part', () => {
  const good = { name: 't', description: 'd', inputSchema: { type: 'object' }, handler: () => {} };
  for (const k of ['name', 'description', 'inputSchema', 'handler']) {
    const bad = { ...good };
    delete bad[k];
    assert.throws(() => defineTool(bad), new RegExp(k), k);
  }
  assert.throws(() => defineTool({ ...good, annotations: 'x' }), /annotations/);
});
