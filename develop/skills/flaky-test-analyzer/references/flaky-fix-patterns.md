# Flaky Test Fix Patterns — Category Reference

Detailed code examples and fix patterns for each flakiness category.

---

## Category 1: Timing Dependencies

The most common flakiness source. The test asserts on something that happens asynchronously, but the assertion runs before the async work completes.

**Symptoms:**
- Test passes locally (fast machine) but fails on CI (slower/busier machine)
- Increasing a sleep makes the test more stable
- Failure messages say "expected X but got initial state Y"

**Root cause patterns:**

```javascript
// Bad — fixed sleep: brittle and slow
await sleep(1000);
expect(result).toBe('done');

// Bad — polling without timeout: can hang forever
while (!result.isDone()) { await sleep(10); }
expect(result.value).toBe('done');
```

**Fix — use explicit async completion signals:**

```javascript
// Good — wait for the specific condition with a timeout
await waitFor(() => expect(result).toBe('done'), { timeout: 5000 });

// Good (event-driven) — wait for the event, not for time
await new Promise(resolve => emitter.once('complete', resolve));
expect(result).toBe('done');
```

**Fix — control time explicitly:**
```java
// Inject a Clock instead of calling System.currentTimeMillis() directly
// In tests, pass a fixed clock; in production, pass Clock.systemUTC()
Clock fixedClock = Clock.fixed(Instant.parse("2025-01-01T00:00:00Z"), ZoneOffset.UTC);
OrderExpiryService service = new OrderExpiryService(fixedClock);
```

---

## Category 2: Shared State Between Tests

Tests pollute shared state (database, static variables, in-memory caches, file system) and later tests observe that pollution.

**Symptoms:**
- Fails only when run as part of the full suite, passes in isolation
- Failure rate increases as the suite grows
- Different test orderings produce different failures

**Diagnosis:**
```bash
# Run tests in random order to surface ordering dependencies
pytest --randomly-seed=random
mvn test -Dsurefire.runOrder=random
```

**Fix — reset shared state between tests:**

```java
// Spring Boot — roll back each test's transaction
@Transactional  // Spring rolls back after each test method
class OrderRepositoryTest { ... }

// Or truncate tables explicitly
@BeforeEach
void setUp() {
    jdbcTemplate.execute("TRUNCATE TABLE orders, order_items RESTART IDENTITY CASCADE");
}
```

```python
# pytest — use function-scoped fixtures for shared resources
@pytest.fixture(autouse=True)
def reset_cache():
    cache.clear()
    yield
    cache.clear()
```

**Static variables are the sneakiest form of shared state:**
```java
// Bad — static counter accumulated across tests
class PaymentProcessor {
    private static int callCount = 0;  // shared across all test instances
}

// Fix — use instance variable and create fresh instances per test
@BeforeEach
void setUp() {
    processor = new PaymentProcessor(); // fresh instance, fresh state
}
```

---

## Category 3: External Dependencies

Tests that call real databases, HTTP APIs, file systems, or message queues are at the mercy of those systems' availability and latency.

**Symptoms:**
- Fails with network errors, timeouts, or `Connection refused`
- Fails only in CI (different network, no external access)
- Failure rate correlates with third-party service availability

**Fix — mock at the boundary:**

```java
// Bad — real HTTP call in unit test
@Test void shouldReturnUser() {
    UserClient client = new UserClient("https://real-api.example.com");
    User user = client.getUser(1L);
    assertThat(user.getName()).isEqualTo("Alice");
}

// Good — mock the HTTP layer
@Test void shouldReturnUser() {
    UserClient client = new UserClient(mockServer.baseUrl());
    mockServer.stubFor(get("/users/1").willReturn(ok().withBody("""
        {"id": 1, "name": "Alice"}
    """)));
    User user = client.getUser(1L);
    assertThat(user.getName()).isEqualTo("Alice");
}
```

For integration tests that need a real database, use Testcontainers to spin up a fresh, isolated DB per test run:
```java
@Testcontainers
class OrderRepositoryIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
}
```

---

## Category 4: Test Ordering Dependencies

Test A creates data or sets up state that Test B implicitly relies on. When B runs before A, it fails.

**Diagnosis — reproduce with reversed order:**
```bash
# JUnit 5 — annotate to detect ordering bugs
@TestMethodOrder(MethodOrderer.Random.class)

# pytest
pytest --randomly-seed=last  # repeat last random order to reproduce failure
```

**Fix — each test owns its setup:**
```java
// Bad — test assumes previous test created the user
@Test void shouldUpdateUser() {
    // assumes "Alice" was created by a previous test
    userRepo.updateName("alice@example.com", "Alicia");
    assertThat(userRepo.find("alice@example.com").getName()).isEqualTo("Alicia");
}

// Good — test creates its own preconditions
@Test void shouldUpdateUser() {
    userRepo.save(new User("alice@example.com", "Alice")); // self-contained
    userRepo.updateName("alice@example.com", "Alicia");
    assertThat(userRepo.find("alice@example.com").getName()).isEqualTo("Alicia");
}
```

---

## Category 5: Concurrency and Parallelism

Tests run in parallel and share resources: ports, files, in-memory singletons, or database rows.

**Symptoms:**
- Fails only with parallel test execution enabled
- Failure messages include port-in-use, file-already-exists, or duplicate key errors
- Increasing parallel workers increases failure rate

**Fix — isolate resources per test:**

```java
// Bad — hardcoded port, fails when two tests start servers simultaneously
server = new TestServer(8080);

// Good — use a random port; find the assigned port after binding
server = new TestServer(0);  // 0 = OS assigns a free port
int port = server.getPort();
```

```java
// Bad — shared in-memory cache accessed by parallel tests
Cache.getInstance().put("key", value); // singleton, no isolation

// Good — inject the cache; each test gets its own instance
Cache cache = new InMemoryCache();
ServiceUnderTest service = new ServiceUnderTest(cache);
```
