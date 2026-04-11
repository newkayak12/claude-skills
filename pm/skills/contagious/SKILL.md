---
name: contagious
effort: max
description: >-
  Use when someone wants to make a product, feature, campaign, or idea spread
  through word-of-mouth or organic sharing. Triggers on: "word of mouth",
  "virality", "how to make this spread", "shareability", "바이럴", "입소문", "공유되게 하고
  싶어", "제품이 퍼지게".
license: MIT
metadata:
  author: wondelai
  version: "1.0.1"
scenarios:
  - "How do we make this feature spread organically?"
  - "우리 제품이 왜 입소문이 안 나는지 분석해줘."
  - "Score this launch campaign for shareability."
  - "바이럴 요소를 제품에 어떻게 추가할 수 있을까?"
  - "Engineer word-of-mouth into our onboarding flow."
  - "이 캠페인 STEPPS 기준으로 평가해줘."
compatibility:
  recommended: []
  optional:
    - think-tool
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 STEPPS 점수 분석과 개선 우선순위 판단에 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS score the idea against STEPPS before recommending virality changes.
- ALWAYS identify the trigger mechanism — what cue prompts sharing in real life.
- NEVER recommend a viral mechanic without identifying the social currency it creates.
- NEVER treat virality as a feature to add at the end; it must be designed in from the start.


# Word-of-Mouth & Virality Framework

A framework for engineering word-of-mouth and making products, ideas, and content contagious. Based on Jonah Berger's research into why certain things catch on while others languish in obscurity — and how to systematically tip the odds in your favor.

## Core Principle

**Virality is not born — it is engineered.** Products don't go viral by luck or by simply being great. They spread because they were designed — consciously or unconsciously — to be shared.

**The foundation:** Contrary to popular belief, only 7% of word-of-mouth happens online. The remaining 93% happens offline, in everyday conversations. This means virality isn't just about social media — it's about understanding the psychology of why people talk about and share certain things. Sharing follows predictable psychological patterns, and these patterns can be engineered into any product, idea, or piece of content using the STEPPS framework.

## Scoring

**Goal: 10/10.** When reviewing or creating products, campaigns, content, or features for shareability, rate 0-10 based on adherence to the STEPPS principles below. A 10/10 means the offering activates all six STEPPS drivers; lower scores indicate untapped viral potential. Always provide the current score and specific improvements needed to reach 10/10.

## STEPPS Overview

Six principles that make things contagious:

```
S - Social Currency     → Does sharing it make people look good?
T - Triggers            → Is there an environmental cue that reminds people of it?
E - Emotion             → Does it evoke high-arousal feelings?
P - Public              → Is it visible when people use or consume it?
P - Practical Value     → Is it genuinely useful information people want to pass along?
S - Stories             → Is it wrapped in a narrative people want to tell?
```

**Not a checklist — a multiplier.** Each principle independently increases the likelihood of sharing. The most contagious ideas activate multiple STEPPS simultaneously. But even activating one or two well can dramatically increase word-of-mouth.

| Principle | Core Question | Sharing Driver |
|-----------|--------------|----------------|
| **Social Currency** | Does it make people look good to share? | Self-enhancement |
| **Triggers** | What in the environment reminds people of it? | Top-of-mind accessibility |
| **Emotion** | Does it fire up high-arousal feelings? | Physiological arousal |
| **Public** | Can others see people using/engaging with it? | Observational learning |
| **Practical Value** | Is it useful enough to pass along? | Altruism and helpfulness |
| **Stories** | Is the brand embedded in a narrative? | Entertainment and identity |

## The STEPPS Framework

### 1. Social Currency

**Core concept:** People share things that make them look good — smart, cool, in-the-know. If your product or idea makes people feel like insiders, they'll spread it to boost their own image.

**Why it works:** We use brands and information as social signals. Sharing remarkable facts, exclusive access, or high-status products is a form of self-enhancement. People don't just share what they think — they share what makes them look good for thinking it.

