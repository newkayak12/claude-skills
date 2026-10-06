# Security Audit Checklist

Sweep only the areas the scoped code touches. Every item is a candidate until triage (SKILL.md step 4) traces it.
IDs: OWASP Top 10:2025 (verified 2026-10-06 against https://owasp.org/Top10/2025/ — the 2021 numbering differs).

| ID | 2025 category |
|---|---|
| A01 | Broken Access Control (includes SSRF) |
| A02 | Security Misconfiguration |
| A03 | Software Supply Chain Failures |
| A04 | Cryptographic Failures |
| A05 | Injection |
| A06 | Insecure Design |
| A07 | Authentication Failures |
| A08 | Software or Data Integrity Failures |
| A09 | Security Logging and Alerting Failures |
| A10 | Mishandling of Exceptional Conditions |

## Authentication and session (A07)

- Token verification pins the algorithm and rejects `none`; expiry is required, not optional.
- Secrets used to sign tokens come from the environment and fail closed when missing.
- Session or token is invalidated on logout and on privilege change.
- Login, reset, and OTP endpoints have attempt limits.
- Password storage uses a slow hash (bcrypt, scrypt, Argon2), never a fast digest.

## Authorization (A01)

- Every read or write by ID checks ownership or role against the caller (`WHERE id = $1 AND user_id = $2`), not
  only that the caller is logged in. Missing check = IDOR.
- Admin routes are protected where they are mounted or in a filter chain — check the mount point before flagging.
- Mass assignment: request bodies cannot set `role`, `userId`, `price`, `status`.
- Server-side requests to user-supplied URLs are restricted to an allowlist (SSRF, A01 in 2025).

## Input handling (A05, A08)

- SQL, NoSQL, shell, and template calls use binding or safe APIs. Concatenation is a finding only if attacker input
  reaches it — an allowlist lookup is not, but check the lookup itself (a plain object returns `constructor` for
  `?sort=constructor`; use `Object.hasOwn` or a `Map`).
- Output rendered into HTML is escaped or sanitised (XSS); a CSP exists for user-generated content.
- Uploads: size, type by content (not extension), stored outside the web root, served with a fixed content type.
- Deserialisation of untrusted data uses a schema, never native object deserialisers.
- Path parameters joined into file paths are normalised and checked against a base directory.

## Secrets (A02, A04)

- No credential literals in source, config, tests, or fixtures. Report `path:line` and key name only.
- `.env*` ignored by git; secrets absent from git history (`git log -p -S <prefix>`); a committed live key must be
  rotated, not just removed.
- Secrets never logged or returned in error bodies.

## Payment trust boundary (A01, A06, A08)

- The charged amount and currency are computed on the server from the cart or order — never taken from the request
  body.
- Payment status changes only through a webhook whose signature is verified on the raw body
  (`stripe.webhooks.constructEvent`, PG-specific HMAC), not through a client callback.
- Charge, capture, and refund endpoints check that the caller owns the order or holds the role.
- Idempotency keys, double-spend races, and transaction atomicity are out of scope here — hand to
  `develop:transaction-boundary-reviewer`.

## Config and dependencies (A02, A03, A09, A10)

- Debug modes, stack traces, and default credentials off in production config.
- Async errors are caught; an unhandled rejection that kills the process is an availability finding only when an
  attacker can trigger it on demand.
- Lockfile committed; the ecosystem audit command is recommended, its output never invented.
- Security events (login failure, permission denied, payment state change) are logged without secrets.
