# Manual Reader Testing Protocol

Use this protocol when sub-agents are not available (e.g., claude.ai web interface). The user performs the testing manually.

## Step 1: Predict Reader Questions

Ask what questions people might ask when trying to discover this document. What would they type into Claude.ai?

Generate 5-10 questions that readers would realistically ask.

## Step 2: Setup Testing

Provide testing instructions:
1. Open a fresh Claude conversation: https://claude.ai
2. Paste or share the document content (if using a shared doc platform with connectors enabled, provide the link)
3. Ask Reader Claude the generated questions

For each question, instruct Reader Claude to provide:
- The answer
- Whether anything was ambiguous or unclear
- What knowledge/context the doc assumes is already known

Check if Reader Claude gives correct answers or misinterprets anything.

## Step 3: Additional Checks

Also ask Reader Claude:
- "What in this doc might be ambiguous or unclear to readers?"
- "What knowledge or context does this doc assume readers already have?"
- "Are there any internal contradictions or inconsistencies?"

## Step 4: Iterate Based on Results

Ask what Reader Claude got wrong or struggled with. Indicate intention to fix those gaps.

Loop back to refinement for any problematic sections.
