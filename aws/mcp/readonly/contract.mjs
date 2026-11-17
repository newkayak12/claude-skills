// Shared contract of the readonly-aws server: tool annotations, MCP result helpers, the first answer
// line, and the tool-definition shape that profiles.mjs, logout.mjs and the login/query tools follow.
//
// A tool is { name, description, inputSchema, annotations?, handler(args, ctx) } and handler returns
// ok(text) or err(text). ctx is built once by the server and handed to every handler:
//   ctx.profiles  createProfiles(...) from profiles.mjs (profile entries, active profile, session cache)
//   ctx.keychain  createKeychain(...) from keychain.mjs ({ get, set, del } by account name)
//   ctx.exec      execAws from awsexec.mjs, or a stub in tests
//   ctx.env       the server's process env (read by childEnv; never passed on whole)

export const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const ok = (text) => ({ content: [{ type: 'text', text: String(text) }] });
export const err = (text) => ({ content: [{ type: 'text', text: String(text) }], isError: true });

// First line of every answer: which identity the answer is about.
export const header = ({ profile, account, region } = {}) => `profile ${profile ?? '-'} · account ${account ?? '-'} · region ${region ?? '-'}`;

export function defineTool(def) {
  if (!def || typeof def !== 'object') throw new TypeError('tool definition must be an object');
  if (typeof def.name !== 'string' || !def.name) throw new TypeError('tool definition needs a name');
  if (typeof def.description !== 'string' || !def.description) throw new TypeError(`tool ${def.name}: description is required`);
  if (!def.inputSchema || typeof def.inputSchema !== 'object') throw new TypeError(`tool ${def.name}: inputSchema is required`);
  if (typeof def.handler !== 'function') throw new TypeError(`tool ${def.name}: handler is required`);
  if (def.annotations !== undefined && (def.annotations === null || typeof def.annotations !== 'object')) {
    throw new TypeError(`tool ${def.name}: annotations must be an object`);
  }
  return def;
}
