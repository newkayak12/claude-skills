// stdio.mjs - the one newline-delimited JSON-RPC 2.0 loop every teams MCP server runs on.
// Extracted from broker.mjs (the only loop that handled notifications/cancelled and
// notifications/progress) and generalised: any tool table can be served on it.
//
//   serve({ serverInfo, protocolVersion, tools, call })
//
//   tools  the array tools/list returns.
//   call   async (name, args, ctx) => result. A throw becomes an isError result, never a
//          protocol error. ctx is { signal, progress(fn), registerChild(child) }:
//            signal             aborted when the client sends notifications/cancelled for this
//                               call; a call that does not watch it is unaffected.
//            progress(fn)       fn(elapsedSeconds) -> string replaces the message of the
//                               notifications/progress sent for this call (only when the client
//                               gave a progressToken; otherwise a no-op).
//            registerChild(c)   c.kill() runs on cancel. Whatever has a kill() works: a
//                               ChildProcess, or { kill: () => stop() }.
//
// Dispatch is concurrent: a long call never stops the server answering ping, status or a
// cancellation for that very call. Importing this module binds nothing; only serve() does.

// One line out per message, never interleaved.
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// notifications/progress, so a client can show a long call advancing instead of staring at one
// that returns nothing for ten minutes. Immediately, then on a tick: waiting for the first
// interval meant a client saw nothing for the first ten seconds, and nothing ever for a short call.
function startProgress(token, label, progressState) {
  if (token === undefined || token === null) return () => {};
  const started = Date.now();
  let n = 0;
  const send = () => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    emit({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {
        progressToken: token,
        progress: ++n,
        message: progressState.message ? String(progressState.message(elapsed)) : `${label} — ${elapsed}s`,
      },
    });
  };
  send();
  const tick = setInterval(send, 10000);
  tick.unref();
  return () => clearInterval(tick);
}

export function serve({ serverInfo, protocolVersion, tools, call }) {
  // MCP cancellation: requestId -> { controller, children }. Only an in-flight call has an entry.
  const inflight = new Map();

  function cancelRequest(requestId) {
    const entry = inflight.get(requestId);
    if (!entry) return false;
    entry.controller.abort();
    for (const child of entry.children) {
      try { child.kill(); } catch { /* the child may already be gone */ }
    }
    inflight.delete(requestId);
    return true;
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : protocolVersion,
          // Declare only what is implemented. `logging` was advertised while
          // notifications/message was never sent, and a client that trusted it got
          // silence; resources/* would answer -32601 for the same reason.
          capabilities: { tools: { listChanged: false } },
          serverInfo,
        });
      case 'ping':
        return reply({});
      case 'notifications/cancelled': {
        const target = params && params.requestId;
        cancelRequest(target);
        return null; // a notification takes no response
      }
      case 'tools/list':
        return reply({ tools });
      case 'tools/call': {
        const name = params && params.name;
        const token = params && params._meta ? params._meta.progressToken : undefined;
        const progressState = {};
        const controller = new AbortController();
        const children = [];
        const tracked = id !== undefined && id !== null;
        if (tracked) inflight.set(id, { controller, children });
        const ctx = {
          signal: controller.signal,
          progress: (fn) => { progressState.message = fn; },
          registerChild: (child) => { if (tracked) children.push(child); },
        };
        const stopProgress = startProgress(token, `${name}${params && params.arguments && params.arguments.node_id ? ' ' + params.arguments.node_id : ''}`, progressState);
        try {
          const out = await call(name, params && params.arguments, ctx);
          stopProgress();
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
        } catch (e) {
          stopProgress();
          // Tool-level failures are results, not protocol errors - the caller needs the
          // reason so it can record stage_ok=false and move on.
          return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
        } finally {
          inflight.delete(id);
        }
      }
      default:
        if (typeof id === 'undefined') return null;
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
    }
  }

  let buf = '';
  const input = process.stdin;
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      // Dispatch without awaiting: a node run must not stop the server from answering
      // ping, status, or a cancellation for that very node.
      Promise.resolve()
        .then(() => handle(msg))
        .catch((e) =>
          !msg || typeof msg.id === 'undefined'
            ? null
            : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } },
        )
        .then((out) => { if (out) emit(out); });
    }
  });
  input.on('end', () => process.exit(0));
}
