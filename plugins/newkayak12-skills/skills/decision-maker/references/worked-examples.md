# Worked Examples

Concrete decision walkthroughs using the frameworks from the decision-maker skill.

---

## Example 1: Microservices vs Monolith

**Situation:** 8-person team, new product, unclear domain boundaries.

**Decision weight:** One-way door (splitting later is expensive).

**Key criteria:**
- Team size and operational capacity
- Domain clarity
- Time to first production deployment
- Expected traffic scale (Year 1)

**Analysis:** Small team + unclear domain = monolith wins. Microservices add deployment, observability, and network complexity the team can't absorb yet. Domain boundaries can be enforced internally via modules.

**Recommendation:** Start with a modular monolith. Extract services only when: (a) a module has genuinely independent scaling needs, or (b) team grows past 25 and ownership boundaries are clear.

---

## Example 2: Redis vs In-Process Cache

**Situation:** Need caching for a read-heavy API; single server today, may scale horizontally.

**Decision weight:** Two-way door (swappable in a week if wrong).

**Pros/cons:**

| | Redis | In-Process (Caffeine/LRU) |
|-|-------|--------------------------|
| + | Shared cache across instances | Zero network latency |
| + | TTL, eviction, pub/sub built-in | No infra to manage |
| - | Network hop (~1ms) | Cache incoherence when scaled |
| - | Another service to operate | Memory bounded per instance |

**Recommendation:** In-process cache now; add Redis when horizontal scaling is confirmed. Don't pay operational cost for a problem you don't have yet.

---

## Example 3: REST vs GraphQL

**Situation:** Internal API serving 2 known client types (web, mobile).

**Criteria (weighted):**
- Developer experience for known clients (35)
- Backend team GraphQL experience (25)
- Client-driven query flexibility (20)
- Tooling maturity (20)

**Analysis:** With 2 known clients and no GraphQL expertise, REST wins clearly. GraphQL's flexibility benefit requires expertise to capture; without it, you get the complexity without the payoff.

**Recommendation:** REST with versioned endpoints. Revisit GraphQL if client count exceeds 5 and over-fetching/under-fetching becomes a real observed problem.
