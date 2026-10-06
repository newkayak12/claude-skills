# Ktor Server

Examples assume Ktor 3.x with the `Netty` engine, `kotlinx.serialization`, and Exposed. Check plugin names against your Ktor version when upgrading.

## Entry point and modules

```kotlin
fun main(args: Array<String>) = EngineMain.main(args)   // reads application.conf / application.yaml

fun Application.module() {
    install(ContentNegotiation) { json() }
    install(StatusPages) { configureErrors() }
    configureSecurity()
    configureRouting()
}
```

Split features into `Application.xxx()` extension functions and list them in the config file's `ktor.application.modules`. Tests can then load only the modules they need.

## Routing

```kotlin
fun Application.configureRouting(service: InvoiceService = InvoiceService()) = routing {
    route("/invoices") {
        get { call.respond(service.list()) }
        get("{id}") {
            val id = call.parameters["id"]?.toLongOrNull()
            if (id == null) call.respond(HttpStatusCode.BadRequest, ApiError("id must be numeric"))
            else service.find(id)?.let { call.respond(it) } ?: call.respond(HttpStatusCode.NotFound)
        }
        post {
            val body = call.receive<CreateInvoice>()
            call.respond(HttpStatusCode.Created, service.create(body))
        }
    }
}
```

- Handlers are suspend functions; keep them thin and call a service class.
- Pass dependencies through constructor or function parameters; a DI library (Koin) is optional, not required.
- `@Serializable data class` for request and response bodies; mark optional fields with defaults.

## Error mapping

```kotlin
fun StatusPagesConfig.configureErrors() {
    exception<IllegalArgumentException> { call, e -> call.respond(HttpStatusCode.BadRequest, ApiError(e.message ?: "invalid")) }
    exception<NotFoundException>        { call, _ -> call.respond(HttpStatusCode.NotFound, ApiError("not found")) }
    exception<Throwable>                { call, e -> call.application.log.error("unhandled", e)
                                                     call.respond(HttpStatusCode.InternalServerError, ApiError("internal error")) }
}
```

Never put exception messages from unknown throwables in the response body.

## Authentication with JWT

```kotlin
fun Application.configureSecurity() {
    val cfg = environment.config
    install(Authentication) {
        jwt("api") {
            realm = "api"
            verifier(JWT.require(Algorithm.HMAC256(cfg.property("jwt.secret").getString()))
                .withIssuer(cfg.property("jwt.issuer").getString()).build())
            validate { c -> if (c.payload.getClaim("sub").asString()?.isNotBlank() == true) JWTPrincipal(c.payload) else null }
        }
    }
}
// usage
authenticate("api") { get("/me") { call.respond(call.principal<JWTPrincipal>()!!.payload.subject) } }
```

Secrets come from configuration or the environment, not source code. Prefer asymmetric keys (RS256) when other services verify the tokens.

## Persistence with Exposed

The snippet uses the pre-1.0 (0.5x) API. Exposed 1.0 moved to `org.jetbrains.exposed.v1.*` packages and renamed parts of the transaction API, so check the migration notes for your version.

```kotlin
object Invoices : LongIdTable("invoices") {
    val customer = varchar("customer", 120)
    val cents = long("cents")
}

suspend fun <T> inTx(work: suspend Transaction.() -> T): T = newSuspendedTransaction(Dispatchers.IO) { work() }

suspend fun total(customer: String): Long = inTx {
    Invoices.select(Invoices.cents.sum()).where { Invoices.customer eq customer }
        .singleOrNull()?.get(Invoices.cents.sum()) ?: 0L
}
```

- Exposed 1.0 and later publish under the `org.jetbrains.exposed.v1.*` packages (split into modules such as core and jdbc); earlier versions use `org.jetbrains.exposed.*`. Match imports, and the transaction type in `inTx`, to the version you depend on.
- Use a pooled `DataSource` (HikariCP) and `Database.connect(dataSource)`.
- Run schema changes through a migration tool (Flyway or Liquibase), not `SchemaUtils.create` in production.
- Never run blocking JDBC on the event-loop threads; the `Dispatchers.IO` transaction above avoids that.

## WebSockets

```kotlin
install(WebSockets) { pingPeriod = 15.seconds }
routing {
    webSocket("/feed") {
        for (frame in incoming) if (frame is Frame.Text) send(Frame.Text("ack: ${frame.readText()}"))
    }
}
```

The loop ends when the client closes; cleanup goes in a `finally` block. For broadcast, keep sessions in a concurrent collection or use a `SharedFlow`.

## CORS and other plugins

`install(CORS) { allowHost("app.example.com", schemes = listOf("https")); allowHeader(HttpHeaders.ContentType) }`. Avoid `anyHost()` outside local development. `CallLogging`, `Compression`, `RateLimit`, and `DefaultHeaders` follow the same install pattern.

## Testing

```kotlin
@Test fun `unknown invoice is 404`() = testApplication {
    application { module() }
    val res = client.get("/invoices/999")
    assertEquals(HttpStatusCode.NotFound, res.status)
}
```

For JSON bodies, build the test client with `createClient { install(ContentNegotiation) { json() } }`. Replace external dependencies by passing fakes into the module function.
