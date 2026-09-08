# Runners

Pick by what the repo already runs; add a stack only when there is none. Base URL, credentials,
and port come from environment variables in every runner — a literal `localhost:8080` in a test
is a finding.

| Repo has | Runner | Run |
|----------|--------|-----|
| Gradle/Maven, JUnit | RestAssured + JUnit 5 | `BASE_URL=… ./gradlew test --tests '*Scenario*'` |
| pytest | pytest + httpx | `BASE_URL=… pytest tests/scenarios -q` |
| Vitest/Jest | Vitest + `fetch` | `BASE_URL=… npx vitest run tests/scenarios` |
| none of the above | Hurl | `hurl --variable base_url=… --test tests/scenarios/*.hurl` |

## pytest + httpx (the reference shape)

```python
# tests/scenarios/conftest.py
import os, uuid, httpx, pytest

BASE = os.environ["BASE_URL"]

@pytest.fixture
def run_id():
    return uuid.uuid4().hex[:6]

@pytest.fixture
def client():
    with httpx.Client(base_url=BASE, timeout=5) as c:
        yield c

def login(client, email, password):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
```

```python
# tests/scenarios/test_s2_pay_twice.py
from conftest import login

def test_s2_pay_twice_is_refused(client, run_id):
    h = login(client, "alice@test.io", "pw-alice")                       # step 1
    order_id = None
    try:
        r = client.post("/orders", json={"items": [{"sku": "SKU-1", "qty": 1}]}, headers=h)
        assert r.status_code == 201, r.text                               # step 2
        order_id = r.json()["id"]
        assert r.json()["status"] == "CREATED"

        r = client.post(f"/orders/{order_id}/pay", headers=h)
        assert (r.status_code, r.json()["status"]) == (200, "PAID"), r.text   # step 3

        r = client.post(f"/orders/{order_id}/pay", headers=h)
        assert r.status_code == 409, r.text                               # step 4
        assert "cannot pay" in r.json()["error"]

        r = client.get(f"/orders/{order_id}", headers=h)
        assert r.json()["status"] == "PAID"                               # step 5: no side effect
    finally:
        if order_id:
            client.delete(f"/orders/{order_id}", headers=h)
```

Every runner keeps this shape: login helper, capture into a local, assert with the response
text in the message, cleanup in `finally` with the captured id.

## RestAssured (JVM)

```kotlin
// src/test/kotlin/scenarios/S2PayTwiceScenarioTest.kt
class S2PayTwiceScenarioTest {
    private val base = System.getenv("BASE_URL") ?: error("BASE_URL not set")

    @Test
    fun `S2 pay twice is refused`() {
        val token = given().baseUri(base).contentType(JSON)
            .body("""{"email":"alice@test.io","password":"pw-alice"}""")
            .post("/auth/login").then().statusCode(200).extract().path<String>("token")
        val auth = given().baseUri(base).header("Authorization", "Bearer $token").contentType(JSON)

        val orderId = auth.body("""{"items":[{"sku":"SKU-1","qty":1}]}""")
            .post("/orders").then().statusCode(201).body("status", equalTo("CREATED"))
            .extract().path<String>("id")
        try {
            auth.post("/orders/$orderId/pay").then().statusCode(200).body("status", equalTo("PAID"))
            auth.post("/orders/$orderId/pay").then().statusCode(409).body("error", containsString("cannot pay"))
            auth.get("/orders/$orderId").then().body("status", equalTo("PAID"))
        } finally {
            auth.delete("/orders/$orderId")
        }
    }
}
```

## Hurl (no test stack)

```hurl
# tests/scenarios/s2_pay_twice.hurl
POST {{base_url}}/auth/login
{"email":"alice@test.io","password":"pw-alice"}
HTTP 200
[Captures]
token: jsonpath "$.token"

POST {{base_url}}/orders
Authorization: Bearer {{token}}
{"items":[{"sku":"SKU-1","qty":1}]}
HTTP 201
[Captures]
order_id: jsonpath "$.id"
[Asserts]
jsonpath "$.status" == "CREATED"

POST {{base_url}}/orders/{{order_id}}/pay
Authorization: Bearer {{token}}
HTTP 200

POST {{base_url}}/orders/{{order_id}}/pay
Authorization: Bearer {{token}}
HTTP 409
[Asserts]
jsonpath "$.error" contains "cannot pay"

GET {{base_url}}/orders/{{order_id}}
Authorization: Bearer {{token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "PAID"

DELETE {{base_url}}/orders/{{order_id}}
Authorization: Bearer {{token}}
HTTP 204
```

Hurl has no `finally`; cleanup is the last entry and a failed assert stops before it. Use the
namespace prefix as the real cleanup and say so in the spec README.

## Running twice

```
BASE_URL=http://localhost:8080 pytest tests/scenarios -q   # run 1
BASE_URL=http://localhost:8080 pytest tests/scenarios -q   # run 2, same server process
```

Run 2 failing where run 1 passed means a scenario left state behind: a fixed email, a
non-namespaced name with a uniqueness constraint, a cleanup that didn't run. The fix is in the
namespace or the finally block, not in restarting the server before CI.
