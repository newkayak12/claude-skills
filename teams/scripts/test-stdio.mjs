#!/usr/bin/env node
// stdio.mjs: the one JSON-RPC loop. Every case runs against a real spawned server with a fake
// tool table, over stdio, so the replies are the bytes a client would read.
//
//   node --test teams/scripts/test-stdio.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STDIO = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'stdio.mjs')).href;

// The fake server. Tools: echo, boom (throws), slow (waits for its signal), child (registers a
// real child process), quiet (ignores cancel), labelled (sets its own progress message).
const FAKE = `
import { spawn } from 'node:child_process';
import { serve } from ${JSON.stringify(STDIO)};
const tools = [{ name: 'echo' }, { name: 'boom' }, { name: 'slow' }, { name: 'child' }, { name: 'quiet' }, { name: 'labelled' }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
serve({
  serverInfo: { name: 'fake', version: '9.9.9' },
  protocolVersion: '2025-06-18',
  tools,
  call: async (name, args, ctx) => {
    switch (name) {
      case 'echo': return { echoed: args || null, hasSignal: ctx.signal instanceof AbortSignal };
      case 'boom': throw new Error('kaboom');
      case 'slow':
        await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
        return { aborted: ctx.signal.aborted };
      case 'child': {
        const child = spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
        ctx.registerChild(child);
        const signal = await new Promise((resolve) => child.on('exit', (code, sig) => resolve(sig)));
        return { signal };
      }
      case 'quiet': await sleep(400); return { done: true };
      case 'labelled': ctx.progress((s) => 'custom ' + s + 's'); await sleep(200); return { ok: true };
      default: throw new Error('unknown tool: ' + name);
    }
  },
});
`;

class Client {
  constructor() {
    this.proc = spawn('node', ['--input-type=module', '-e', FAKE], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = '';
    this.lines = [];
    this.waiters = [];
    this.nextId = 1;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        this.lines.push(line);
        this.waiters = this.waiters.filter((w) => !w());
      }
    });
  }

  send(obj) { this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  raw(text) { this.proc.stdin.write(text + '\n'); }

  // Resolves with the parsed message for which `pick` is truthy; searches lines already read.
  waitFor(pick, ms = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout; saw ' + JSON.stringify(this.lines))), ms);
      const look = () => {
        for (const line of this.lines) {
          const m = JSON.parse(line);
          if (pick(m)) { clearTimeout(timer); resolve(m); return true; }
        }
        return false;
      };
      if (!look()) this.waiters.push(look);
    });
  }

  request(method, params, id = this.nextId++) {
    this.send({ jsonrpc: '2.0', id, method, params });
    return this.waitFor((m) => m.id === id);
  }

  callTool(name, args, meta, id = this.nextId++) {
    const params = { name, arguments: args, ...(meta ? { _meta: meta } : {}) };
    return { id, reply: this.request('tools/call', params, id) };
  }

  notifications(method) { return this.lines.map((l) => JSON.parse(l)).filter((m) => m.method === method); }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

async function withClient(fn) {
  const c = new Client();
  try { return await fn(c); } finally { c.close(); }
}

test('initialize answers with the given serverInfo, the default protocol and tools-only capabilities', async () => {
  await withClient(async (c) => {
    const r = await c.request('initialize', {});
    assert.deepEqual(r, {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fake', version: '9.9.9' },
      },
    });
  });
});

