// logout: forget the cached STS session of a profile; with forget:true also the stored keys. A 1Password
// reference lives in the profile entry and stays. The profile entry always stays. Not read-only.
import { ok, err, header, defineTool } from './contract.mjs';
import { sessionAccount, keyAccount } from './keychain.mjs';
import { assertName, unknownProfile } from './profiles.mjs';

export const logoutTool = defineTool({
  name: 'logout',
  description:
    'Delete the cached session of a profile (default: the active one) and report its expiry. STS tokens cannot be revoked and stay valid until then. forget:true also deletes the stored keys; a 1Password reference stays in the profile entry, as does the entry.',
  inputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Profile name; default is the active profile.' },
      forget: { type: 'boolean', description: 'Also delete the stored access keys (a 1Password reference stays in the profile entry).' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const { profiles, keychain } = ctx;
    try {
      const name = args?.profile ?? profiles.active();
      if (!name) return err('no active profile; pass a profile name');
      assertName(name);
      const e = profiles.get(name);
      if (!e) return err(unknownProfile(profiles, name));
      const lines = [header({ profile: name, account: e.account, region: e.region })];

      const session = await profiles.getSession(name);
      if (session) {
        await keychain.del(sessionAccount(name));
        lines.push(`session deleted; it expires ${session.Expiration ?? 'at an unknown time'}. STS tokens cannot be revoked and stay valid until then.`);
      } else {
        lines.push(`no session cached; nothing deleted${e.mfa_serial ? '' : ' (a profile without an MFA serial never has one)'}.`);
      }

      const ref = await profiles.opRef(name);
      if (args?.forget) {
        if (ref) {
          lines.push('1Password reference stays in the profile entry (profile_save with vault and item null removes it); nothing else to delete.');
        } else {
          await keychain.del(keyAccount(name));
          lines.push('stored keys deleted; the profile entry stays.');
        }
      } else if (ref) {
        lines.push('the next query will log in again silently.');
      }
      return ok(lines.join('\n'));
    } catch (x) {
      return err(x.message);
    }
  },
});
