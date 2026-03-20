# Fallback Patterns Reference

Design fallbacks deliberately — they represent your service's degraded-but-functional behavior.

---

## Fallback Strategy Selection

| Strategy | When to Use | Example |
|----------|------------|---------|
| **Cached response** | Data changes infrequently; stale is acceptable | Return last-known product price |
| **Default value** | Empty/neutral response is acceptable | Return empty recommendation list |
| **Throw specific exception** | Caller can handle the failure explicitly | Throw `ServiceUnavailableException` |
| **Queue for retry** | Eventually-consistent operations | Enqueue notification for later delivery |
| **Static response** | Critical UX must not break | Return "service temporarily unavailable" with retry-after header |

---

## Resilience4j Fallback — Spring Boot Example

```java
// Resilience4j fallback in Spring Boot
@CircuitBreaker(name = "payment-service", fallbackMethod = "paymentFallback")
public PaymentResult charge(PaymentRequest request) {
    return paymentClient.charge(request);
}

// Fallback receives the exception for logging/differentiation
private PaymentResult paymentFallback(PaymentRequest request, Exception ex) {
    log.warn("Payment service unavailable, queuing for retry: {}", ex.getMessage());
    retryQueue.enqueue(request);
    return PaymentResult.pending(request.getOrderId());
}
```

Key points:
- The fallback method must have the same return type as the primary method.
- It receives the original arguments plus the exception that triggered the fallback.
- Log the exception in the fallback so the cause is not silently swallowed.
- Return a meaningful degraded value, not `null`.

---

## No-Fallback Is Still an Option

A circuit breaker without a fallback throws an exception when OPEN. That is better than a 30-second timeout, but a meaningful fallback provides a degraded-but-useful response. Only omit fallbacks when there is genuinely no acceptable degraded behavior (e.g., a payment where queuing is not possible).