test('initialize echoes a string protocolVersion the client sent', async () => {
  await withClient(async (c) => {
    const r = await c.request('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(r.result.protocolVersion, '2024-11-05');
  });
});

test('tools/list returns the tool table as given', async () => {
  await withClient(async (c) => {
    const r = await c.request('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name), ['echo', 'boom', 'slow', 'child', 'quiet', 'labelled']);
  });
});

test('ping replies with an empty result', async () => {
  await withClient(async (c) => {
    assert.deepEqual(await c.request('ping'), { jsonrpc: '2.0', id: 1, result: {} });
  });
});

test('an unknown method with an id is -32601; without an id it is silently dropped', async () => {
  await withClient(async (c) => {
    c.send({ jsonrpc: '2.0', method: 'resources/list' }); // notification: no reply
    const r = await c.request('resources/list', {});
    assert.deepEqual(r, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found: resources/list' } });
    assert.equal(c.lines.length, 1, 'the id-less unknown method produced no line');
  });
});

test('a malformed line and a blank line are ignored; the next message is answered', async () => {
  await withClient(async (c) => {
    c.raw('{not json');
    c.raw('');
    c.raw('   ');
    const r = await c.request('ping');
    assert.deepEqual(r, { jsonrpc: '2.0', id: 1, result: {} });
    assert.equal(c.lines.length, 1);
  });
});

test('tools/call wraps the result as text content, structuredContent and isError:false', async () => {
  await withClient(async (c) => {
    const { reply } = c.callTool('echo', { a: 1 });
    const r = await reply;
    const out = { echoed: { a: 1 }, hasSignal: true };
    assert.deepEqual(r.result, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
  });
});

test('a tool that throws is an isError result carrying the message, not a protocol error', async () => {
  await withClient(async (c) => {
    const { reply } = c.callTool('boom', {});
    const r = await reply;
    assert.equal(r.error, undefined);
    assert.deepEqual(r.result, { content: [{ type: 'text', text: 'kaboom' }], isError: true });
  });
});

test('an unknown tool name reaches call() and comes back as an isError result', async () => {
  await withClient(async (c) => {
    const r = await c.callTool('nope', {}).reply;
    assert.equal(r.result.isError, true);
    assert.equal(r.result.content[0].text, 'unknown tool: nope');
  });
});

test('a handler that throws outside the tool call is -32603 with the message', async () => {
  await withClient(async (c) => {
    // `${name}` on an object whose toString is not callable throws before call() runs.
    const r = await c.request('tools/call', { name: { toString: 1 }, arguments: {} });
    assert.equal(r.error.code, -32603);
    assert.equal(typeof r.error.message, 'string');
    assert.equal(r.id, 1);
    // The server is still alive.
    assert.deepEqual(await c.request('ping'), { jsonrpc: '2.0', id: 2, result: {} });
  });
});

test('a non-object line does not take the server down', async () => {
  await withClient(async (c) => {
    c.raw('null');
    assert.deepEqual(await c.request('ping'), { jsonrpc: '2.0', id: 1, result: {} });
  });
});

test('a progressToken produces progress notifications carrying that token, starting immediately', async () => {
  await withClient(async (c) => {
    const { reply } = c.callTool('quiet', { node_id: 'plan' }, { progressToken: 'tok' });
    const first = await c.waitFor((m) => m.method === 'notifications/progress');
    assert.equal(first.params.progressToken, 'tok');
    assert.equal(first.params.progress, 1);
    assert.match(first.params.message, /^quiet plan — \d+s$/);
    assert.equal(first.id, undefined);
    await reply;
    for (const n of c.notifications('notifications/progress')) assert.equal(n.params.progressToken, 'tok');
  });
});

test('a numeric progressToken (0) is honoured', async () => {
  await withClient(async (c) => {
    const { reply } = c.callTool('echo', {}, { progressToken: 0 });
    await reply;
    assert.equal(c.notifications('notifications/progress')[0].params.progressToken, 0);
  });
});

test('no progressToken, no progress notifications', async () => {
  await withClient(async (c) => {
    await c.callTool('echo', {}).reply;
    assert.equal(c.notifications('notifications/progress').length, 0);
  });
});

test('ctx.progress(fn) is accepted; the first notification still goes out before the tool runs, with the default label', async () => {
  // The next tick is 10 s away, so a custom message is not observable here without a slow test;
  // this pins that setting one neither fails the call nor changes the immediate notification.
  await withClient(async (c) => {
    const { reply } = c.callTool('labelled', {}, { progressToken: 't2' });
    const r = await reply;
    assert.equal(r.result.isError, false);
    const msgs = c.notifications('notifications/progress').map((n) => n.params.message);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /^labelled — \d+s$/);
  });
});

test('dispatch is concurrent: ping is answered while a call is still in flight', async () => {
  await withClient(async (c) => {
    const slow = c.callTool('slow', {});
    const pong = await c.request('ping', {}, 'p1');
    assert.deepEqual(pong, { jsonrpc: '2.0', id: 'p1', result: {} });
    assert.equal(c.lines.map((l) => JSON.parse(l)).some((m) => m.id === slow.id), false, 'slow is still running');
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: slow.id } });
    await slow.reply;
  });
});

test('notifications/cancelled aborts the call\'s AbortSignal; the reply still arrives', async () => {
  await withClient(async (c) => {
    const slow = c.callTool('slow', {});
    await c.request('ping', {}, 'sync'); // the call is registered before this answers
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: slow.id, reason: 'test' } });
    const r = await slow.reply;
    assert.deepEqual(r.result.structuredContent, { aborted: true });
    assert.equal(r.result.isError, false);
  });
});

test('notifications/cancelled kills a registered child', async () => {
  await withClient(async (c) => {
    const job = c.callTool('child', {});
    await c.request('ping', {}, 'sync');
    await new Promise((r) => setTimeout(r, 300)); // let the child spawn and register
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: job.id } });
    const r = await job.reply;
    assert.deepEqual(r.result.structuredContent, { signal: 'SIGTERM' });
  });
});

test('cancel of a call that ignores its signal and has no child is a no-op; its reply still arrives', async () => {
  await withClient(async (c) => {
    const q = c.callTool('quiet', {});
    await c.request('ping', {}, 'sync');
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: q.id } });
    const r = await q.reply;
    assert.deepEqual(r.result.structuredContent, { done: true });
    assert.equal(r.result.isError, false);
  });
});

test('cancel of an unknown or finished requestId is a no-op and produces no line', async () => {
  await withClient(async (c) => {
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 999 } });
    await c.callTool('echo', {}, undefined, 5).reply;
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } });
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled' }); // no params at all
    assert.deepEqual(await c.request('ping'), { jsonrpc: '2.0', id: 1, result: {} });
    assert.equal(c.lines.length, 2, 'only the echo reply and the ping reply');
  });
});

test('cancelling one call leaves a concurrent call alone', async () => {
  await withClient(async (c) => {
    const a = c.callTool('slow', {});
    const b = c.callTool('quiet', {});
    await c.request('ping', {}, 'sync');
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: a.id } });
    assert.deepEqual((await a.reply).result.structuredContent, { aborted: true });
    assert.deepEqual((await b.reply).result.structuredContent, { done: true });
  });
});

test('on stdin end an in-flight call replies before the process exits 0', async () => {
  const c = new Client();
  const code = new Promise((resolve) => c.proc.on('exit', resolve));
  const call = c.callTool('quiet', {});
  await c.request('ping', {}, 'sync');
  c.proc.stdin.end();
  assert.deepEqual((await call.reply).result.structuredContent, { done: true });
  assert.equal(await code, 0);
});

test('the process exits 0 when stdin ends', async () => {
  const c = new Client();
  const code = new Promise((resolve) => c.proc.on('exit', resolve));
  c.proc.stdin.end();
  assert.equal(await code, 0);
});
