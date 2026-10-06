# Cloud-Native Concerns

Introduce Spring Cloud components one at a time, each against a concrete need. On Kubernetes, config maps, secrets, service DNS and ingress already replace several components below. Use the Spring Cloud release train whose version matches your Boot line, imported through its BOM.

## Centralized configuration

Config Server (`@EnableConfigServer` from `spring-cloud-config-server`) serves property files from a Git repo. Clients opt in with the import mechanism:

```yaml
spring:
  application:
    name: billing
  config:
    import: "optional:configserver:http://config:8888"
  cloud:
    config:
      fail-fast: true
```

`optional:` lets the service start without the server (local runs); drop it in production if the service cannot work with defaults. Files are resolved by application name and profile (`billing-prod.yml`). Encrypt stored secrets or, better, keep them in a secret manager and reference them by environment variable.

To change values without restart, mark beans `@RefreshScope`, expose the `refresh` actuator endpoint, and trigger it per instance (or broadcast with Spring Cloud Bus). Plain `@ConfigurationProperties` beans rebind on a refresh event without `@RefreshScope`.

## Discovery and client-side balancing

With Eureka, servers run `@EnableEurekaServer`; clients depend on `spring-cloud-starter-netflix-eureka-client` and register under `spring.application.name`. Callers use a logical name and a load-balanced client:

```java
@Bean
@LoadBalanced
RestClient.Builder lbRestClient() { return RestClient.builder(); }

lbRestClient.build().get().uri("http://inventory/stock/{sku}", sku).retrieve().body(Stock.class);
```

`@LoadBalanced` makes the builder resolve `inventory` through Spring Cloud LoadBalancer, which round-robins over discovered instances by default. In Kubernetes use the service DNS name and skip discovery.

## Gateway

Spring Cloud Gateway is a reactive edge router; routes are predicates plus filters.

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: orders
          uri: lb://orders
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 20
                redis-rate-limiter.burstCapacity: 40
```

The gateway is WebFlux-based, so it cannot share a module with a servlet MVC application; keep it as its own service. Authenticate at the edge, but still verify tokens in downstream services.

## Resilience

Remote calls fail slowly before they fail loudly. Bound them with Resilience4j through `resilience4j-spring-boot3`:

```java
@Service
class ShippingClient {
    @CircuitBreaker(name = "shipping", fallbackMethod = "quoteFallback")
    @Retry(name = "shipping")
    @TimeLimiter(name = "shipping")          // requires CompletableFuture return type
    CompletableFuture<Quote> quote(Parcel p) { ... }

    CompletableFuture<Quote> quoteFallback(Parcel p, Throwable t) {
        return CompletableFuture.completedFuture(Quote.estimate(p));
    }
}
```

```yaml
resilience4j:
  circuitbreaker:
    instances:
      shipping:
        slidingWindowSize: 20
        failureRateThreshold: 50
        waitDurationInOpenState: 15s
  retry:
    instances:
      shipping:
        maxAttempts: 3
        waitDuration: 200ms
```

Only retry idempotent operations. The fallback signature must match the original plus a trailing exception parameter. Annotation order and proxy semantics matter, so test the behaviour with a failing stub.

## Tracing and metrics

Boot 3 uses Micrometer Observation; Sleuth is gone. Add `micrometer-tracing-bridge-otel` (or the Brave bridge) and an exporter, then:

```yaml
management:
  tracing:
    sampling:
      probability: 0.1
logging:
  include-application-name: true
```

Trace context is propagated automatically by `RestClient`, `RestTemplate` and `WebClient` instances built from Boot's builders. Custom spans go through an injected `ObservationRegistry`. Metrics are exposed by `micrometer-registry-prometheus` at `/actuator/prometheus`.

## Actuator and probes

```yaml
management:
  endpoints:
    web:
      exposure:
        include: [health, info, prometheus]
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
```

On Kubernetes Boot detects the platform and exposes `/actuator/health/liveness` and `/actuator/health/readiness`. Liveness should say only that the process is not wedged; do not put a database check in it, or a database outage will restart every pod. Readiness may include dependencies. A custom indicator implements `HealthIndicator` and returns `Health.up()` or `Health.down().withDetail(...)`. Keep the management port or its authentication separate from public traffic.

## Packaging and deployment

Two-stage image with a non-root user:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
COPY . /src
WORKDIR /src
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:21-jre
RUN useradd -r app
USER app
COPY --from=build /src/target/*.jar /app/app.jar
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

Alternatively `./mvnw spring-boot:build-image` produces an OCI image with buildpacks, no Dockerfile needed.

```yaml
# deployment fragment
containers:
  - name: billing
    image: registry.example.com/billing:1.4.2
    ports: [{containerPort: 8080}]
    envFrom: [{secretRef: {name: billing-secrets}}]
    resources:
      requests: {cpu: 250m, memory: 512Mi}
      limits: {memory: 768Mi}
    readinessProbe:
      httpGet:
        port: 8080
        path: /actuator/health/readiness
    livenessProbe:
      httpGet:
        port: 8080
        path: /actuator/health/liveness
```

Enable `server.shutdown=graceful` and set `spring.lifecycle.timeout-per-shutdown-phase` so in-flight requests finish before a pod stops.
