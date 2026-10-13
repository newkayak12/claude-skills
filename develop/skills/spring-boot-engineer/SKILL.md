---
name: spring-boot-engineer
description: >-
  Use when building or extending a Spring Boot 3.x Java backend — REST, Spring Security, JPA, WebFlux, Actuator.
  Triggers on: "Spring Boot API", "스프링 시큐리티 설정", "JPA 연동". Not for service decomposition or query tuning.
scenarios:
  - "Build a REST API with Spring Boot including security, JPA, and error handling"
  - "Help me configure Spring Security for JWT-based authentication"
  - "Add caching, transaction management, and validation to our Spring Boot service"
  - "Spring Boot로 REST API를 만들어줘 — 시큐리티와 JPA 포함"
  - "JWT 인증을 위한 Spring Security 설정을 도와줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 트랜잭션 경계 설계와 보안 설정 검토를 더 체계적으로 수행합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  domain: backend
  output-format: code
  scope: implementation
  role: specialist
  triggers: Spring Boot, Spring Security, Spring Data JPA, Spring Cloud, WebFlux, Java REST API, Actuator
  related-skills: database-optimizer, architecture-designer, transaction-boundary-reviewer, kotlin-specialist
  version: "1.1.0"
---

## Standing Mandates

- NEVER report a feature done from reading the code. Run the project's own build and tests (`./mvnw test` or
  `./gradlew test`, whichever the repo has) and quote the pass/total line; a test you could not run is written
  `not run: <command>`. A wrong `requestMatchers` order or a missing `@Valid` compiles fine and fails only when run.
- NEVER return a JPA entity from a controller. Serialization walks lazy associations (`LazyInitializationException`
  or a hidden query per row) and exposes columns nobody chose to publish. Return a response record.
- NEVER leave an endpoint without a security test that asserts the unauthenticated and the unauthorized response as
  well as the success (a deliberately public endpoint: one test asserting it stays public). Filter-chain rules match first-to-last, so a broad matcher placed early silently decides.
- NEVER rely on `@Transactional` on a private method or a self-invoked method: the proxy is bypassed and no
  transaction starts. Put the boundary on a public method of a separate bean.
- NEVER use Boot 2.x idioms (`WebSecurityConfigurerAdapter`, `antMatchers`, `javax.*`): they were removed or moved in
  Spring Security 6 and Boot 3, so the code does not compile.
- Missing facts (Boot and Java version, database, token issuer, who may call what) are read from `pom.xml` /
  `build.gradle` / `application*.yml` first; the rest is `[확인 필요: ○○]`. Never invent an issuer URI, a secret or a
  role name, and never commit a secret.
- Goal: every endpoint has `@Valid` input, a security rule and a test; the build is green with the output quoted; the
  closing tally recounts to the controller files.

# Spring Boot Engineer

**Not for** service decomposition (`develop:architecture-designer`), slow JPA queries or indexes
(`develop:database-optimizer`), transaction-scope analysis of existing code (`develop:transaction-boundary-reviewer`),
Kotlin idioms (`develop:kotlin-specialist`), or an exploit audit (`develop:security-auditor`).

## Process

1. **Analyze** — read the build file and config; pin API contracts, data model, security needs; list `[확인 필요]`.
2. **Design** — persistence, remote-call and security approach in a few lines; get agreement before writing code.
3. **Implement** — layers with constructor injection (final fields; no field `@Autowired`); `@ConfigurationProperties`
   for settings; secrets from environment or a secret store.
4. **Secure** — authentication, resource-server rules, method-level checks, CORS (`references/security.md`).
5. **Test** — slice tests, Testcontainers where a real database matters, security tests (`references/testing.md`).
   Run the build; read the result.
6. **Operate** — Actuator health endpoints on; with the app running, `/actuator/health` reports `UP`.
7. **Recount** — count controllers' endpoints, those with `@Valid` bodies, a security rule, and a test; fix the tally if
   it differs.

## Output Template

```
## <feature>

1. Entity; request/response records with validation annotations
2. Repository interface
3. Service: constructor injection, @Transactional (writes) / readOnly = true (reads)
4. Controller: @Valid input, response records, @RestControllerAdvice
5. Tests: @WebMvcTest / @DataJpaTest, security cases

Open: [확인 필요: ○○] ...

Endpoints <n> · @Valid <v> · security rule <s> · security test <t>
Build: <command> → <pass>/<total> | not run: <command>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scaffolds layered code, security rules, JPA queries | Provide domain requirements and the data model |
| Writes transaction boundaries and test slices | Run the full suite and fix environment failures |
| Sets up Actuator and health indicators | Connect your monitoring and issuer/secret store |

## Reference Guide

| Need | Read | Covers |
|------|------|--------|
| Worked example | `references/example-book.md` | Entity to controller for one resource |
| Controllers and API errors | `references/web.md` | DTOs, validation, problem details, outbound clients, CORS |
| Persistence | `references/data.md` | Entity mapping, repositories, fetching, transactions, migrations |
| Authentication and authorization | `references/security.md` | Filter chain, resource server, method rules |
| Distributed deployment | `references/cloud.md` | Config, discovery, gateway, resilience, probes, packaging |
| Tests | `references/testing.md` | Slices, Testcontainers, security tests |

## Related Skills

- `develop:architecture-designer` — architecture decisions before implementation
- `develop:database-optimizer` — JPA query performance and index tuning
- `develop:transaction-boundary-reviewer` — `@Transactional` boundary analysis
- `develop:kotlin-specialist` — Kotlin-idiomatic Spring services
- `develop:security-auditor` — exploitability audit of the finished service
