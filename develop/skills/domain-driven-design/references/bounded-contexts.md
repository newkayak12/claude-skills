# Bounded Contexts and Context Maps

A bounded context is the region in which one model, with one consistent vocabulary, holds. Outside it, the same word may legitimately mean something else.

## Why split

A single enterprise-wide model collects every team's special cases. `Product` ends up with catalog fields, warehouse dimensions, tax codes and pricing tiers; every change risks every consumer. Giving each concern its own model keeps each one small and each team free to change it.

## Finding the lines

- Language shifts: the same term with different rules or attributes.
- Different experts, different vocabularies, different rates of change.
- Different consistency or availability needs (checkout vs. reporting).
- Team ownership: a context should fit within one team's head.
- Start from the process view (event storming timelines) and cut where the pivotal events change meaning.

A context may be a package, a module or a service. A context is a model boundary, not a deployment unit; services are one way to enforce it.

## Relationship patterns

| Pattern | Situation | Consequence |
|---|---|---|
| Partnership | Two teams succeed or fail together | Coordinated planning, joint integration tests |
| Shared Kernel | Small, jointly owned model slice | Changes need both teams; keep tiny |
| Customer-Supplier | Downstream needs shape upstream's plan | Negotiated contract, acceptance tests |
| Conformist | Upstream will not listen | Downstream adopts upstream model as is |
| Anti-Corruption Layer | Upstream model is foreign or messy | Downstream translates at the edge |
| Open Host Service | Many consumers of one upstream | Stable protocol, versioned |
| Published Language | Shared interchange format | Documented schema both sides map to |
| Separate Ways | Integration costs more than it gives | No link; duplicate small bits |

## Anti-Corruption Layer sketch

```kotlin
// Domain-side port, expressed in our language
interface CreditCheck { fun isEligible(applicant: ApplicantId): Boolean }

// Adapter translates the vendor's vocabulary
class BureauCreditCheck(private val client: BureauClient) : CreditCheck {
    override fun isEligible(applicant: ApplicantId) =
        client.fetchScore(applicant.value).band in setOf("A", "B")   // vendor "band" -> our rule
}
```

The foreign type (`BureauClient` response) never leaves the adapter.

## Choosing

1. Can we change upstream? If yes, customer-supplier or partnership.
2. Is the upstream model good enough for us? If yes, conformist is cheapest.
3. Otherwise ACL. Legacy systems nearly always deserve one.
4. Several consumers: one open host with a published language.

## Mapping and drift

- Draw the map as boxes (contexts) and labeled arrows (upstream/downstream with the pattern).
- Team boundaries and context boundaries tend to converge; map them together and fix mismatches deliberately.
- Revisit when ownership changes or a context grows past what one team can hold. Splitting later is cheap if the translation points were already explicit.
