# Inline Pass Instructions

Use this file when running in inline mode (text < 300 chars). Run all five passes sequentially.

> **Maintenance note:** This file is a condensed version of `agents/grammarian.md`, `agents/editor.md`, `agents/copywriter.md`, `agents/reader.md`, and `agents/humanizer.md` for inline use. When updating any agent file, update the corresponding section here in sync.

---

## Pass 1: Spelling & Grammar

Check language correctness — the foundation of reader trust.

- Spelling & spacing (Korean: 됬다→됐다, 어떻해→어떡해, 왠만하면→웬만하면)
- Punctuation placement and consistency
- Subject-predicate agreement, tense consistency, particle use (을/를, 이/가, 은/는)
- Loanword spelling (Korean: follow 국립국어원 standard)

```
[spelling] "됬어요" → "됐어요" (vowel contraction: ㅏ+ㅣ→ㅐ)
[spacing] "할 수있다" → "할 수 있다"
```

---

## Pass 2: Writing Patterns

Check structure and rhythm. Good writing has variety.

- **Monotone sentence length:** Mix short and long sentences.
- **Repeated sentence starters:** "그리고/또한/하지만" three times in a row kills rhythm.
- **Passive overuse:** Weak passives drain energy. Korean double-passive ("되어진다") especially.
- **Word repetition:** Same word 3+ times in a paragraph signals thin vocabulary.
- **Paragraph flow:** Does each paragraph have a clear intro-body-close? Are transitions smooth?

```
[pattern] 5 consecutive sentences ending in "~습니다" — vary endings
[pattern] "제공하다" used 4x in this paragraph → replace some with "주다", "전달하다", "건네다"
```

---

## Pass 3: Expression & Style

Check whether words deliver the intent precisely and vividly.

- **Vague words:** "관련된", "다양한", "여러", "좋은" — can they be made specific?
- **Translated/bureaucratic phrasing:** "~에 있어서", "~하는 것이 필요하다" → plain Korean
- **Clichés:** "혁신적인", "패러다임 전환", "시너지" — replace with what it actually means
- **Tone fit:** Formal report ≠ casual speech. Friendly blog ≠ stiff prose.
- **Emphasis overuse:** Too much bold/underline/! means nothing stands out.

```
[expression] "다양한 방법으로 도움을 드릴 수 있습니다" → "세 가지 방법으로 도와드립니다"
[expression] "~에 있어서 중요한 역할을 합니다" → "~에서 핵심 역할을 합니다"
```

---

## Pass 4: Reader Perspective

Read as someone encountering the text for the first time.

- **Assumed knowledge:** Terms, acronyms, or context the reader may not have.
- **Logic gaps:** Does A → B → C hold? Where might a reader ask "why?"
- **Opening hook:** Do the first two sentences earn the rest of the read?
- **Core message:** After reading, what should the reader remember? Is it clear?
- **Call to action:** What should the reader do next? Is that obvious?

```
[reader] "KPI를 기반으로" — needs explanation for general audience; fine for marketers
[reader] Para 3 logic gap: A happens, then suddenly C. Add step B.
```

---

## Pass 5: Humanizer

Find the tells that make a reader think "a model wrote this" and replace them with how a person who knew the material would say it.

- **Shape:** headers/bold labels on short text, bullets for consecutive sentences, reflex triads, a closing that restates the opening, an opener that announces the text ("This PR introduces", "이 글에서는 ~에 대해 알아보겠습니다"), emoji section markers.
- **Register:** "not X but Y" more than once, em-dash chains, uniform hedged sentence length, stacked hedges, delve/robust/leverage/seamless/streamline, 번역투 ("~에 있어서", "~을 진행하다", "~하는 것이 가능하다"), every sentence ending "~할 수 있습니다".
- **Why:** describes what changed but not why, or what trade-off was weighed; lists files the diff already shows; no number/error/example; nothing the author is unsure about.
- **Padding:** restating, announcing, padding to a count.

For `pr` / `commit` genre, also apply `references/pr-description.md`. `[why]` is 🔴 there.

```
[why] "This PR refactors the retry logic" — what without why → "Checkout timed out for ~3% of orders because retries fired back-to-back; this backs them off and caps at 5."
[shape] 4 headers over 120 words → three sentences, no headers
[register] "leverage", "robust", "seamlessly" in one paragraph → use, reliable, cut
```
