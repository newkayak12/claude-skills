#!/usr/bin/env python3
"""
Frozen prose 6-gram containment overlap metric.

Measures how much of a rewritten skill's prose is still verbatim-contained in
an upstream source, so a rewrite can be driven strictly below a containment
threshold (see CURATION.md cluster B) without the metric itself moving under
the rewrite's feet.

Usage:
    python3 scripts/prose_overlap.py <new_file> <upstream_file>

Prints a single containment percentage (float, one line) to stdout:

    containment = |grams(new) ∩ grams(upstream)| / |grams(new)| * 100

Tokenization (frozen — do not change without re-baselining every prior
overlap measurement in CURATION.md):
  1. Delete the leading YAML frontmatter block (first '---' line through the
     next '---' line inclusive).
  2. Delete every fenced code block (lines from an opening ``` fence through
     its closing ``` fence inclusive).
  3. Drop every line whose left-stripped text starts with '|' (markdown
     table rows).
  4. Lowercase, extract tokens via regex [a-z0-9]+ over the whole remaining
     text, in document order.
  5. Form the set of contiguous 6-token grams.
  6. containment = |grams(new) ∩ grams(upstream)| / |grams(new)| * 100

This intentionally strips code fences and pipe-delimited table rows from
both sides identically — code samples and tables are not "prose" for this
metric. The only lever that moves the score is re-expressing prose text
itself.
"""

import re
import sys

TOKEN_RE = re.compile(r"[a-z0-9]+")
GRAM_SIZE = 6


def strip_frontmatter(lines):
    """Delete the first '---' line through the next '---' line, inclusive."""
    if not lines or lines[0].rstrip("\n") != "---":
        return lines
    for i in range(1, len(lines)):
        if lines[i].rstrip("\n") == "---":
            return lines[i + 1:]
    # No closing '---' found — leave lines untouched (malformed frontmatter).
    return lines


def strip_code_fences(lines):
    """Delete every fenced code block, opening ``` through closing ``` inclusive."""
    out = []
    in_fence = False
    for line in lines:
        stripped = line.strip()
        is_fence = stripped.startswith("```")
        if is_fence:
            in_fence = not in_fence
            continue  # the fence line itself is always dropped
        if in_fence:
            continue
        out.append(line)
    return out


def strip_table_rows(lines):
    """Drop every line whose left-stripped text starts with '|'."""
    return [line for line in lines if not line.lstrip().startswith("|")]


def tokenize(text):
    return TOKEN_RE.findall(text.lower())


def grams(tokens, n=GRAM_SIZE):
    if len(tokens) < n:
        return set()
    return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def extract_grams(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    lines = strip_frontmatter(lines)
    lines = strip_code_fences(lines)
    lines = strip_table_rows(lines)
    text = "".join(lines)
    tokens = tokenize(text)
    return grams(tokens)


def containment(new_path, upstream_path):
    new_grams = extract_grams(new_path)
    upstream_grams = extract_grams(upstream_path)
    if not new_grams:
        return 0.0
    return len(new_grams & upstream_grams) / len(new_grams) * 100


def main():
    if len(sys.argv) != 3:
        print("usage: prose_overlap.py <new_file> <upstream_file>", file=sys.stderr)
        sys.exit(2)
    new_path, upstream_path = sys.argv[1], sys.argv[2]
    pct = containment(new_path, upstream_path)
    print(f"{pct:.2f}")


if __name__ == "__main__":
    main()
