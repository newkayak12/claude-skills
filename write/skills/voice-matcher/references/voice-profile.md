# Voice Profile

Fill every row from the samples. Value = a count, ratio, or quote. "—" when the samples don't show it.
Tolerance = how far the rewrite may drift before step 5 flags it.

| # | Trait | How to measure | Tolerance |
|---|---|---|---|
| 1 | Sentence length | mean chars/sentence + shortest/longest | mean ±25% |
| 2 | Length spread | share of sentences < 10 chars and > 40 chars | each ±10pp |
| 3 | Paragraph size | sentences per paragraph (median) | ±1 |
| 4 | 종결어미 | distribution: `~다` / `~요` / `~습니다` / `~음·함` / 반말 / 명사형 | top ending ±15pp |
| 5 | 존댓말 level | 합쇼체 · 해요체 · 해체 · mixed (by reader) | exact |
| 6 | Opener habit | first 5 words of each sample (quote) | same pattern |
| 7 | Closer habit | last sentence of each sample (quote) — sign-off, question, nothing | same pattern |
| 8 | Recurring words | words/fillers in ≥ 2 samples: "근데", "일단", "사실", "좀", "I think", "tbh" | ≥ 1 per ~200 chars if samples do |
| 9 | Punctuation | `...`, `ㅋㅋ`, `!`, `~`, em-dash, emoji, `()` per 100 chars | ±50% |
| 10 | Formatting | bullets, bold, headers, code spans — used or not | exact |
| 11 | Hedging | "~것 같아요", "아마", "probably" per 100 chars | ±50% |
| 12 | Directness | claim first or context first (count samples each way) | same majority |
| 13 | Code-switching | English terms kept in English vs. translated (list them) | same terms |

## Uncertain

Traits seen in one sample only. List them; do not apply until the user confirms.

## Machine-tell list (remove unless a sample uses it)

Structure: headers/bold on short text · reflex triads · "정리하면/결론적으로" closer · "~에 대해 알아보겠습니다" opener
Register: `~할 수 있습니다` streaks · `~을 진행하다` · `~에 있어서` · `~적인 측면에서` · 다양한 · 효과적으로 · 중요합니다 ·
leverage · robust · seamless · delve · "it's worth noting"

Rule: if the user's own samples use one of these, it's their voice — keep it.
