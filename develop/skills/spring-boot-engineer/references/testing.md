# Testing

## Pick the narrowest slice

| Question | Tool | Context loaded |
|---|---|---|
| Does this logic compute correctly? | Plain JUnit 5 + Mockito | none |
| Does the controller map, validate and serialize? | `@WebMvcTest` | MVC beans only |
| Do my queries and mappings work? | `@DataJpaTest` | JPA + datasource |
| Does the whole wiring work end to end? | `@SpringBootTest` | everything |
| Is JSON shaped as expected? | `@JsonTest` | Jackson |

The wider the context, the slower the suite; keep `@SpringBootTest` for a few journeys.

## Plain unit tests

```java
@ExtendWith({MockitoExtension.class})
class PricingServiceTest {
    @Mock DiscountRepository discounts;
    @InjectMocks PricingService pricing;

    @Test
    void appliesLargestDiscount() {
        when(discounts.activeFor("gold")).thenReturn(List.of(pct(5), pct(15)));

        assertThat(pricing.priceFor("gold", new BigDecimal("100.00")))
            .isEqualByComparingTo("85.00");
    }

    @ParameterizedTest
    @CsvSource({"0,0", "1,5", "10,50"})
    void multiplies(int qty, int expected) { ... }
}
```

## Controller slice

```java
@WebMvcTest(TicketController.class)
class TicketControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean TicketService tickets;      // Boot 3.4+; earlier versions: @MockBean

    @Test
    void rejectsEmptyItems() throws Exception {
        mvc.perform(post("/v1/tickets")
                .contentType("application/json")
                .content("""
                    {"reporterId": 1, "items": []}
                    """))
           .andExpect(status().isBadRequest());
    }

    @Test
    void opensTicket() throws Exception {
        when(tickets.open(any())).thenReturn(new TicketResponse(7, "OPEN", Instant.EPOCH));

        mvc.perform(post("/v1/tickets")
                .contentType("application/json")
                .content("""
                    {"reporterId": 1, "items": [{"sku": "A1", "quantity": 2}]}
                    """))
           .andExpect(status().is(201))
           .andExpect(header().string("Location", endsWith("/v1/tickets/7")));
    }
}
```

With Spring Security on the classpath the slice applies the filter chain. Add `spring-security-test` and use `@WithMockUser(roles = "ADMIN")` or `.with(jwt())` request post-processors, plus `.with(csrf())` for mutating calls when CSRF is enabled.

## Repository slice with a real database

H2 hides dialect differences. Run the production engine in a container, wired by `@ServiceConnection` (Boot 3.1+):

```java
@Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = Replace.NONE)
class InvoiceRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");

    @Autowired InvoiceRepository invoices;
    @Autowired TestEntityManager em;

    @Test
    void findsOverdue() {
        em.persist(overdueInvoice());
        em.flush(); em.clear();                    // force a real round trip

        assertThat(invoices.findByStatus(InvoiceStatus.OVERDUE)).hasSize(1);
    }
}
```

`@DataJpaTest` rolls back after each test. Flush and clear before asserting, or the first-level cache answers instead of the database.

## Full-context test

```java
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class TicketJourneyTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");

    @Autowired TestRestTemplate http;

    @Test
    void openThenFetch() {
        var created = http.postForEntity("/v1/tickets", validRequest(), TicketResponse.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        var fetched = http.getForEntity(created.getHeaders().getLocation(), TicketResponse.class);
        assertThat(fetched.getBody().status()).isEqualTo("OPEN");
    }
}
```

Share one container across classes by declaring it in an abstract base or a `@TestConfiguration` with `@Bean @ServiceConnection`; starting a database per class dominates run time.

## Reactive endpoints

`WebTestClient` works with WebFlux slices (`@WebFluxTest`) and with a running server.

```java
webTestClient.get().uri("/quotes/{sku}", "A1")
    .exchange()
    .expectStatus().isOk()
    .expectBody().jsonPath("$.amount").isEqualTo(10);
```

For publishers inside services use `StepVerifier` from reactor-test.

## Overriding configuration

- `@TestPropertySource(properties = "app.feature.x=true")` or `@DynamicPropertySource` for values only known at runtime.
- `@ActiveProfiles("test")` for a profile file.
- `@TestConfiguration` for replacement beans; it is not picked up by component scan, so import it explicitly.

## Habits

- Name tests after behaviour, assert one behaviour each.
- No sleeps; await with Awaitility.
- Never share mutable state between tests; each builds its own data.
- A failing security rule needs a test for the denied case, not just the allowed one.
- Execute the build tool's test task before calling work finished, and read what it prints.
