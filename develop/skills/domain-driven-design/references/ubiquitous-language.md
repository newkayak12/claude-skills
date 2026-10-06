# Ubiquitous Language

One vocabulary, spoken by experts and developers alike, and visible in code. If the two groups need a translation table, the model is already drifting.

## Where the vocabulary comes from

- Sit with the people who do the work; write down the nouns and verbs they use unprompted.
- When an expert corrects your phrasing, that correction is data: update the glossary first, the code second.
- Sketch scenarios on a whiteboard, then try to code the same scenario. Friction in the code usually means a missing or misnamed concept.
- Treat each word as local to one context. "Account" in billing and "Account" in identity are different terms; do not force a merge.

## Getting it into code

| Artifact | Rule | Instead of |
|---|---|---|
| Type | Business noun | `RequestHandler` |
| Function | Business verb, intention-revealing | `process()`, `handle()` |
| Event | Past-tense fact | `DataSaved` |
| Package | Business capability | `controllers/`, `utils/` |

```kotlin
// Reads like the business sentence "a policy is underwritten by an underwriter"
class Policy(val id: PolicyId, private var status: PolicyStatus) {
    fun underwrite(by: UnderwriterId, at: Instant): PolicyUnderwritten { /* ... */ }
}
```

Smell words: `Manager`, `Helper`, `Processor`, `Util`, `Data`, `Info`. Each hides a concept nobody named yet.

## Glossary upkeep

- Keep it in the repository (a markdown file per context), changed in the same PR as the code that renames things.
- Entry shape: term, one-sentence definition, an example, words that are NOT synonyms.
- Conflicting terms between teams signal a context boundary, not a naming dispute.
- Rename in code when the language moves; leaving stale names creates the translation tax again.

## Reading names as design feedback

- A clumsy name often means the concept is missing. If the experts say "write-off" and you have `status = 7`, extract `WriteOff`.
- A precise name restricts misuse: `ApprovedQuote` cannot be passed where a draft is expected.
- Two groups using one word differently marks where one model ends and another begins.

## Traps

- Jargon: engineer-only terms leaking into the domain layer.
- Abbreviations the business never uses.
- Synonym drift: `Customer`, `Client`, `User` for the same thing in one context. Pick one.
- Persistence-shaped names: table or column names becoming class names.
