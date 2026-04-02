---
name: spring-boot-engineer
description: >-
  Use when someone needs to build or extend a Java backend using the Spring ecosystem —
  wiring up a new REST API, configuring security and authentication, connecting to a
  database via JPA, or setting up reactive endpoints with Spring Boot 3.x.
  Triggers on: "Spring Boot", "Spring Security", "JPA repository", "Spring REST API",
  "Spring WebFlux", "OAuth2 Spring", "스프링 부트", "스프링 시큐리티", "JPA 설정",
  "Spring Cloud Gateway".
  Best for: REST controllers, JPA data access, Spring Security 6, Actuator/observability.
  Not for: architecture-level service decomposition (use microservices-architect); Kotlin-idiomatic patterns (pair with kotlin-specialist).
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
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: Spring Boot, Spring Framework, Spring Cloud, Spring Security, Spring Data JPA, Spring WebFlux, Microservices Java, Java REST API, Reactive Java
  role: specialist
  scope: implementation
  output-format: code
  related-skills: java-architect, database-optimizer, microservices-architect, devops-engineer
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

1. **Analyze requirements** — Identify service boundaries, APIs, data models, security needs
2. **Design architecture** — Plan data access, cloud integration, security; confirm before coding
3. **Implement** — Create services with constructor injection and layered architecture
4. **Secure** — Add Spring Security, OAuth2, method security, CORS; verify security rules compile and tests pass
5. **Test** — Write unit, integration, and slice tests; run `./mvnw test` and confirm all pass
6. **Deploy** — Configure Actuator health checks; validate `/actuator/health` returns `UP`

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

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Web Layer | `references/web.md` | Controllers, REST APIs, validation, exception handling |
| Data Access | `references/data.md` | Spring Data JPA, repositories, transactions, projections |
| Security | `references/security.md` | Spring Security 6, OAuth2, JWT, method security |
| Cloud Native | `references/cloud.md` | Spring Cloud, Config, Discovery, Gateway, resilience |
| Testing | `references/testing.md` | @SpringBootTest, MockMvc, Testcontainers, test slices |

## Quick Start — Minimal Working Structure

### Entity
```java
@Entity
@Table(name = "products")
public class Product {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @NotBlank private String name;
    @DecimalMin("0.0") private BigDecimal price;
}
```

### Repository
```java
public interface ProductRepository extends JpaRepository<Product, Long> {
    List<Product> findByNameContainingIgnoreCase(String name);
}
```

### Service (constructor injection)
```java
@Service
public class ProductService {
    private final ProductRepository repo;
    public ProductService(ProductRepository repo) { this.repo = repo; }

    @Transactional(readOnly = true)
    public List<Product> search(String name) {
        return repo.findByNameContainingIgnoreCase(name);
    }
}
```

### REST Controller
```java
@RestController
@RequestMapping("/api/v1/products")
@Validated
public class ProductController {
    private final ProductService service;
    public ProductController(ProductService service) { this.service = service; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Product create(@Valid @RequestBody ProductRequest request) {
        return service.create(request);
    }
}
```

### DTO (record)
```java
public record ProductRequest(
    @NotBlank String name,
    @DecimalMin("0.0") BigDecimal price
) {}
```

## Constraints

**MUST DO:**

| Rule | Correct Pattern |
|------|----------------|
| Constructor injection | `public MyService(Dep dep) { this.dep = dep; }` |
| Validate API input | `@Valid @RequestBody` on every mutating endpoint |
| Type-safe config | `@ConfigurationProperties(prefix = "app")` |
| Transaction scope | `@Transactional` on multi-step writes; `readOnly = true` on reads |
| Externalize secrets | Environment variables or Spring Cloud Config — never in `application.properties` |

**MUST NOT DO:**
- Field injection (`@Autowired` on fields)
- Skip input validation on API endpoints
- Mix blocking and reactive code (no `.block()` inside WebFlux chains)
- Use deprecated Spring Boot 2.x patterns (e.g., `WebSecurityConfigurerAdapter`)

## Related Skills

- `microservices-architect` — for architecture decisions before implementation
- `database-optimizer` — for JPA query performance and index tuning
- `transaction-boundary-reviewer` — for `@Transactional` boundary analysis
- `kotlin-specialist` — for Kotlin-idiomatic patterns in Spring services
