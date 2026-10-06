# Web Layer

## Controller shape

A controller translates HTTP to a service call and back. It holds no business rules and no transaction.

```java
@RestController
@RequestMapping("/v1/tickets")
class TicketController {
    private final TicketService tickets;

    TicketController(TicketService tickets) { this.tickets = tickets; }

    @GetMapping("/{id}")
    TicketResponse get(@PathVariable long id) {
        return tickets.find(id);
    }

    @PostMapping
    ResponseEntity<TicketResponse> open(@Valid @RequestBody OpenTicketRequest body,
                                        UriComponentsBuilder uri) {
        TicketResponse created = tickets.open(body);
        return ResponseEntity
            .created(uri.path("/v1/tickets/{id}").build(created.id()))
            .body(created);
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> close(@PathVariable long id) {
        tickets.close(id);
        return ResponseEntity.noContent().build();
    }
}
```

- Status codes: 201 plus `Location` for creation, 204 for empty success, 404 for a missing resource, 409 for a state conflict, 422 or 400 for rejected input.
- Pageable endpoints take `Pageable` as a parameter and return `Page<T>` mapped to a response record; never return the `Page<Entity>` itself.
- Version the path (`/api/v1`) or a header, and decide which one once for the whole service.

## DTOs

Entities stay behind the service boundary. Requests and responses are records.

```java
public record OpenTicketRequest(
    @NotNull Long reporterId,
    @NotEmpty List<@Valid Item> items,
    @Size(max = 200) String note
) {
    public record Item(@NotBlank String sku, @Positive int quantity) {}
}

public record TicketResponse(long id, String status, Instant openedAt) {
    static TicketResponse from(Ticket t) {
        return new TicketResponse(t.getId(), t.getStatus().name(), t.getOpenedAt());
    }
}
```

Jakarta Validation lives in `jakarta.validation.constraints` in Boot 3. `@Valid` on a nested element cascades into it.

## Validation

- `@Valid` on `@RequestBody` fails with `MethodArgumentNotValidException`.
- Constraints on `@PathVariable` / `@RequestParam` need `@Validated` on the class and fail with `ConstraintViolationException` (Spring 6.1+ built-in method validation raises `HandlerMethodValidationException` instead when the class is not annotated).
- A rule spanning two fields can be an `@AssertTrue` method on the record; reusable rules deserve a custom `@Constraint` annotation with a `ConstraintValidator`.

```java
public record Booking(@NotNull LocalDate start, @NotNull LocalDate end) {
    @AssertTrue(message = "end must not precede start")
    boolean isRangeValid() {
        return start == null || end == null || !end.isBefore(start);
    }
}
```

## One place for errors

Return RFC 9457 problem details. Boot enables them with `spring.mvc.problemdetails.enabled=true`, and a `@RestControllerAdvice` extending `ResponseEntityExceptionHandler` covers the framework's own exceptions.

```java
@RestControllerAdvice
class ApiErrors extends ResponseEntityExceptionHandler {

    @ExceptionHandler(TicketNotFoundException.class)
    ProblemDetail notFound(TicketNotFoundException e) {
        ProblemDetail p = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());
        p.setTitle("Ticket not found");
        return p;
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail p = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            errors.putIfAbsent(fe.getField(), String.valueOf(fe.getDefaultMessage()));
        }
        p.setProperty("errors", errors);
        return handleExceptionInternal(ex, p, headers, HttpStatus.BAD_REQUEST, request);
    }

    @ExceptionHandler(RuntimeException.class)
    ProblemDetail unexpected(Exception e) {
        log.error("unhandled", e);
        return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected error");
    }
}
```

Never put stack traces or exception messages from infrastructure code into the body of a 500.

## Calling other services

`RestClient` (Spring 6.1+) is the synchronous choice; `WebClient` is for reactive pipelines. Build from the injected `RestClient.Builder` so Boot's customizers apply.

```java
@Bean
RestClient inventoryClient(RestClient.Builder b) {
    return b.baseUrl("http://inventory")
            .defaultStatusHandler(HttpStatusCode::is5xxServerError,
                (req, res) -> { throw new UpstreamUnavailableException(res.getStatusCode()); })
            .build();
}

Stock stock = inventoryClient.get().uri("/stock/{sku}", sku).retrieve().body(Stock.class);
```

Set both a connect and a read timeout on the underlying request factory; a caller left on defaults can wait far longer than a user will.

## CORS

Prefer one central definition tied to Spring Security (`http.cors(Customizer.withDefaults())` plus a `CorsConfigurationSource` bean). List explicit origins; `allowCredentials(true)` cannot be combined with a wildcard origin.

```java
@Bean
CorsConfigurationSource cors() {
    CorsConfiguration c = new CorsConfiguration();
    c.setAllowedOrigins(List.of("https://app.example.com"));
    c.setAllowedMethods(List.of("GET", "POST", "PATCH"));
    c.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    c.setMaxAge(Duration.ofHours(1));
    UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/api/**", c);
    return src;
}
```

## Checklist

- Every mutating endpoint validates its body.
- No entity crosses the controller boundary.
- Errors share one shape.
- Every outbound call is bounded in time.
