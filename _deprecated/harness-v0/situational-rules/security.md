# Situational — Security Baseline

**Trigger**: working with authentication, authorization, PII, tokens, encryption, external communication, or secrets

Do not go through OWASP Top 10 / CWE Top 25 all at once. Even covering *the basics* as a solo developer blocks most risks.

## S-01: Secrets never enter the repo

- **Why**: GitHub scanner bots scan for leaked tokens *by the minute*. Once public, *always* public.
- **How**:
  - `.env` files go in `.gitignore` + pre-commit hook (git-secrets / detect-secrets / gitleaks) before every commit
  - If a secret already entered: **revoke first** → then clean history. Reversing the order is pointless.
  - Production secrets go in vault / KMS / secrets manager. Code only *references* them.

## S-02: Principle of Least Privilege

- **Why**: Start with the minimum permission and add as needed — that is the default. Granting broad access upfront is hard to narrow later.
- **How**:
  - Separate DB accounts, API keys, and cloud IAM roles *by function*
  - Even your own operator account stays read-only in normal use. *Explicitly elevate* for changes.
  - Ask "is this permission really necessary?" each time a new one is granted.

## S-03: Input validation at boundary, trust within

- **Why**: Validating in every function makes it unclear *where trust begins*. Validate only at the boundary; trust inside.
- **How**:
  - Validate *type + domain rules* at system boundaries (HTTP handler, message consumer, CLI parser)
  - After validation, convert to a *clear type* (e.g. `ValidatedUserInput`) for internal passing
  - External systems (external API responses, DB results) are also treated as *boundaries*

## S-04: Encrypt at rest + in transit

- **Why**: Encrypting only one side exposes *the weak link in the chain*.
- **How**:
  - TLS 1.2+ for all external traffic. Internal communication also uses TLS *as a principle*.
  - Enable storage encryption on DB and object storage (most clouds provide this by default)
  - For sensitive columns, add *application-level* encryption (envelope encryption, KMS key)

## S-05: Authentication ≠ Authorization

- **Why**: Mixing the two creates *privilege defects*. "Logged in, therefore OK" is not an authorization check.
- **How**:
  - Authentication: who is this — token validation, session verification
  - Authorization: what can they do — explicitly check `does actor have action permission on resource` *per request*
  - Record the authorization model choice in an ADR (RBAC / ABAC / ReBAC)

## S-06: Token lifetime and refresh policy — make them explicit

- **Why**: "Token never expires" is the cause of *a major incident down the road*. Keep short + supplement UX with refresh.
- **How**:
  - Access token: short-lived (15 min – 1 hour)
  - Refresh token: long-lived but with **rotation** (issue new on use, invalidate old)
  - State the token *lifetime, issuance location, and revocation method* in an ADR
  - Token storage: `HttpOnly + Secure + SameSite` cookie or native secure storage

## S-07: PII identification + handling rules

- **Why**: Without a *catalogued list* of which columns are personal data, regulatory compliance is impossible.
- **How**:
  - Tag each column with `PII: Y/N` when writing the data model
  - Apply *encryption, access control, and log masking* consistently to all PII
  - Verify that PII does not leak into external systems (log collectors, analytics tools)

## S-08: Audit log

- **Why**: Without "who changed what and when", post-incident *root cause tracing is impossible*.
- **How**:
  - Sensitive actions (permission changes, payments, data deletion) → write to a *separate* audit log store
  - Keep it *separate* from general logs. Users must not be able to tamper with their own audit log.
  - Retention period: legal requirement or minimum 1 year

## S-09: Dependency security — Dependabot / Snyk

- **Why**: Our code is *only as secure as our dependencies*. CVEs are discovered every week.
- **How**:
  - Enable automated PRs (Dependabot, Renovate)
  - Patch *critical/high CVEs* within 24–48 hours each week
  - Adding a dependency is a *last resort* — prefer the standard library when possible

## S-10: Threat model — STRIDE 6-item check

- **Why**: Without writing down *which threats are possible* in advance, you end up doing post-hoc tracing.
- **How**: Run the STRIDE check for each trust boundary in the system (external → internal, user → admin) — Spoofing · Tampering · Repudiation · Information disclosure · Denial of service · Elevation of privilege

## Related skills

- `develop:transaction-boundary-reviewer` — security implications of transaction and consistency boundaries
- `develop:incident-response-playbook` — response procedures when a security incident occurs
- `cognition:assumption-extractor` — surface the assumption that "this is safe"
