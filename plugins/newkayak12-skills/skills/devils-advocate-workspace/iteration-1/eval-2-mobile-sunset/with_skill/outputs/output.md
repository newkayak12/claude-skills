# Devil's Advocate: Sunsetting the Mobile App

**Position being challenged:**
"We should sunset our mobile app and go web-only to reduce maintenance overhead."

---

## Counterargument 1: Mobile users don't migrate to web — they churn

The assumption that mobile app users will simply switch to your mobile web experience is not supported by user behavior. Native app users have actively chosen the app over mobile web at some point; when forced back to the browser, a substantial portion will not adapt — they will leave. Research consistently shows that users spend 4–5x more time in native apps than in mobile web, and retention curves diverge sharply after forced migration events. The maintenance overhead you're eliminating is a real, measurable engineering cost. The user loss is equally real but deferred and harder to attribute cleanly — which makes it easy to undercount. If mobile represents a meaningful share of your DAU, revenue, or engagement, you may be trading a manageable ongoing cost for an irreversible reduction in your user base.

## Counterargument 2: Progressive Web Apps cannot replace what your native app delivers — especially on iOS

If your app currently uses push notifications, background sync, offline-first storage, biometrics, camera pipelines, or Bluetooth — you cannot fully replicate these on the web across all platforms. This is not a temporary technical gap; it is active platform policy. Apple has repeatedly constrained PWA capabilities on Safari/iOS: web push on iOS was only partially enabled in 2023 and remains limited in scope, background sync is restricted, and home-screen PWAs on iOS behave differently from their Android equivalents in ways that materially degrade the experience. Your web-only product will not be equivalent to your native app for iOS users, who may represent the majority of your higher-value users. "Web-only" will mean "a worse experience for a large segment," not "the same experience with less overhead."

## Counterargument 3: Sunsetting the app treats the symptom, not the problem

If mobile maintenance is genuinely burdensome, the right question is: why? Duplicated business logic between platforms, lack of a shared design system, inadequate mobile expertise on the team, or a poorly architected codebase are all fixable problems. Cross-platform frameworks — React Native, Flutter — have matured to the point where a single codebase can serve iOS and Android with near-native performance and a fraction of the previous maintenance overhead. Sunsetting the app permanently eliminates the product and the user base to avoid fixing an operational problem that has known, lower-cost solutions. Once you exit the app stores, rebuilding takes years: you lose your review history, your organic discoverability, your established user base, and your team's mobile expertise. If the business grows or competitors press you from the mobile side, re-entry will cost far more than the maintenance savings ever justified.

---

## Core Vulnerability

The proposal frames "reduce maintenance overhead" as the goal, but the actual goal is presumably "maximize business outcomes given available resources." These are not the same thing. Sunsetting the app achieves the stated sub-objective with certainty and immediacy. The costs — user churn, capability loss, competitive exposure, re-entry friction — are real but deferred and harder to measure, which makes them easy to discount when making the decision. This is the structural flaw: the decision optimizes for what is directly visible to the engineering team (maintenance burden) while externalizing costs onto users, the business, and a future team that will have to rebuild what was abandoned. A sound analysis would require modeling the expected user retention rate on mobile web, the revenue impact of the delta, and comparing that against the actual maintenance cost reduction — not just asserting the tradeoff is favorable.
