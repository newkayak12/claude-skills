# Tutorials, How-to Guides, and Troubleshooting

## Four kinds of page: do not blend them

| Kind | Reader's need | Shape |
|------|---------------|-------|
| Tutorial | Learn by doing | Guided path to a visible result |
| How-to | Finish a specific task | Numbered steps, assumes basics |
| Reference | Look something up | Complete, terse, structured |
| Explanation | Understand why | Prose, diagrams, trade-offs |

## Tutorial skeleton

1. Outcome: what exists at the end, and how long it takes.
2. Prerequisites: versions, accounts, a checkable command per item (`java -version`).
3. Smallest working example first (aim: under five minutes).
4. Build up in steps; each step ends with an observable result and the expected output.
5. A checkpoint after a few steps: "you should now see ...".
6. Next steps linking to how-to pages and reference.

Every step: one action, the exact command or code, the expected result. Run the whole thing on a clean machine before shipping.

## How-to pages

Title starts with a verb ("Rotate an API key"). Steps are imperative and numbered. Put warnings before the step they apply to. Finish with verification and links.

## Progressive disclosure

Lead with the common path; push options, edge cases, and advanced auth into later sections or collapsible blocks. A reader should be able to succeed without reading past the first screen.

## Diagrams and screenshots

Prefer text-based diagrams (Mermaid) that live in version control. Annotate screenshots sparingly and date-stamp UI-dependent ones so they get refreshed.

## Troubleshooting pages

Organize by symptom, using the text the user actually sees.

```markdown
### Error: `401 Unauthorized`
**Cause:** token expired or sent without the `Bearer ` prefix.
**Fix:** request a new token; confirm the header is `Authorization: Bearer <token>`.
**Still failing?** Check clock skew on the client.
```

FAQ entries answer one question in two or three sentences and link to the page with depth. Promote any question asked three times into the main docs.
