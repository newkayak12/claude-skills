# Comments and Formatting

## Stance on comments

Code is the primary documentation; a comment is what remains when code cannot carry the
meaning. Comments also rot: nothing forces them to change when the code does, so every
one is a liability that must justify itself. The cheapest fix for a confusing block is
usually renaming or extracting, not annotating.

## Comments worth keeping

| Kind | Why it earns its place |
|------|------------------------|
| Reason or trade-off | Explains a choice no reader could infer: `// PG returns rows unsorted without ORDER BY; the UI expects newest first` |
| External constraint | Points at a spec, ticket or vendor quirk |
| Warning | Tells the next editor what breaks: `// not thread-safe; callers hold the lock` |
| Regex or format gloss | Decodes dense syntax a reader cannot parse at a glance |
| Public API docs (KDoc) | Contract for callers who will not read the body |
| Tracked TODO | Carries an owner or ticket id so it can be found and closed |
| Legal header | Required by licence; keep it short |

## Comments to remove or fix

- **Echoes:** `i++ // increment i`. Delete.
- **Lies:** says "clamped to zero" while the code does not clamp. This is a correctness
  finding; fix the code or the comment, and treat on a gated path as blocking.
- **Stale history:** change logs, author tags and dates in the file. Version control
  already records them.
- **Dead code in comments:** delete it; `git log` remembers.
- **Banners and closing-brace labels:** a sign the function is too long.
- **Rambling:** if a comment is hard to write clearly, the code is probably unclear.
- **Mandatory boilerplate** on every field or method, where the doc adds no information.

Rewriting instead of commenting:

```kotlin
// before
// employee is eligible for full benefits
if (e.hoursPerWeek >= 30 && e.tenureMonths >= 3) { ... }

// after
if (e.isEligibleForFullBenefits()) { ... }
```

## Formatting

Format for the reader scanning, not for the compiler. Take decisions out of review by
letting a tool enforce them (ktlint, spotless, Prettier, gofmt); a style debate in a PR is
a missing config.

**Vertical**
- Blank lines separate ideas; related lines stay together.
- Declare variables near first use; keep instance fields in one predictable place.
- A caller sits above its callee when possible.
- Files should be small enough to hold in mind; thousands of lines mean several concepts.

**Horizontal**
- Hold lines to a team-agreed width (100 to 120 columns is common).
- Use spaces around operators of lower precedence, none around higher, to hint at grouping.
- Do not align columns of declarations by padding: it draws the eye to the wrong thing
  and creates noisy diffs.
- Indent consistently; never collapse a block onto one line to save space.

## Checklist when reviewing a change

1. Does each added comment say something the code cannot?
2. Does each comment match what the code actually does today?
3. Was any code commented out rather than deleted?
4. Does the diff follow the formatter, or hand-format around it?
