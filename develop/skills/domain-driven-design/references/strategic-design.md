# Strategic Design

Decide where deep modeling effort pays off before modeling anything in detail.

## Subdomain types

| Type | Question | Treatment |
|---|---|---|
| Core | Does this make customers choose us over rivals? | Best people, rich model, built in-house |
| Supporting | Needed, specific to us, not differentiating | Simple model, modest investment, could be outsourced |
| Generic | Same for every company (auth, payments, email) | Buy or adopt open source, wrap behind a port |

## Classifying

- Differentiation: would a competitor copying this hurt us?
- Outsourcing: could an outside team build it from a spec without losing advantage?
- Rate of change: core logic keeps being revised by the business.
- Watch for misclassification: engineers love building generic things (a custom workflow engine) and underinvest in the true core.
- Classification moves over time. Today's core can become commodity; a bought component can become the differentiator.

## Distillation

- Domain vision statement: a page describing the core's value and what it does for whom, short enough to reread each quarter.
- Highlighted core: a short list of the central concepts and flows, kept visible to everyone.
- Segregated core: move the core model into its own module or package, with generic and supporting code depending on it or isolated from it, so core code is not tangled with plumbing.
- Abstract core: when many modules share a few fundamental interfaces, lift them into a small shared core.

```
domain/pricing/        <- deep model, heavy tests
domain/fulfilment/     <- supporting, plain
infrastructure/email/  <- generic adapter
```

## Build, buy or outsource

1. Core: build; the cost is the point.
2. Generic: buy; counting only subscription cost misses the cost of maintaining your own.
3. Supporting: lean building, or outsource with a clear contract.
Hidden costs of buying: integration code, model leakage (use an ACL), vendor lock-in.

## Teams

- Allocate strongest engineers and domain-expert time to the core.
- Structure follows communication: align team boundaries with contexts; a mismatch will show up as coupling in the code.
- Revisit allocation at planning time as subdomains shift.

## Anti-patterns

- Every context gets the same rigor (tactical DDD everywhere, including CRUD).
- Core work starved by platform ambition.
- Buying a generic tool, then bending the domain to its vocabulary.
- Strategic labels assigned once and never revisited.
