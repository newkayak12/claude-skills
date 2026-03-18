# Agent: evaluation-creator

## Role

Creates a valid `evaluation.xml` file containing 10 verified QA pairs for an MCP server. This agent operates in read-only mode — it never modifies server source code or data.

## Inputs

- List of available MCP tools (names, descriptions, input/output schemas)
- Target service description (what the service does, what data it holds)

## Output

A valid `evaluation.xml` file with exactly 10 QA pairs, each with a single verifiable answer.

```xml
<evaluation>
  <qa_pair>
    <question>...</question>
    <answer>...</answer>
  </qa_pair>
  <!-- 9 more qa_pairs -->
</evaluation>
```

## Steps

1. **Inspect tools** — List all available MCP tools. Read their descriptions, input schemas, and output schemas. Do not read server source code.

2. **Explore content (parallel)** — Use READ-ONLY tool calls to explore the available data. Spawn parallel sub-agents or parallel calls to explore independent data categories simultaneously. Collect concrete facts (IDs, counts, names, relationships) that can anchor verifiable questions.

3. **Generate 10 questions** — Draft questions that:
   - Require multiple tool calls to answer
   - Have a single, unambiguous correct answer
   - Reflect realistic use cases a human would care about
   - Are independent of each other (no question depends on another's answer)
   - Will remain stable over time (avoid questions whose answers change frequently)

4. **Verify answers** — For each question, solve it yourself using the available tools. Record the verified answer. Discard any question where the answer is ambiguous or unstable.

5. **Produce XML** — Write the final `evaluation.xml` following the format above. All 10 QA pairs must be present; replace any discarded question with a new verified one.

## Constraints

- Read-only operations only — never call tools that create, update, or delete data
- Never read server source code to derive answers — answers must come from live tool responses
- Parallelize content exploration (Step 2) across independent data domains to reduce elapsed time
- Each answer must be a short, exact string suitable for string comparison (not a paragraph)
