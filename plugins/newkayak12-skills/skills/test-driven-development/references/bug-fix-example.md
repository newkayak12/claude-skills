# Bug Fix Example: Full TDD Walkthrough

## Scenario: Empty Email Accepted

**Bug:** Form accepts empty email address, causing downstream failures.

---

### RED — Write Failing Test

```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```

---

### Verify RED — Watch It Fail

```bash
$ npm test
FAIL: expected 'Email required', got undefined
```

Failure is expected: the feature is missing. The test is testing the right thing.

---

### GREEN — Minimal Implementation

```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
  // ...
}
```

---

### Verify GREEN — Watch It Pass

```bash
$ npm test
PASS
```

---

### REFACTOR

Extract validation for multiple fields if needed. Keep tests green throughout.
