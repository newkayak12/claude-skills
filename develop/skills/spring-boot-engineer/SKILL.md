---
name: spring-boot-engineer
description: >-
  Use when someone needs to build or extend a Java backend using the Spring
  ecosystem — wiring up a new REST API, configuring security and authentication,
  connecting to a database via JPA, or setting up reactive endpoints with Spring
  Boot 3.x.
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
  related-skills: database-optimizer, microservices-architect, transaction-boundary-reviewer, kotlin-specialist
  version: "1.1.0"
---

# Spring Boot Engineer

## When to Use / When Not to Use

**Use when:**
- Building REST controllers, JPA repositories, or service layers in Spring Boot 3.x
- Configuring Spring Security 6, OAuth2, or JWT authentication
- Setting up Actuator, health probes, or Spring Cloud components

**Do not use when:**
- Architecture-level service decomposition decisions (use `microservices-architect`)
- Kotlin-idiomatic concerns (pair with `kotlin-specialist`)

## Process

1. **Analyze requirements** — Pin down service boundaries, API contracts, data model and security needs
2. **Design architecture** — Decide persistence, remote-call and security approach; get agreement before writing code
3. **Implement** — Build layered services whose dependencies arrive through the constructor
4. **Secure** — Wire authentication, OAuth2 resource-server rules, method-level checks and CORS; compile the rules and see the security tests green
5. **Test** — Cover units, slices and integration paths; execute `./mvnw test` and read the result
6. **Deploy** — Enable Actuator health endpoints; check that `/actuator/health` reports `UP`

## Output Template

For each Spring Boot feature, provide:
1. Entity with validation annotations
2. Repository interface extending JpaRepository
3. Service with constructor injection and `@Transactional`
4. REST controller with `@Valid` input and `@RestControllerAdvice`
5. Test slice (`@WebMvcTest` or `@DataJpaTest`)

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates layered architecture scaffolding | Provide domain requirements and data model |
| Configures Spring Security rules and JWT setup | Verify auth behavior in your environment |
| Writes `@Transactional` boundaries and JPA queries | Run tests and confirm correct data behavior |
| Sets up Actuator endpoints and health indicators | Connect to your monitoring stack |
| Generates `@WebMvcTest` and Testcontainers test slices | Run the full test suite and fix failures |

## Reference Guide

| Need | Read | Covers |
|------|------|--------|
| Controllers and API errors | `references/web.md` | DTOs, validation, problem details, outbound clients, CORS |
| Persistence | `references/data.md` | Entity mapping, repositories, fetching, transactions, migrations |
| Authentication and authorization | `references/security.md` | Filter chain, resource server, method rules |
| Distributed deployment | `references/cloud.md` | Config, discovery, gateway, resilience, probes, packaging |
| Tests | `references/testing.md` | Slices, Testcontainers, security tests |

## Minimal Working Example

The example is a small `Book` catalog.

```java
@Entity
@Table(name = "books")
public class Book {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @NotBlank
    private String title;

    @PositiveOrZero
    private BigDecimal cost;
    // accessors omitted
}

public interface BookRepository extends JpaRepository<Book, Long> {
    List<Book> findByTitleContainingIgnoreCase(String fragment);
}

public record BookRequest(@NotBlank String title, @PositiveOrZero BigDecimal cost) {}

public record BookResponse(Long id, String title) {}

@Service
public class BookService {
    private final BookRepository books;

    public BookService(BookRepository books) { this.books = books; }

    @Transactional(readOnly = true)
    public List<Book> search(String fragment) {
        return books.findByTitleContainingIgnoreCase(fragment);
    }

    @Transactional
    public Book add(BookRequest req) {
        Book b = new Book();
        b.setTitle(req.title());
        b.setCost(req.cost());
        return books.save(b);
    }
}

@RestController
@RequestMapping("/api/v1/books")
public class BookController {
    private final BookService books;

    public BookController(BookService books) { this.books = books; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BookResponse add(@Valid @RequestBody BookRequest req) {
        Book saved = books.add(req);
        return new BookResponse(saved.getId(), saved.getTitle());
    }
}
```

Entities stay behind the service; the controller returns a response record (see `references/web.md`).

## Constraints

**MUST DO:**

| Rule | Pattern |
|------|---------|
| Constructor injection | Final fields assigned in the constructor |
| Validate API input | Annotate each write endpoint's body with `@Valid` |
| Typed settings | Bind with `@ConfigurationProperties`, prefix `app` |
| Transaction scope | Writes spanning several steps are `@Transactional`; reads add `readOnly = true` |
| Secrets | Supplied by environment or a secret store, not by committed property files |

**MUST NOT DO:**
- Inject fields with `@Autowired`
- Accept unvalidated request bodies
- Call `.block()` inside a reactive chain
- Carry over Boot 2.x idioms such as `WebSecurityConfigurerAdapter`

## Related Skills

- `microservices-architect` — for architecture decisions before implementation
- `database-optimizer` — for JPA query performance and index tuning
- `transaction-boundary-reviewer` — for `@Transactional` boundary analysis
- `kotlin-specialist` — for Kotlin-idiomatic patterns in Spring services
