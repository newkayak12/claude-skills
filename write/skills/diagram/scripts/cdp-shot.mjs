// Renders one page to a PNG through a headless Chrome that is already running (Chrome DevTools Protocol), and
// launches that shared browser. Only the test suite uses it (figure.mjs rasterize, when DIAGRAM_CHROME_WS is set):
// one browser for the whole run instead of two or three launches per PNG. node: modules only; Node's global WebSocket.
//   node cdp-shot.mjs <ws-url> <page.html> <W> <H> <out.png>   (2x device scale, white background, exit 1 on any failure)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RENDER_MS = 100000; // under rasterize's 110000 spawnSync timeout, so the child fails on its own first

// A Chrome that exits before the call is made (or never answers) must fail, not hang.
function withDeadline(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: no answer in ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      const [ok, bad] = pending.get(m.id); pending.delete(m.id);
      m.error ? bad(new Error(`${m.error.message}`)) : ok(m.result);
    } else if (m.method) for (const w of waiters.splice(0)) w(m);
  };
  const opened = new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error(`cannot connect to ${url}`)); });
  ws.onclose = () => { for (const [, [, bad]] of pending) bad(new Error('connection closed')); pending.clear(); };
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
    const i = ++id; pending.set(i, [ok, bad]);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const event = (method, sessionId) => new Promise((ok) => {
    const w = (m) => (m.method === method && (!sessionId || m.sessionId === sessionId) ? ok(m) : waiters.push(w));
    waiters.push(w);
  });
  return { opened, send, event, close: () => ws.close() };
}

export async function renderPage(wsUrl, pagePath, W, H, pngPath) {
  const c = connect(wsUrl);
  await c.opened;
  let targetId;
  try {
    ({ targetId } = await c.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => c.send(m, p, sessionId);
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 255, b: 255, a: 1 } });
    const loaded = c.event('Page.loadEventFired', sessionId);
    await s('Page.navigate', { url: pathToFileURL(pagePath).href });
    await loaded;
    const ready = await s('Runtime.evaluate', {
      expression: 'Promise.all([...document.images].map((i) => i.decode().then(() => true, () => false))).then((r) => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go(r.length > 0 && r.every(Boolean))))))',
      awaitPromise: true, returnByValue: true });
    if (ready.result?.value !== true) throw new Error('the image did not decode');
    const { data } = await s('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const tmp = `${pngPath}.tmp-${process.pid}`;
    writeFileSync(tmp, Buffer.from(data, 'base64'));
    renameSync(tmp, pngPath);
  } finally {
    if (targetId) await Promise.race([c.send('Target.closeTarget', { targetId }).catch(() => {}), sleep(2000)]);
    c.close();
  }
}

// Starts one headless Chrome with its own fresh profile and resolves { ws, close }. close() asks Chrome to quit
// (Browser.close), waits for it to exit, then removes the profile (Chrome's helpers can still hold files for a moment).
export async function launchBrowser(browserPath, { timeoutMs = 30000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'diagram-chrome-'));
  const child = spawn(browserPath, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--force-device-scale-factor=2', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  const cleanup = () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  let spawnErr;
  child.once('error', (e) => { spawnErr = e; });
  const deadline = Date.now() + timeoutMs;
  let ws = null;
  while (!ws) {
    if (spawnErr || child.exitCode !== null) { cleanup(); throw new Error(`${browserPath} did not start: ${spawnErr?.message || `exit ${child.exitCode}`}`); }
    if (Date.now() > deadline) { child.kill('SIGKILL'); await exited; cleanup(); throw new Error(`${browserPath} gave no DevTools port in ${timeoutMs} ms`); }
    try {
      const [port, path] = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n');
      if (port && path) ws = `ws://127.0.0.1:${port}${path}`;
    } catch {}
    if (!ws) await sleep(50);
  }
  const close = async () => {
    if (child.exitCode === null) {
      try {
        const c = connect(ws);
        await withDeadline(c.opened, 5000, 'connect');
        c.send('Browser.close').catch(() => {});
        await Promise.race([exited, sleep(10000)]);
        c.close();
      } catch {}
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    }
    cleanup();
  };
  return { ws, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ws, page, w, h, png] = process.argv;
  if (!ws || !page || !(+w > 0) || !(+h > 0) || !png) { console.error('usage: cdp-shot.mjs <ws-url> <page.html> <W> <H> <out.png>'); process.exit(2); }
  try {
    await withDeadline(renderPage(ws, page, +w, +h, png), RENDER_MS, 'render');
    process.exit(0);
  } catch (e) { console.error(`cdp-shot: ${e.message}`); process.exit(1); }
}
