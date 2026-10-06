# Security Tests

Automated checks that pin the controls an attacker would probe. They complement, not replace, a review or a scanner run.

## Authentication

- Wrong password and unknown user return the same status and message (no account enumeration).
- Repeated failures are throttled or locked per account and per source.
- Expired, tampered (altered payload, `alg` changed) and wrong-audience tokens are rejected.
- Logout or password change invalidates existing sessions/refresh tokens.
- Reset links are single-use and expire.

## Authorization

For every endpoint, enumerate roles x actions and assert both the allowed and the denied cell:

```kotlin
@Test
fun `user cannot read another user's order`() {
    val orderId = createOrderAs("alice")
    mvc.get("/orders/$orderId") { with(user("bob")) }
        .andExpect { status { isNotFound() } }   // or 403, but be consistent
}
```

Include: horizontal access (other tenant's id), vertical access (user calling an admin route), missing token, and mass assignment (client sends `role=ADMIN` or `ownerId` in the body).

## Input handling

| Attack | Test |
|---|---|
| SQL injection | send `' OR '1'='1` and `'; --` in every string filter; expect validation error or no extra rows; code paths use bound parameters |
| XSS | store `<script>` and `"><img onerror=...>`; assert it comes back escaped |
| Path traversal | `../../etc/passwd` in file-name params is rejected |
| SSRF | URL fields refuse internal addresses and non-http schemes |
| Oversized / malformed | giant body, deep JSON, wrong content type give 4xx, not 500 |
| File upload | wrong type, double extension, size above limit |

## Response hygiene

- Errors contain no stack traces, SQL or internal hostnames.
- Security headers present where relevant: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, frame protection.
- Cookies carry `HttpOnly`, `Secure`, and a `SameSite` value.
- CORS allows only listed origins.
- Secrets and personal data are absent from logs and from API responses that do not need them.

## Pipeline

Run dependency and image vulnerability scanning and a secrets scan on each build; run a dynamic scan against a staging deployment on a schedule. Triage findings by exploitability and exposure, and file each accepted risk with an owner and date.
