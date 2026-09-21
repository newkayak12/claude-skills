# Evals — think:mentor

Measures the behaviours the skill claims to enforce, not whether the output sounds wise. Six
fixtures, two of them traps where a high score on the universal criteria means the skill failed.

## Fixtures

| # | Situation | Trap |
|---|---|---|
| F1 | 승진 제안, 주변은 받으라고 함, 연봉 +12%, 코드 못 짬 | answering A-or-B instead of naming the standard doing the comparing |
| F2 | "위에서 내려온 거였고 저는 전달만 했어요, 어쩔 수 없었죠" | joining in blaming the company |
| F3 | "실력으로만 평가해요" + 편애한다는 말이 돎 | accepting the principle as stated and advising on top of it |
| F4 | 어제 아버지 장례, 다음 주 릴리즈, 머리가 안 돌아감 | **examining** — any move applied here is the failure |
| F5 | Redis Streams vs Kafka, 두 달 못 정함, "제 판단력이 문제" | philosophizing about a technical decision |
| F6 | "설명 필요 없고 답만 주세요, 저녁까지 회신" | refusing in silence, or answering with no rule |

Each fixture file carries its input and its expected behaviours; `rubric.md` holds the 12 criteria
and the per-fixture C12 row. F4 is scored inverted — C1/C2/C3/C8/C9/C10 are `n/a` there, because
handing a judgment rule to someone who just buried a parent is the defect.

## Scripts

| Script | Does |
|---|---|
| `run.sh <base\|skill> [fixture...]` | one `claude -p` per fixture; `skill` arm invokes `/think:mentor` with `--plugin-dir`, `base` arm gets the bare user message |
| `score.sh <arm>` | one judge per response against `rubric.md`; a criterion scores 1 only with a quote |

The arms are the same model with and without the skill text in context; each fixture is two turns
(`input`, then `followup`), and turn 2 is produced by a separate call that sees turn 1 but never saw
the follow-up when turn 1 was written. Judges receive the two arms' transcripts blind, as A and B,
with the assignment flipped per fixture so a judge cannot learn that one letter is always the
baseline.

Env: `MENTOR_MODEL` (sonnet) · `JUDGE_MODEL` (sonnet) · `MENTOR_OUT` · `MENTOR_PARALLEL` (3).

**Both arms must run in an empty cwd outside this repo.** The first baseline round ran with the
repo as cwd and reproduced the skill's output template verbatim — `[내 생각]`, the self-authored
counterargument, the falsification condition, the stop, the rule. The repo's own `CLAUDE.md` tells
Claude to look for a relevant skill, and `mentor/SKILL.md` was readable from that cwd. That round was
discarded; `run.sh` now creates `$MENTOR_OUT/cwd/<fixture>/` and runs there.
