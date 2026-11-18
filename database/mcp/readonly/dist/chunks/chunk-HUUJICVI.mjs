#!/usr/bin/env node
// database-readonly MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.
// sources: 0f598961112e8f4a
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// config.mjs
import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
var OPTIONS = {
  vendor: "DB_VENDOR",
  host: "MYSQL_HOST",
  port: "MYSQL_PORT",
  user: "MYSQL_USER",
  password: "MYSQL_PASS",
  database: "MYSQL_DB",
  "max-rows": "MAX_ROWS",
  "max-execution-ms": "MAX_EXECUTION_MS",
  profile: "DBRO_PROFILE",
  pii: "DBRO_PII"
};
var GENERIC_ENV = { host: "DB_HOST", port: "DB_PORT", user: "DB_USER", password: "DB_PASS", database: "DB_NAME" };
var VENDORS = ["mysql", "mariadb", "postgres", "oracle"];
var DEFAULT_PORT = { mysql: 3306, mariadb: 3306, postgres: 5432, oracle: 1521 };
var PII_DEFAULT = [
  "(^|_)(tel|phone|hp|mobile|cell_?no|fax)(_?\\d+|_?no)?$",
  "(^|_)e_?mail(_?addr)?$",
  "(^|_)(addr|address)(_?\\d+|_?dtl|_?detail)?$",
  "(^|_)(post|zip)(_?(no|cd|code))?$",
  "(^|_)(jumin|rrn|ssn|resident_?no|birth\\w*|passport\\w*)$",
  "(^|_)(order|orderer|ord|recv|receiver|recipient|sender|send|buyer|member|cust|customer|user|consignee)_?(nm|name)$",
  "(^|_)decrypt(ed)?(_|$)"
];
function piiMatcher(spec) {
  if (spec === "off") return null;
  const list = spec ? spec.split(",").map((s) => s.trim()).filter(Boolean) : PII_DEFAULT;
  const res = list.map((s) => new RegExp(s, "i"));
  return (col) => res.some((r) => r.test(col));
}
var USAGE = `database-readonly-mcp [--vendor V] [--profile local|dev|stage|prod]   (profile mode, default local)
database-readonly-mcp [--vendor V] --host H [--port P] --user U [--password P] --database D   (direct mode)
  vendors: ${VENDORS.join(", ")} (default mysql); each vendor has its own profiles
  common: [--max-rows 1000] [--max-execution-ms 30000] [--pii off|regex,regex]
Each option falls back to its env var: ${Object.entries(OPTIONS).map(([k, v]) => `--${k}=${v}`).join(", ")}
(and DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME). Oracle: --database is the service name.
A value starting with op:// is resolved with \`op read\` (1Password CLI, optional).
Profiles are saved with: node cli.mjs login <profile> [--vendor V]`;
function opRead(ref) {
  return new Promise((resolve, reject) => {
    execFile("op", ["read", "--no-newline", ref], { timeout: 6e4 }, (err, stdout) => {
      if (err) reject(new Error(err.code === "ENOENT" ? "1Password CLI (op) not installed" : `op read failed (${err.code ?? "error"})`));
      else resolve(stdout);
    });
  });
}
var resolveValue = async (v, read = opRead) => typeof v === "string" && v.startsWith("op://") ? read(v) : v;
function toInt(name, raw, fallback) {
  if (raw === void 0 || raw === "" || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}
function readSettings(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, { type: "string" }])),
    strict: true
  });
  const raw = {};
  for (const [opt, envName] of Object.entries(OPTIONS)) raw[opt] = values[opt] ?? env[envName] ?? env[GENERIC_ENV[opt]];
  if (raw.vendor && !VENDORS.includes(raw.vendor)) throw new Error(`--vendor must be one of ${VENDORS.join(", ")}`);
  return raw;
}
var isDirect = (raw) => !!(raw.host || raw.user || raw.database);
var limits = (raw) => ({
  maxRows: toInt("max-rows", raw["max-rows"], 1e3),
  maxExecutionMs: toInt("max-execution-ms", raw["max-execution-ms"], 3e4),
  ...raw.pii ? { pii: raw.pii } : {}
});
async function resolveConfig(argv = process.argv.slice(2), env = process.env, read = opRead) {
  const raw = readSettings(argv, env);
  const out = {};
  for (const k of ["vendor", "host", "port", "user", "password", "database", "max-rows", "max-execution-ms", "pii"]) {
    try {
      out[k] = await resolveValue(raw[k], read);
    } catch (e) {
      throw new Error(`--${k}: ${e.message}`);
    }
  }
  const missing = ["host", "user", "database"].filter((k) => !out[k]);
  if (missing.length) throw new Error(`missing: ${missing.map((k) => `--${k} (${OPTIONS[k]})`).join(", ")}`);
  const vendor = out.vendor || "mysql";
  return {
    vendor,
    host: out.host,
    port: toInt("port", out.port, DEFAULT_PORT[vendor]),
    user: out.user,
    password: out.password ?? "",
    database: out.database,
    ...limits(out)
  };
}
function redactor(cfg) {
  const secrets = [cfg.password, cfg.user, cfg.host].filter((s) => s && s.length >= 3);
  return (msg) => secrets.reduce((m, s) => m.split(s).join("***"), String(msg));
}

export {
  __require,
  __commonJS,
  __export,
  __toESM,
  DEFAULT_PORT,
  piiMatcher,
  USAGE,
  opRead,
  resolveValue,
  toInt,
  readSettings,
  isDirect,
  limits,
  resolveConfig,
  redactor
};
