# Metric Discovery — Questions, Not Numbers

Loaded by `../SKILL.md` when a rewrite has a `[확인 필요: 수치]` marker or the user says they have no numbers. Sits under the Standing Mandates: **Claude never proposes a value** — no estimate, no range, no 역산, no "typical" figure. This file helps the user *find* their own number; it never supplies one.

## 1. Six metric types

| Type | Asks |
|------|------|
| 금액 (money) | cost saved, revenue touched, budget owned |
| 시간 (time) | latency, build/deploy time, time-to-resolve, hours saved |
| 비율 (%) | error rate, conversion, adoption, coverage, uptime |
| 규모 (volume) | users, requests, records, services, repos, team size |
| 품질 (quality) | defects, incidents, rework, review rounds, accuracy |
| 빈도 (frequency) | deploys, releases, runs, reports per period |

## 2. Discovery questions

- **Scale** — how big was the thing: users, traffic, data, number of systems or people affected?
- **Impact** — what got faster, cheaper, rarer or safer, and how would anyone have noticed?
- **Comparison** — what was it before, and what is it now? What did the team or the previous version do?

A number needs its baseline; ask for the before and the after together.

## 3. Role → metric type

Types only; the values are the user's.

| Role | Look for |
|------|----------|
| Backend / platform | time (latency, batch duration), volume (requests, records), %(error rate) |
| Frontend | time (load, render), % (conversion, bounce), quality (defects) |
| Data / ML | % (accuracy, coverage), volume (rows, pipelines), time (job duration) |
| DevOps / SRE | frequency (deploys), time (recovery, build), % (uptime) |
| QA | quality (defects found, escaped), % (coverage), frequency (regression runs) |
| PM / lead | volume (team, stakeholders), time (cycle), money (budget) |

## 4. "No numbers" recast as questions

| User says | Ask instead |
|-----------|-------------|
| "측정을 안 했어요" | input metric: how many users, requests or records did it touch? |
| "개인 작업이라 지표가 없어요" | scope metric: how many services, modules, teammates or releases depended on it? |
| "결과를 몰라요" | throughput: how often did it run, how long did it take per run? |
| "정확도는 모르겠어요" | accuracy: was there a test set, a review, a bug count before/after? |

If the user has no data at all, an activity or scope metric is used only if they supply it. Otherwise keep the `[확인 필요]` marker, or suggest dropping or merging the line. Not every bullet can be quantified.

## 5. Where the data might live

Dashboards (Grafana, Datadog), tickets and sprint reports, PR and commit counts, release notes, incident postmortems, load-test or CI logs, analytics, performance reviews, old Slack or Notion posts.

## 6. Avoid

- No number without a baseline — `feedback` counts it as incomplete.
- At most 2–3 numbers per bullet; pick the ones an interviewer would probe.
- Confidential figures only as the user's own range or %, never an invented absolute.
- No estimation technique of any kind. A figure the user states themselves is carried as written, tagged `(본인 추정)`.
