# Seeing What the System Does

Goal: answer a question you did not predict, about one request, quickly.

## Signals
| Signal | Answers | Watch out |
|---|---|---|
| Metrics | Is it healthy, how much, how fast | Unbounded label values (user id) explode cardinality |
| Logs | What happened in this component | Unstructured text cannot be queried |
| Traces | Where did this request spend time and fail | Sampling hides rare cases |

## Correlation
- Use W3C Trace Context (`traceparent` header) for propagation across HTTP and put the trace id in message headers too.
- Spring Boot 3 with Micrometer Tracing and the OpenTelemetry bridge propagates context for supported clients; confirm your message producers and async executors carry it.
- Log JSON with trace id, span id, service, and a business key (order id). Put the trace id in error responses so support can find the request.
- Never log secrets or personal data; mask at the logger.

## Metrics worth having per service
Request rate, error rate, latency histogram (not just average), saturation (pool usage, queue depth, consumer lag), plus business counters (orders placed). In Spring Boot, Micrometer provides HTTP server and client timers out of the box; expose to Prometheus via Actuator.

## Tracing
- Instrument edges automatically; add manual spans around meaningful business steps only.
- Head sampling is cheap but may drop the interesting traces; tail sampling keeps errors and slow ones at the cost of a collector holding traces briefly.
- Messages: link the consumer span to the producer span rather than making it a long child.

## SLOs
- SLI: a ratio of good events to valid events (non-5xx responses, requests under a latency threshold).
- SLO: target over a window, e.g. 99.9% over 30 days.
- Error budget: 1 minus the target. At 99.9% over 30 days it is roughly 43 minutes of full outage-equivalent. Spend it on releases; when exhausted, slow feature work and fix reliability.
- Define SLOs from the user journey, then derive per-service targets that compose (a chain of services is less available than any one).

## Alerting
- Page on symptoms users feel (burn rate of the error budget, over a fast and a slow window) rather than on causes like CPU.
- Every page needs a runbook link and an owner; tickets for slow-burn issues.
- Remove alerts that nobody acts on.

## Debugging flow
1. Alert or user report names a symptom and time.
2. Check the golden signals on the entry service; find which downstream changed.
3. Open a slow or failed trace; locate the span with the error or the gap.
4. Jump to logs by trace id in that service.
5. Correlate with recent deploys, config or flag changes.
6. Record findings; add the missing signal if this took too long.

## Delivery readiness
Dashboards per service from templates, trace propagation verified in staging, and a synthetic check on each critical journey before a service goes live.
