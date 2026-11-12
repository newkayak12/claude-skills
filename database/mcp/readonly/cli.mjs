#!/usr/bin/env node
// dbro: manage database-readonly-mcp profiles (the password never goes through the model).
// Without a terminal (run by Claude), login asks the password in a macOS hidden dialog.
//   dbro login <profile> [--host H] [--port P] [--user U] [--database D] [--vendor mysql] [--op op://...] [--no-password]
//   dbro logout <profile>
//   dbro list
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { createProfiles, PROFILES, assertProfile, passwordDialog } from './profiles.mjs';
import { redactor } from './config.mjs';

const out = (s) => process.stdout.write(s + '\n');

function ask(question, { hidden = false, def } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const prompt = `${question}${def !== undefined && def !== '' ? ` [${def}]` : ''}: `;
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(prompt)) rl.output.write(prompt);
      };
    }
    rl.question(prompt, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a === '' && def !== undefined ? String(def) : a);
    });
  });
}

async function verify(profiles, name) {
  let cfg;
  try {
    cfg = await profiles.resolve(name);
    const { default: create } = await import(`./vendors/${cfg.vendor}.mjs`);
    const db = create({ ...cfg, maxRows: 1, maxExecutionMs: 10000 });
    try {
      const r = await db.execute('SELECT 1 AS ok');
      out(`connection ok (read-only session, ${r.elapsedMs} ms)`);
    } finally {
      await db.close();
    }
  } catch (e) {
    const msg = cfg ? redactor(cfg)(e.message) : e.message;
    out(`saved, but connection failed: ${e.code ? `${e.code}: ` : ''}${msg}`);
    process.exitCode = 1;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      user: { type: 'string' },
      database: { type: 'string' },
      vendor: { type: 'string' },
      op: { type: 'string' },
      'no-password': { type: 'boolean' },
      'no-verify': { type: 'boolean' },
    },
  });
  const [cmd, name] = positionals;
  const profiles = createProfiles();

  if (cmd === 'list' || !cmd) {
    for (const p of profiles.list()) {
      out(p.loggedIn
        ? `${p.profile.padEnd(6)} logged in   ${p.vendor} ${p.user}@${p.host}:${p.port}/${p.database}  (password: ${p.auth})`
        : `${p.profile.padEnd(6)} ${p.host ? `logged out  ${p.vendor} ${p.user}@${p.host}:${p.port}/${p.database}` : '-'}`);
    }
    out(`settings: ${profiles.file}  secrets: ${profiles.secretsKind}`);
    return;
  }
  if (!name) throw new Error(`usage: dbro ${cmd} <${PROFILES.join('|')}>`);
  assertProfile(name);

  if (cmd === 'logout') {
    const existed = await profiles.logout(name);
    out(existed ? `${name}: logged out (password removed; host/user/database kept)` : `${name}: no saved profile`);
    return;
  }
  if (cmd !== 'login') throw new Error(`unknown command "${cmd}"; commands: login, logout, list`);

  const prev = profiles.get(name) ?? {};
  const interactive = process.stdin.isTTY;
  const field = async (k, label, def) => values[k] ?? (interactive ? await ask(label, { def: prev[k] ?? def }) : prev[k] ?? def);
  const fields = {
    vendor: values.vendor ?? prev.vendor ?? 'mysql',
    host: await field('host', 'host', name === 'local' ? '127.0.0.1' : undefined),
    port: await field('port', 'port', 3306),
    user: await field('user', 'user'),
    database: await field('database', 'database'),
  };
  let auth;
  if (values.op) auth = { op: values.op };
  else if (values['no-password']) auth = { none: true };
  else if (interactive) {
    const pw = await ask('password (hidden; or an op:// reference to read it from 1Password)', { hidden: true });
    auth = pw.startsWith('op://') ? { op: pw } : pw === '' ? { none: true } : { store: pw };
  } else if (process.platform === 'darwin') {
    auth = { store: await passwordDialog(name) };
  } else {
    throw new Error(`password needs a terminal: ! node ${process.argv[1]} login ${name} (or use --op op://... / --no-password)`);
  }
  const entry = await profiles.login(name, fields, auth);
  out(`${name}: saved (password: ${entry.auth})`);
  if (!values['no-verify']) await verify(profiles, name);
}

main().catch((e) => {
  process.stderr.write(`dbro: ${e.message}\n`);
  process.exit(1);
});
