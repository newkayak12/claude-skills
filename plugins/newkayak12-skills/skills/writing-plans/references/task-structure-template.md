# Task Structure Template

Use this template for each task in the implementation plan. Every task follows the TDD cycle: write failing test → verify fail → implement → verify pass → commit.

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## Rules for Task Authoring

- **Exact file paths always** — no "add to the models file", use `src/models/user.py`
- **Complete code in plan** — not "add validation", write the actual validation code
- **Exact commands with expected output** — `pytest tests/... -v` → `Expected: PASS`
- **DRY, YAGNI, TDD, frequent commits** — one commit per passing test
