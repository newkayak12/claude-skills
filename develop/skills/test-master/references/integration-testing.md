# Integration Tests: Spring Boot and PostgreSQL

Integration tests check that your wiring, serialization, SQL and transactions work together. Keep them fewer than unit tests, but real: the database is a real PostgreSQL, not an in-memory stand-in with a different dialect.

## Choose the narrowest slice

| Question | Tool |
|---|---|
| Does the controller map, validate and serialize correctly? | `@WebMvcTest` + `MockMvc`, service mocked |
| Do my queries and mappings work? | `@DataJpaTest` (or jdbc test) against Testcontainers Postgres |
| Does a whole use case work through HTTP to the DB? | `@SpringBootTest(webEnvironment = RANDOM_PORT)` |

## Controller slice

```kotlin
@WebMvcTest(TransferController::class)
class TransferControllerTest(@Autowired val mvc: MockMvc) {
    @MockkBean lateinit var transfers: TransferService   // springmockk

    @Test
    fun `422 when funds are insufficient`() {
        every { transfers.move(any()) } throws InsufficientFunds()

        mvc.post("/transfers") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"from":"A","to":"B","amount":501}"""
        }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("INSUFFICIENT_FUNDS") }
        }
    }
}
```

Cover: success body and status, each validation failure, auth missing / forbidden, and the error envelope.

## Real database with Testcontainers

```kotlin
@Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = NONE)
class AccountRepositoryTest {
    companion object {
        @JvmStatic @Container @ServiceConnection
        val pg = PostgreSQLContainer("postgres:16")
    }
    // @Autowired repository ...
}
```

`@ServiceConnection` needs Spring Boot 3.1+ with `spring-boot-testcontainers` on the test classpath.

- Schema comes from the same migrations (Flyway/Liquibase) used in production, so migration bugs surface here.
- Start the container once per class (static) or per JVM, not per test.
- Isolate data: roll back with the test transaction, or truncate known tables in `@BeforeEach`. Never rely on test order.
- Assert on persisted state by querying again after flushing and clearing the persistence context; otherwise you only test the first-level cache.

## Things worth an integration test

- Unique and foreign-key constraints actually reject bad rows.
- A transaction rolls back every write when a later step throws.
- Optimistic-lock conflicts (`@Version`) surface as the error your API promises.
- Pagination and sort order on real data, including ties.

## Outbound HTTP

Stub the remote with WireMock or `MockRestServiceServer`; assert on the request you send as well as how you react to 4xx, 5xx, timeouts and malformed bodies.

## Failure hygiene

Fix a flaky integration test by removing its cause (shared rows, clock, async wait). Replace `Thread.sleep` with Awaitility's `await().atMost(...).until { ... }`.