**Key insights:**
- **Remarkability** — things that are surprising, novel, or extreme get shared because they make the sharer seem interesting. "Did you know...?" is one of the most powerful sharing triggers
- **Game mechanics** — leaderboards, badges, status tiers, and achievement systems create visible markers of accomplishment that people want to display and talk about
- **Exclusivity and scarcity** — secret menus, invite-only access, members-only content — making people feel like insiders gives them social currency when they share "insider knowledge" with their circle
- **Inner remarkability** — even mundane products can find their remarkable angle. The key is framing, not the product itself


**Ethical boundary:** Social currency should make people genuinely feel good, not manipulate through false scarcity or manufactured exclusivity that breeds toxicity. Create real insider value, not artificial gatekeeping.

See: [references/social-currency.md](references/social-currency.md) for remarkability exercises and game mechanics design.

### 2. Triggers

**Core concept:** Top-of-mind means tip-of-tongue. Environmental cues — sights, sounds, smells, times of day, routines — can trigger people to think about and talk about your product. The more frequently people encounter your trigger, the more they'll talk about you.

**Why it works:** Most word-of-mouth is not driven by excitement about the product itself but by whatever happens to be top-of-mind at the moment of conversation. If your product is linked to a frequent environmental cue, it gets mentioned more often — not because it's more exciting, but because it's more accessible in memory.

**Key insights:**
- **Frequency beats strength** — a trigger encountered daily (like coffee) is more valuable than a powerful but rare trigger (like a holiday). Kit Kat linked itself to coffee breaks, which happen multiple times per day
- **Habitat matters** — where and when do people encounter environments related to your product? Those are your trigger opportunities
- **Competitive triggers** — you can link competitor moments to your own brand. When people think of [competitor's context], they think of you instead
- **Ongoing vs. temporary** — triggers that persist in the environment (a desk item, a daily routine) generate sustained word-of-mouth, while event-based triggers create spikes
- **Context linking** — pair your product with an existing, frequent behavior or environment


**Ethical boundary:** Triggers should create genuine, helpful associations. Hijacking sensitive contexts (grief, health scares) as triggers is manipulative and will backfire.

See: [references/triggers.md](references/triggers.md) for habitat analysis and trigger design frameworks.

### 3. Emotion

**Core concept:** When we care, we share. High-arousal emotions — both positive (awe, excitement, amusement) and negative (anger, anxiety) — drive sharing. Low-arousal emotions (sadness, contentment) suppress it.

**Why it works:** Physiological arousal — the racing heart, the tightened muscles, the activated state — creates a need to share. It's not about positivity vs. negativity; it's about activation vs. deactivation. Content that fires people up gets shared; content that brings people down gets ignored.

**Key insights:**
- **High-arousal positive:** awe, excitement, amusement, humor, inspiration — all drive sharing
- **High-arousal negative:** anger, anxiety, outrage, fear — also drive sharing (controversies spread fast)
- **Low-arousal positive:** contentment, relaxation, satisfaction — suppress sharing (people feel no urgency to act)
- **Low-arousal negative:** sadness, melancholy, disappointment — suppress sharing (people withdraw)
- **Awe is the most powerful sharing emotion** — content that makes people feel small in the face of something vast, beautiful, or surprising spreads the furthest
- **Emotional framing** — the same information can be framed to evoke different arousal levels. Facts inform; emotional framing motivates sharing


**Ethical boundary:** Anger and outrage are high-arousal and highly shareable, but engineering outrage for clicks corrodes trust. Use high-arousal negative emotion sparingly and only when the underlying cause genuinely warrants it.

See: [references/emotion.md](references/emotion.md) for emotional arousal mapping and content audit tools.

### 4. Public

**Core concept:** Built to show, built to grow. If people can see others using your product, they're more likely to adopt it themselves. Make the private public — design for observability.

**Why it works:** People imitate what they can see. If your product usage is invisible, you lose the most powerful adoption channel: social proof through observation. The phrase "monkey see, monkey do" exists because observational learning is one of the deepest human instincts.

**Key insights:**
- **Behavioral residue** — design products that leave visible traces after use. A bumper sticker outlasts the rally. A Livestrong wristband is worn long after the donation
- **Self-advertising products** — every Hotmail email included "Get your free email at Hotmail" in the signature. The product advertised itself through use
- **Observable consumption** — Apple deliberately designed the MacBook logo to face outward (toward observers) rather than toward the user. Every open laptop became a billboard
- **Private behaviors stay private** — if no one can see you using the product, you can't benefit from social proof. Find ways to make invisible usage visible
- **Public = imitable** — people can only copy what they can observe. Making your product publicly visible makes it easier for others to adopt


**Ethical boundary:** Public visibility should empower users, not shame them. Never make private information (failures, health data, financial struggles) involuntarily public. The user should always control what is visible.

See: [references/public-visibility.md](references/public-visibility.md) for observability design and behavioral residue strategies.

### 5. Practical Value

**Core concept:** People share useful information to help others. News you can use spreads — especially when it's packaged in a way that's easy to pass along and clearly valuable.

**Why it works:** Sharing practical value is driven by altruism — people genuinely want to help their friends and family. If your content or product saves people time, money, or effort, they'll share it as a favor to their network.

**Key insights:**
- **Prospect Theory** — people evaluate deals relative to a reference point, not in absolute terms. A $10 discount on a $20 item feels better than a $10 discount on a $1,000 item, even though the savings are identical
- **Rule of 100** — for products under $100, use percentage discounts (50% off a $30 item sounds better than $15 off). For products over $100, use dollar amounts ($200 off sounds better than 10% off a $2,000 item)
- **Diminishing sensitivity** — the difference between $5 and $10 feels bigger than the difference between $495 and $500. Frame savings relative to small reference points
- **Knowledge packaging** — useful information needs to be packaged for easy sharing. Lists, how-tos, infographics, and tip collections are inherently more shareable than long-form essays
- **Narrow audience = wider sharing** — counterintuitively, content targeting a specific niche gets shared more because people forward it to "the person who needs this"


**Ethical boundary:** Practical value must be genuine. Fake savings (inflated "original" prices), misleading tips, or clickbait "life hacks" that don't actually work will destroy trust faster than they generate shares.

See: [references/practical-value.md](references/practical-value.md) for Prospect Theory applications and knowledge packaging formats.

### 6. Stories

**Core concept:** People don't just share information — they tell stories. The best way to spread your idea is to embed it inside a narrative so engaging that people retell it, and your brand comes along for the ride. This is the Trojan Horse approach.

**Why it works:** Stories are how humans naturally process and transmit information. We think in narratives, not bullet points. A well-crafted story carries your brand message inside it like a Trojan Horse — the listener absorbs the message while being entertained by the story.

**Key insights:**
- **The Trojan Horse test** — can someone retell the story without mentioning your brand? If yes, the story fails. Your brand must be so integral to the narrative that removing it makes the story collapse
- **Stories carry morals** — people extract lessons from narratives. The lesson should naturally lead to your value proposition
- **Narrative transportation** — when people are absorbed in a story, their critical defenses drop. They accept the embedded message more readily than a direct pitch
- **Retellability** — the story must be simple enough to retell in a conversation. If it requires a 10-minute setup, it won't spread
- **Valuable virality** — the story must not just be shareable but must carry the brand message. A hilarious ad that people can't remember the brand of is a failure


**Ethical boundary:** Stories must be true or clearly fictional. Fabricating testimonials, inventing origin stories, or creating misleading narratives will eventually be exposed, destroying the brand's credibility and making future word-of-mouth toxic.

See: [references/stories-trojan-horse.md](references/stories-trojan-horse.md) for narrative templates and the Trojan Horse integration test.
