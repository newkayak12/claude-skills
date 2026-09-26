// prompts.mjs - the broker composes every node prompt from graph state.
//
// This is deliberate. If the orchestrator had to write the prompt, it would first have
// to hold the goal-spec, the upstream handoffs, and the prior rejection feedback in its
// own context - and that context grows with every node, which is exactly what makes a
// long loop impossible. The graph already holds all of it, so the broker writes the
// prompt and the orchestrator never sees the payload.

import { REASONING_STAGES, FLOWS, VERDICT_FIELD, kindSkills, kindOf } from './graph.mjs';
import { conventionsBlock } from './conventions.mjs';

// Every upstream handoff inserted into a downstream prompt is sliced to this many
// characters before it reaches the model. Restores a budget the original generation
// enforced (`handoffOf`) and the MCP rewrite dropped: a node prompt that grows with the
// run is how a late gate ends up reading more than it can weigh. Checks and changed-file
// lists are not capped - they are the evidence a judge needs in full.
export const HANDOFF_CAP = 1500;

function capHandoff(text) {
  const s = String(text || '');
  if (s.length <= HANDOFF_CAP) return s;
  return `${s.slice(0, HANDOFF_CAP)}\n… [handoff truncated at ${HANDOFF_CAP} of ${s.length} chars]`;
}

// The failure mode behind almost every rejected setgoal retry, named so the model does not
// have to rediscover it: structured-output validation rejects a large, mostly-correct draft
// - usually over one missing top-level field, most often `acceptance` - and the model's own
// fix is to shrink the whole payload to isolate the error, instead of adding the one field
// back and returning everything else unchanged. Restores the diagnosis the original
// generation's `isDegenerateSpec` corrective re-author carried; `validateSpec` catches the
// same emptiness cases (and more) but only lists them - it never explained why they recur.
export const DEGENERATE_SPEC_DIAGNOSIS = `Diagnosis: the previous spec was rejected by structured-output validation, not by a human judgment call. The usual cause is a single missing or empty top-level field - most often "acceptance" at the goal level, or a subgoal with no "acceptance", no "title", or a title/goal so short it reads as a placeholder rather than real content. The failure mode to avoid: shrinking the whole spec to isolate which field is wrong. Do not throw away subgoals, decomposition, or detail that was not named below. Fix exactly the field(s) named as the problem and return the rest of the spec unchanged.`;
import { mountBlock } from './mounts.mjs';

// Shared by every Method block a composed prompt can carry - the per-subgoal one below and
// the stage-mounted one mounts.mjs renders - so the two mechanisms state the same rule in
// the same words instead of drifting apart.
// Telemetry, not method: without this field no graph node ever said which skills it loaded, so
// a run with no skills mounted at all was indistinguishable from one that used them.
export const SKILLS_USED_FIELD = `Add "skills_used": ["plugin:skill", ...] to the Required output JSON below, naming the ones you actually loaded, or ["none"].`;
export const SKILL_METHOD_DISCLAIMER = `A skill that is not installed here is skipped without comment or substitute. Its own output template does not apply - "Required output" below is the only shape you may return - and neither does its "what you do / what I do" half: nobody is reading this but the machine that called you, so ask nothing and finish the work yourself.`;

// Absorbed from what a PRD skill would have supplied. The engine names no PM plugin here: the
// planning kind is the only caller, it always runs headless, and a method skill that is not
// published can never mount - a dangling reference silently left every planning draft with no
// method at all. Written as the identity plus the sections, so it survives with no plugin.
export const PLANNING_SETGOAL = `This run's deliverable is a SET of planning documents, and deciding what is in that set is this stage's job - the same way shape decides packages. Nobody has told you it is one file. Every subgoal in this run is kind "planning" - a document written through investigate -> draft -> revise -> gate - and "document" is a different kind that fails this run's spec. The PRD is the floor, never the ceiling: one planning subgoal for it, at the path the request or the manager names. Beyond it, add a planning subgoal wherever a reader would go looking for something by name and would not expect to find it inside a PRD - the domain model and its glossary when the request has a vocabulary an engineer would otherwise get wrong, the policy decisions when the product has rules people will argue about later (who is entitled to what and on what basis, what the limits are, what happens when someone cancels or abuses it), the scale and availability assumptions when the request states a load condition, a decision record when a choice needs its reasoning kept. Name the ones THIS request needs and say who reads each - do not produce four documents because that sentence lists four, and do not collapse a real one into a section to keep the count down. Separate documents are independent to write: deps[] between them is almost always wrong, and a set that could have been written at once should not become a chain.
files[] is the markdown path this subgoal WRITES and nothing else - the spec check rejects any other path there, and reduce reads files[] as what each subgoal declared it wrote. A planning subgoal's investigate stage also writes one derived file beside it, \`<that path without its extension>-findings.md\`, which does not go in files[] and which the fold already expects. Each planning subgoal opens with an investigate stage that reads the sources before anything is written, so name what that document's investigator ought to open - the parts of the tree, the attached or referenced material, the prior documents - in the subgoal's own sources[] field. A document whose subject nothing in reach can speak to is still worth naming: its investigation will come back as unknowns with owners, which is a real deliverable and the honest alternative to a section someone invented.`

export const PRD_CONTRACT = `You are writing this request's planning documents, and a PRD is not a design spec. State the problem and who has it before any requirement, and keep "why we are building this" separate from "what we are building". Module contracts, package splits, file layouts and import rules are the shaping stage's job, not yours - naming them here pre-empts the stage that is supposed to decide them, and a document that opens at the data shapes has skipped the part only planning can do.
How many documents the set holds was decided at setgoal; this contract governs the PRD itself, and a section below that another document in the set owns is cross-referenced by path rather than repeated. The PRD must carry these sections, in this order, each as a "## " heading:
  Problem - what is wrong today, for whom, and the evidence in the request or the tree that says so.
  Target users - who this serves, what they are trying to get done, and what they do today instead.
  Solution overview - two or three paragraphs of what is being built, at the level of behaviour a user sees.
  Success criteria - what must be observably true for this to have worked, each one checkable.
  User stories - headed exactly "## User stories", listing every story as "US-1", "US-2", ... in document order, each with its own acceptance[]. audit and gate:goal have no other source for them, and a PRD with none is rejected.
  Out of scope - what is deliberately not being built, and why.
  Open questions - decisions this document could not settle, each with the recommendation you would make.
A section you cannot fill from the request or the tree is written with what you do know plus the gap stated plainly; it is never dropped, and never padded by restating the request.
Before any of that, name the domain the request belongs to and what is specific to it. The general version of a problem is the one you already know, and it is the one you will write if nobody stops you: a ticketing PRD about queues and bots, a payments PRD about retries, a chat PRD about delivery receipts. Those are real, and they are not the point. Ask what the people in THIS domain actually do that the generic version has no idea about - who gets priority and on what basis, what an established customer expects that a first-time one does not, which rule exists because of that industry's history or regulation, what everyone in it would notice missing on the first read. Write those into Problem, Target users and the stories, with the domain's own vocabulary rather than a neutral paraphrase of it. A domain practice you decide not to build is named in Out of scope, so that skipping it is a decision on the record; one you never mention has not been scoped, it has been overlooked - and it is the reason a reader in that industry puts the document down.
Out of scope is for capability you decided not to build, and it is not a place to put a rule you did not decide. If a user story rests on the rule - what the per-person limit is, who is entitled to the early window, what happens to a cancelled order, what follows when someone is caught abusing it - then that rule is DECIDED, in the PRD or in whichever document of the set owns it, or it stands as an Open question with a named owner. A story resting on an undecided rule is not buildable, and moving the rule to Out of scope makes the document pass while the decision is still missing: the practice is then neither built nor decided, only filed. The same goes for a practice you write down as merely assumed to exist - an assumption with no decision behind it and no story over it is an omission wearing a heading.`

// D2 slice 3 (0.29.0, docs/plans/2026-09-23-teams-reducer-human-rollback.md §1): the same
// treatment investigate's own unknowns[] got in 0.28.0, offered to every other judging/
// deciding stage that names it below - a decision this stage cannot make alone, but must not
// silently guess either. graph.mjs's openAsk reads this field by name; keep it short, every
// stage below already carries its own full contract.
const QUESTIONS_CONTRACT = `Optional: "questions": [{"question": "...", "to": "<role or person who owns this, if you can name one>", "options": [{"option": "...", "consequence": "..."}], "default": "<what you decide if nobody answers - required whenever "options" is>", "why": "<why this is not yours to decide alone>"}]. Only for a decision with a real owner other than you - not a hedge on ordinary judgment. An interactive run stops and asks; otherwise "default" is used and the question is recorded on the report as decided-for-you.`;

// A downstream package's implement/test/gate finding something wrong OUTSIDE its own scope, in
// a package it deps on (its own worktree started from that package's delivered branch - see
// "Delivered by package ..." above), used to have no honest route: fail your own stage over a
// contract you cannot touch, and the next attempt reruns against the SAME broken upstream
// forever (awake-beta-ref2, 2026-09-25 - a downstream package's own C probe proved an upstream
// package's kernel-detection assumption did not hold on this host, and the only routes were to
// silently work around it or to fail an attempt no retry could ever fix). This is the other
// route: report it, and keep working your own scope.
const UPSTREAM_DEFECT_CONTRACT = `Optional: "upstream_defects": [{"package": "<the id of the upstream package this belongs to, exactly as named in "Delivered by package ..." above>", "title": "...", "evidence": "<what you observed, and how to reproduce it>", "touches": ["path inside the upstream package"]}]. Only for something wrong in a package you depend on, outside your OWN touches[] - not a gap in what this package itself was asked to build, and not yours to fix (that package's files are not in scope here). Do not fail stage_ok or withhold acceptance for this alone: finish everything that IS in your own scope, report the upstream defect, and let the manager route the fix.`;

export const CONTRACT = {
  plan: `Return JSON: {"plan": "<the decomposition>", "size": "S|L", "flow": "develop|document", "sizing": ["command -> what it showed"], "dependencies": ["unit -> its real ordering dependency, or \\"none\\""], "verification": ["unit -> command or inspection that would deterministically verify it"], "conventions": ["path -> the rule it states, if .claude/conventions/** applies"], "handoff": "<what the next node needs>", "evidence": "<how you checked the request is actually satisfiable here>"}
size is S when one run in one worktree can carry the whole request; L when it spans independent modules, packages or repositories that would each need their own run. Decide it from what commands show - file count, module boundaries, owners - and put those commands in "sizing". The default is S; a manager layer exists, and the temptation is to use it.
flow is develop when the deliverable is code the repository must run, document when it is text a reader must find things in. If the run's flow is already fixed below, return it unchanged.
For every unit the decomposition names, say what real ordering dependency it has on another unit (not a guess - a data or artifact dependency an executor would actually hit), how it can be deterministically verified (a command that exits, or a specific passage a reader would find), and which convention file constrains it, if any apply. setgoal turns these into subgoal deps[], test[] and acceptance[] - it has no other source for them, since the nodes that do the work never see this plan.
${QUESTIONS_CONTRACT}`,
  setgoal: `Return JSON: {"spec": {"goal": "...", "acceptance": ["goal-level criteria"], "subgoals": [{"id": "U1", "kind": "subgoal|document", "title": "...", "persona": "...", "skills": ["plugin:skill"], "acceptance": ["subgoal criteria"], "test": ["deterministic checks"], "files": ["paths"], "deps": []}]}, "handoff": "...", "evidence": "..."}
Every acceptance criterion must be checkable by a command, a file inspection, or - for a document - by a reader finding a specific passage. Reject your own vague criteria before returning.
Two shapes are forbidden as hard pass/fail bars, at goal level and per subgoal alike: a criterion that hinges on whole-repo state - a git diff or git status across the whole tree, an aggregate count taken over the whole repository - because concurrent work on other subgoals or other runs makes it non-deterministic between when it is written and when it is judged; and an aspirational or arbitrary-threshold target - a percentage, a score, "significantly better", "mostly done" - written as a bar rather than derived from something a command or a reader can settle. Author around both now; the critique that follows can only flag them after the fact, and a run that has to be re-authored costs more than writing it right once.
Make each subgoal self-contained: include applicable constraints in acceptance[], required paths in files[], and checks in test[]. The nodes that do the work will not receive the full request or requester conversation.
Every subgoal must be a unit of work with a checkable artifact, and must say which kind it is:
  "subgoal" (default) - work that changes code and is verified by running commands. Expands to implement -> test -> gate.
  "document" - a written artifact: a design note, a spec, a guide, a report. Expands to draft -> review -> gate. Its acceptance[] is the reviewer's rubric: each item names something a reader can find, or fail to find, in the text. Name the output path in files[].
Verification is not a subgoal of either kind: express it as that subgoal's test[] (code) or acceptance[] (document). A subgoal whose only job is to check something already built has nothing for its first node to do and can only fail.
"deps" means one thing only: this subgoal's own work cannot START until that one has finished. It is not the order the product is built in, and not the order a reader will read the result in. For a document that distinction decides the whole run's shape: sections of one document are almost always independent to WRITE even when the things they describe depend on each other, and a dependency copied from the subject matter turns a set that could be written at once into a chain. The planning run that wrote a seven-section PRD (2026-09-22) declared U1 -> U3 -> U2 -> U4 -> U6 because the product's stories depend that way, and spent 81 minutes on a document whose sections nobody had to wait for. Depend only on content you must read before you can write; deps: [] is the right answer more often than it looks.
When several independent subgoals write the same file, give each one the section it owns, by heading, in its title and acceptance[], and say in acceptance[] that it touches no other section. That is what makes them safe to run at once: two nodes editing one document is a conflict only when nobody said which part belongs to whom.
${QUESTIONS_CONTRACT}`,
  critique: `Return JSON: {"sound": true|false, "blocking": ["..."], "problems": ["..."], "handoff": "...", "evidence": "..."}
Look for: wrong decomposition, unfalsifiable acceptance, a missing subgoal the goal needs, fake dependencies, unverifiable test entries, criteria that hinge on whole-repo state, aspirational thresholds written as hard pass/fail bars, a document subgoal whose rubric no reader could apply to the text, and code work filed as a document (or the reverse) so that the wrong chain would check it.
Set sound=false ONLY for defects in "blocking": something that makes the work impossible to do or impossible to verify as specified. Everything else goes in "problems" - it is carried into the next node as advice and does not stop the run.
A spec you would merely improve is not a spec you should reject. Wording you would tighten, a check you would add, a scope note you would sharpen: those are problems, not blockers. An unbounded refutation always finds something, and a gate nothing can pass is not a gate - it is a dead end.
${QUESTIONS_CONTRACT}`,
  implement: `Return JSON: {"stage_ok": true|false, "handoff": "<paths, names, interfaces the dependent work needs>", "changed_files": ["..."], "checks": ["what you ran and what it printed"], "evidence": "..."}
stage_ok=false when required work or checks could not run. Do not report a file as changed unless you changed it.
${UPSTREAM_DEFECT_CONTRACT}`,
  test: `Return JSON: {"stage_ok": true|false, "verified": true|false, "checks": ["command -> observed output"], "evidence": "..."}
stage_ok=false means a required check could not run at all (sandbox, missing tool). verified=false with stage_ok=true means the checks ran and found a genuine failure. Do not edit implementation files. Do not trust the implement narrative - run the checks or inspect the artifacts yourself.
${UPSTREAM_DEFECT_CONTRACT}`,
  investigate: `Return JSON: {"stage_ok": true|false, "handoff": "<the findings path, then the one paragraph the drafter most needs>", "changed_files": ["..."], "sources": ["<path, document or URL you actually opened> -> what it settled"], "findings": ["<term or rule> -> <what it is, stated so a drafter can write from it> -> <the source that says so>"], "unknowns": [{"question": "<the decision no source you reached answers>", "owner": "<the role that would decide it>", "options": [{"option": "<a candidate answer>", "consequence": "<what follows if it is chosen>"}]}], "checks": ["<command or read> -> <what it showed>"], "evidence": "..."}
You are the only stage in this chain that reads anything outside this briefing. Draft, revise and gate see the request, your findings file, and each other - nothing else. What you do not bring back does not exist downstream.
Read in this order, and stop at what is actually reachable: the project tree this run was opened against, whatever sources the request names or attaches, the conventions above, prior documents under the docs path. Then, only if a search tool is actually available to you, the domain's public sources. Write what you found to exactly one path, and that path is derived, not chosen: take this subgoal's own output path from Required paths, drop its extension, and append \`-findings.md\`. \`docs/policy.md\` gives \`docs/policy-findings.md\`. Do not invent a name, do not add a suffix of your own, do not put it in another directory, and name it in "handoff". A real planning run let five sibling investigators name their own files and got five different conventions plus an orphan when one of them retried under a new name - the rule is fixed here so that your siblings and your own later attempts land on the same path, which is also how the fold tells an expected file from an undeclared one.
One distinction is the whole point of this stage: a FINDING is something a source you opened says, and an UNKNOWN is something no source you reached says. Never move the second into the first. A sentence about the domain that sounds right and that you cannot attribute is an unknown, not a finding, however confident it reads.
Every rule a user story will rest on - who is entitled to a thing, what the limit is, how long a window lasts, what happens when something is cancelled, what follows when someone abuses it - comes back as a finding with its source or as an unknown with an owner. There is no third answer. "Assumed to exist" is an unknown wearing a finding's clothes, and a planning run that wrote 588 lines that way (idol-pm-2, 2026-09-22) passed its own gate at 93 while naming none of its domain's actual rules.
stage_ok=false only when you could read nothing at all. A stage that reached few sources and comes back mostly unknowns has succeeded: the unknowns ARE the deliverable, and they are what keeps the drafter from inventing. Returning a short honest findings list is right; padding it is the one failure this stage can hide.
Anything listed above as already decided by a person is a FINDING, not an unknown: cite it as decided and by whom, and never raise it again - not in the same words and not reworded.
An unknown carries "options" whenever the decision has namable candidates - two to four of them, the one you would recommend first, each with the consequence that follows from choosing it. Leave "options" out when you genuinely cannot name candidates; an empty or single-entry list is the same as leaving it out. This is not you deciding: naming what could be chosen is still research, and the person who owns the decision needs candidates far more than they need a blank question. Where the run is interactive, an unknown with options becomes a card that stops the chain and puts the choice to that person before anything is drafted; where it is not, the question is recorded against the document so the report can show what was decided by default.`,
  ask: `Return JSON: {"stage_ok": true|false, "decisions": [{"question": "<the question, as it was asked>", "chose": "<the option you picked, in full>", "because": "<optional: why, or a condition on it>"}], "evidence": "who decided, and when"}
This card is for a person, not a model. Nothing polls it and nothing times it out; the chain below it does not move until you hand it back with tm_submit({task_id, key, payload}).
One entry per question above, using the option text rather than its letter, so the answer still reads correctly if the list is ever renumbered. You are not bound to the candidates: an answer none of them names is a valid "chose", and so is "leave this open" - written out, it becomes an open question with your name on it instead of an assumption with nobody's.
stage_ok=false only if the decision is not yours to make and you are handing it back unanswered.`,
  draft: `Return JSON: {"stage_ok": true|false, "handoff": "<paths written, then a one-paragraph abstract of what the document now says>", "changed_files": ["..."], "checks": ["what you verified about the artifact - structure, cross-references, examples - and how"], "evidence": "..."}
Write the artifact the acceptance describes, at the path the subgoal names. Every acceptance item must be answerable by pointing at a passage. stage_ok=false when the artifact could not be produced. Do not report a file as changed unless you changed it.
${PRD_CONTRACT}
For a planning-kind subgoal, the investigate stage above is your source: write from its findings, cite them where a rule comes from one, and carry every one of its unknowns into the document as an open question with the owner it named. An unknown a person has since ANSWERED arrives above as an \`ask\` stage's decisions[]: that is settled, not open - write it into the document as the rule it now is, say who decided it, and do not also list it among the open questions. An unknown you answer yourself, from nothing, is the failure this chain was rebuilt to stop - you may recommend, but say that is what it is. A planning-kind subgoal writes its section into a markdown document and touches nothing else. Source files are evidence to read, never a place to put the document: a rule written into the file it governs is not a PRD, and this run has no worktree of its own, so an edit there lands in the real project tree. If the subgoal names a path that is not a document, write the document beside it and say so in "handoff" rather than editing source.`,
  review: `Return JSON: {"stage_ok": true|false, "verified": true|false, "checks": ["<acceptance item> -> \"<the passage that meets it>\" (path:line) | MISSING: <what the text lacks>"], "evidence": "..."}
You are the reader, not the author. Open the artifact at the paths the draft reported and read it; do not judge from the draft's abstract. One entry per acceptance item, in order. verified=true only when every item has a quoted passage. stage_ok=false only when the artifact could not be read at all. Do not edit the artifact.`,
  revise: `Return JSON: {"stage_ok": true|false, "handoff": "<what changed, then a one-paragraph abstract of what the document now says>", "changed_files": ["..."], "checks": ["claim -> the evidence you checked it against, or the passage you rewrote and why"], "evidence": "..."}
You are a different identity from draft, and unlike review you may edit the artifact - this is a second pass, not only a judgment. Rewrite for the reader who will actually use this document, and check every claim it makes against the evidence for it; a claim you cannot verify gets fixed or removed, not passed through. stage_ok=false when the artifact could not be revised. Do not report a file as changed unless you changed it.`,
  cases: `Return JSON: {"stage_ok": true|false, "handoff": "<path written, then a one-paragraph summary of what the case set covers>", "changed_files": ["..."], "checks": ["how you derived this case from the acceptance criteria, not from reading the implementation"], "evidence": "..."}
Write the scenario/case specification the acceptance describes, at the path the subgoal names - one case per behavior a user or an attacker could hit, not one per line of implementation. stage_ok=false when the case set could not be produced. Do not report a file as changed unless you changed it.
${QUESTIONS_CONTRACT}`,
  execute: `Return JSON: {"stage_ok": true|false, "verified": true|false, "checks": ["case -> observed outcome"], "defects": ["what failed, and the minimal reproduction"], "evidence": "..."}
There is no separate test node in this chain - this is the test. Run the case set from cases against the tree exactly as written; do not edit it. stage_ok=false means a case could not be run at all. verified=false with stage_ok=true means one or more cases failed - list each in "defects" with enough detail for a develop fix to reproduce it. Write only under test/ or your own report path; do not touch src/.`,
  audit: `Return JSON: {"stage_ok": true|false, "user_stories_checked": ["US-1", "US-2", ...], "unmet": ["US-n -> what the integrated result (and the QA report, if one was considered) shows is still missing"], "qa_considered": true|false, "unowned": ["requirement -> the package that delivered it, NONE if no package did, or <package> -> did not deliver its own stated scope"], "duplication": ["responsibility built more than once -> the packages that each built it, and what shared module it should have been"], "volume": ["package -> files/LOC/tests it delivered -> plausible for its stated scope, or looks like a card was closed rather than a job finished, and why"], "checks": ["<command or read> -> <what it showed>"], "evidence": "..."}
This is planning's own second pass over this EPIC, taken after integration, not the first draft. Open the PRD and its user_stories[], then read the integrated result - diffs, files, the goal's acceptance - for each story: satisfied, partially satisfied, or missing. If a QA report appears among the completed upstream nodes above, treat its defects as further evidence a story is unmet even when the story's own files exist, and set qa_considered=true. If no QA report appears among the upstream nodes, judge from the PRD and the integrated result alone, and set qa_considered=false - do not wait for QA or invent one.
This pass also has to look between and outside the packages, not only inside each story - the seam no gate:Pn or accept:Pn ever checks. Three questions, answered with evidence, not vibes: missing - map every requirement in the PRD or request to the package that implemented it, name any with no owning package, and name any package whose stated scope it did not actually deliver, into "unowned". duplication - name any responsibility two or more packages each implemented, and any type or helper three packages each defined locally instead of sharing, into "duplication", saying what the shared module should be called. volume - for each package, give file/LOC/test counts and say whether that size is plausible for its stated scope, into "volume", with the reasoning that got you there, not just the numbers. An empty list in any of the three is a real finding, not something you skipped.
This is an assessment pass: unlike planning's own revise stage, audit has no edit rights over the PRD or the tree: write your verdict to the report at your subgoal's files[] path, if it names one, and modify nothing else. (awake-beta-ref2 AUDIT:2-3: this line used to say "do not modify any files" while setgoal named docs/prd-audit.md as the deliverable; the audit obeyed, the gate found no report, 0% three times, blocked.) stage_ok=false only when the PRD or the integrated result could not be read at all.`,
  reduce: `Return JSON: {"stage_ok": true|false, "handoff": "<what the set looks like, in one paragraph a judge can read>", "declared": ["<path a subgoal's files[] named> -> written | missing"], "undeclared": ["<path that exists but no subgoal's files[] named> -> the subgoal that wrote it, or UNKNOWN"], "collisions": ["<path> -> the subgoals that both wrote it -> what each claimed to own"], "orphans": ["<path left by a superseded attempt> -> the attempt it belongs to"], "repairs_needed": ["<what the level above should decide, most consequential first>"], "checks": ["<command or read> -> <what it showed>"], "evidence": "..."}
The subgoals above ran in parallel and each wrote its own artifacts. You are the first node that sees them as a SET, and the only one that writes: the goal gate after you judges, it does not tidy.
Read what is actually on disk under the run's output paths, not what the subgoals said they wrote - a handoff is a claim. Compare that against every subgoal's declared files[]. Four things come back: a declared path that does not exist, a file nobody declared, one path two subgoals both wrote, and an artifact left behind by a superseded attempt. One file is expected without being declared: a planning subgoal's investigate stage writes \`<its declared path without the extension>-findings.md\`, so that one is not undeclared - a findings file under any OTHER name is, and that is the case worth catching.
You report; you do not repair. Not the collision, not the orphan, not the undeclared file - every one of them goes back in its list and stays on disk exactly as you found it. The level above decides what happens to them: the goal gate reads your lists as evidence, and the manager sees them through the fold. A stage that observed the set and then acted on it would be deciding at the level that was asked to look, and a repair made here hides the defect from the gate that should have seen it.
Change no files at all - not content, not names, not placement. This stage is about the set, never about the prose.
stage_ok=false only when the output paths could not be read at all. Finding nothing wrong is a successful reduce, not a skipped one - say so with the paths you checked in "checks".`,
  gate: `Return JSON: {"stage_ok": true, "accept": true|false, "match_pct": 0-100, "checks": ["<command or read> -> <what it showed>"], "gaps": ["what blocks acceptance"], "observations": ["weaknesses that do not block"], "reason": "...", "evidence": "..."}
You are the judge, not the actor. Judge only what the evidence below shows. Absent evidence is a gap, not a pass - "the previous node said so" is not evidence.
Put anything that falls short but does not block into "observations" rather than inflating the score past it. A run that met its bar with known weaknesses is not a 100.
accept:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.
If implement or test above reported "upstream_defects" (see "Defects it reported" or their own handoff), copy every one of them through verbatim into your own "upstream_defects": [...] - this gate is the one node the manager's own accept reads for them, so dropping one here loses it for good. Judge this package's own acceptance on its own scope regardless: an upstream defect is not a gap in what THIS package delivered, and must not by itself cost accept or match_pct.
${QUESTIONS_CONTRACT}`,

  'gate:goal': `Return JSON: {"stage_ok": true, "accept": true|false, "match_pct": 0-100, "checks": ["<command or read> -> <what it showed>"], "attacks": ["<command run from OUTSIDE this tree, the way the requester will invoke it> -> <what it showed>"], "gaps": ["what blocks acceptance"], "observations": ["weaknesses that do not block"], "spec_drift": ["where the spec asked for less than the request did"], "reason": "...", "evidence": "..."}
For a planning-kind run producing a PRD, also return "user_stories": [{"id": "US-1", "title": "...", "acceptance": ["..."]}, ...] - one entry per story in the document's "## User stories" section, ids in order; this is the only bridge the task manager has to the PRD's stories.
For a qa-kind run, also return "defects": [...] - every defect any execute node above reported (see "Defects it reported" under each node), copied through verbatim. A QA run's defects are its deliverable, not a reason to withhold accept: the subgoal's job was to run the case set and report what it found, and it did. Do not fold a defect into "gaps" - gaps are what blocks THIS gate's own acceptance of the QA work, defects are what QA found wrong with the thing it was testing, and the task manager reads them from two different places.
You are the judge, not the actor, and you are the only node that sees the original request again. Judge the assembled result against BOTH:
  1. the goal-level acceptance criteria, and
  2. the REQUEST as written at the top of this briefing.
The spec was authored from the request and may have narrowed it. Anything the request asked for that the spec never turned into a criterion belongs in "spec_drift" - the work cannot be faulted for it, but the run must not claim to have delivered it either.
"checks" is not enough by itself: reading diffs and rerunning the subgoals' own test[] only rechecks what the subgoals already claimed to satisfy. "attacks" is invoking the assembled artifact the way the requester actually will - an absolute-path call from a fresh shell outside this tree, \`npm test\` (or whatever the project's real entry point is) run from the project root, the README read cold, as a stranger who has seen none of this run's history. A CLI's own "am I the main module" guard once compared import.meta.url against an unresolved argv path and broke under macOS's /var -> /private/var symlink; three separate gates with checks: [] and no attacks[] passed it, because none of them had ever called it the one way its own user would.
Absent evidence is a gap, not a pass. Weaknesses that do not block go in "observations", not into a rounded-up score.
accept:true with an empty checks[] OR an empty attacks[] is refused by the engine - a judgement with no evidence, or one never invoked from outside the tree, is a guess.
${QUESTIONS_CONTRACT}`,
  repair: `Return JSON: {"stage_ok": true|false, "handoff": "<what changed, and why, across the tree>", "changed_files": ["..."], "checks": ["what you ran and what it printed"], "evidence": "..."}
The goal gate's consensus rejected the assembled result, not any one subgoal - the gaps below are usually in the seam between subgoals that each met their own acceptance, not inside any one of them. You may touch files several subgoals own; that is the point, not a boundary to respect. Fix across the tree. Do NOT restate or narrow the goal-level acceptance criteria to fit what already exists - the gate that follows judges them unchanged, so weakening them here only fails there instead. stage_ok=false when the required fix could not be made. Do not report a file as changed unless you changed it.`,
  report: `Return JSON: {"stage_ok": true, "handoff": "<the final report>", "evidence": "..."}
Synthesize from the node results below only. State plainly what was not done and why.`,
};

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

export function composePrompt(run, n, briefing) {
  const scopedExecution = run.allocation === 'balanced' && ['implement', 'test', 'draft'].includes(n.stage) && briefing.subgoal;
  const lines = [];
  lines.push(`# ${n.stage} node ${n.node_id}`);
  lines.push('');
  if (n.recovery) {
    lines.push('## Resume after interrupted execution');
    lines.push(`Read checkpoint: ${n.recovery.checkpoint_path}`);
    lines.push('The previous session may have changed files. Inspect the current working tree and the checkpoint before continuing.');
    lines.push('Retain the original acceptance criteria. Reuse completed work only after inspection; rerun required checks. Do not treat partial output as a passed stage.');
    lines.push('Read detailed prior logs only if needed; do not import the whole prior conversation.');
    lines.push('');
  }
  lines.push(`Working directory: ${run.cwd}`);
  lines.push(`Every command you run and every file you touch must be inside it.`);
  lines.push('');
  // Observed: a vendor with harness skills installed re-entered the harness from inside
  // a harness node - running codex-exec-adapter --detect, then --stage implement and
  // --stage test within the node that was already the implement stage. Four wasted
  // invocations, muddled evidence, and nothing stopping it from nesting further.
  lines.push(`You ARE this node of the harness graph. Do the stage work directly with your`);
  lines.push(`own tools. Do not re-enter the harness from inside it: no codex-exec-adapter.mjs,`);
  lines.push(`no codex-runner.mjs, no nested \`codex exec\`, no harness pipeline or broker call.`);
  lines.push(`Routing, verification, and the graph are already handled around you.`);
  lines.push('');

  if (REASONING_STAGES.has(n.stage)) {
    lines.push(`This is a reasoning node. Do not modify project files.`);
    lines.push('');
  }

  if (!scopedExecution) {
    lines.push(`## Request`);
    lines.push(run.request);
  }
  if (run.context && !scopedExecution) {
    lines.push('');
    lines.push(`## Context from the requester`);
    lines.push(run.context);
  }

  if (['plan', 'setgoal', 'critique'].includes(n.stage)) {
    lines.push('');
    lines.push(`## Flow`);
    if (briefing.flow === 'auto' && !briefing.flow_chosen) {
      lines.push(`auto — plan decides. develop: the deliverable is code the repository must run; document: the deliverable is text a reader must find things in.`);
    } else {
      const f = briefing.flow_chosen || briefing.flow;
      lines.push(`${f}${briefing.flow === 'auto' ? ' (chosen by plan)' : ' (fixed by the entry)'} — default kind for a subgoal that names none: ${briefing.default_kind}.`);
      if (briefing.mixed === false) lines.push(`mixed=false: every subgoal must be kind ${briefing.default_kind}. A subgoal of another kind fails the spec.`);
      else lines.push(`mixed=true: a subgoal may name another kind when the work genuinely is one.`);
      if (FLOWS[f] && n.stage === 'setgoal') lines.push(`Personas to draw from:\n${bullets(FLOWS[f].personas)}`);
      // A planning run decides its own document set. Without this, setgoal sees only the generic
      // "document" kind and writes one PRD in sections - which is what both real planning runs
      // did (idol-pm-1/2, 2026-09-22), and why the domain's own rules ended up in Out of scope
      // or in an open question rather than in a document of their own.
      if (f === 'plan' && ['plan', 'setgoal'].includes(n.stage)) lines.push(PLANNING_SETGOAL);
    }
    if (briefing.size) lines.push(`size: ${briefing.size}`);
  }

  if (['plan', 'setgoal'].includes(n.stage)) {
    const conv = conventionsBlock(run.cwd, { stage: n.stage });
    if (conv) {
      lines.push('');
      lines.push(conv);
    }
  }

  if (briefing.goal && !scopedExecution) {
    lines.push('');
    lines.push(`## Goal`);
    lines.push(briefing.goal);
    lines.push('');
    lines.push(`## Goal-level acceptance`);
    lines.push(bullets(briefing.goal_acceptance));
  }

  if (briefing.subgoal) {
    const sg = briefing.subgoal;
    lines.push('');
    lines.push(`## Subgoal ${sg.id} — ${sg.title}`);
    if (sg.kind && sg.kind !== 'subgoal') lines.push(`Kind: ${sg.kind}`);
    // Persona and method belong to whoever does the work, not to whoever judges it. The
    // subgoal block is shared by every stage in the chain, so a gate used to be told "act as
    // the implementer who owns this module" two lines above its contract telling it it is the
    // judge and not the actor - the exact identity the gate exists to not have.
    const authoring = !REASONING_STAGES.has(n.stage) && !VERDICT_FIELD[n.stage];
    if (sg.persona && authoring) lines.push(`Act as: ${sg.persona}`);
    // Method comes from the kind, by stage. A spec that named its own replaces the family
    // for the hand that writes; a judge keeps the family's, because a judge's method is not
    // the author's to choose.
    const method = authoring && sg.skills?.length ? sg.skills : kindSkills(kindOf(sg), n.stage);
    // A persona says who is working; skills say how. setgoal names them per subgoal because
    // it is the stage that knows what the work is - a migration wants different method than
    // a reference document. Same precedence as everywhere else: the node contract wins, a
    // missing skill is skipped in silence, and nobody is there to answer a question.
    if (method.length) {
      lines.push(`Method — load each of these that is available, then work the way it says:\n${bullets(method)}`);
      lines.push(SKILL_METHOD_DISCLAIMER);
      lines.push(SKILLS_USED_FIELD);
    }
    if (sg.files?.length) lines.push(`Required paths:\n${bullets(sg.files)}`);
    // setgoal names what a planning document's investigator should open in sources[], apart from
    // files[], which is what the subgoal writes. The two shared one field until idol-pm-3
    // (2026-09-23): setgoal put .claude/team.json in files[] as a source to read, and the
    // document-path rule rejected the spec for it.
    if (sg.sources?.length && (n.stage === 'investigate' || n.stage === 'audit')) lines.push(`Sources to open first:\n${bullets(sg.sources)}`);
    if (['implement', 'investigate', 'draft', 'revise'].includes(n.stage)) {
      // A planning subgoal writes the PRD, which governs the whole tree - its conventions are
      // not selected by the paths it touches.
      const planning = kindOf(sg) === 'planning';
      const conv = conventionsBlock(run.cwd, { stage: planning ? 'planning' : n.stage, files: sg.files });
      if (conv) {
        lines.push('');
        lines.push(conv);
      }
    }
    lines.push('');
    lines.push(`### Acceptance`);
    lines.push(bullets(sg.acceptance));
    if ((sg.test || []).length) {
      lines.push('');
      lines.push(`### Checks`);
      lines.push(bullets(sg.test));
    }
  }

  if (briefing.subgoals && briefing.subgoals.length) {
    lines.push('');
    lines.push(`## Subgoals in the spec`);
    for (const sg of briefing.subgoals) {
      lines.push(`### ${sg.id} — ${sg.title}`);
      if (sg.kind && sg.kind !== 'subgoal') lines.push(`Kind: ${sg.kind}`);
      if ((sg.deps || []).length) lines.push(`Depends on: ${sg.deps.join(', ')}`);
      lines.push(`Acceptance:`);
      lines.push(bullets(sg.acceptance));
      if ((sg.test || []).length) {
        lines.push(`Checks:`);
        lines.push(bullets(sg.test));
      }
      lines.push('');
    }
  }

  if (briefing.whole_run && briefing.whole_run.length) {
    lines.push('');
    lines.push(`## Every node in this run`);
    lines.push(`Judge from these facts. A node that failed, was skipped, or became unreachable is part of the outcome.`);
    for (const x of briefing.whole_run) {
      const verdict = [
        x.state,
        x.vendor ? `vendor=${x.vendor}` : '',
        x.verified === undefined ? '' : `verified=${x.verified}`,
        x.accept === undefined ? '' : `accept=${x.accept}`,
        x.sound === undefined ? '' : `sound=${x.sound}`,
        x.match_pct === undefined ? '' : `match=${x.match_pct}%`,
        x.changed_files_verified === undefined || x.changed_files_verified === null
          ? ''
          : `files_verified=${x.changed_files_verified}`,
      ].filter(Boolean).join(' ');
      lines.push(`### ${x.node_id} (${x.stage}) — ${verdict}`);
      if (x.changed_files.length) lines.push(`Changed: ${x.changed_files.join(', ')}`);
      if (x.checks.length) lines.push(`Checks:\n${bullets(x.checks)}`);
      // An execute node's own deliverable (prompts.mjs's execute contract) when it found real
      // defects. The goal gate and the report must carry these forward, not fold them into
      // gaps: a QA run that found defects still did its job - the defects are the point.
      if ((x.defects || []).length) lines.push(`Defects it reported:\n${bullets(x.defects)}`);
      if ((x.upstream_defects || []).length) lines.push(`Upstream defects it reported:\n${bullets(x.upstream_defects.map((d) => `${d && d.package ? `${d.package}: ` : ''}${(d && d.title) || String(d)}`))}`);
      if (x.handoff) lines.push(capHandoff(x.handoff));
      if (x.evidence) lines.push(`Evidence: ${x.evidence}`);
      if (x.gaps.length) lines.push(`Gaps:\n${bullets(x.gaps)}`);
      if (x.reason) lines.push(`Reason: ${x.reason}`);
      lines.push('');
    }
  }

  if (briefing.upstream.length) {
    lines.push('');
    lines.push(`## Completed upstream nodes`);
    for (const u of briefing.upstream) {
      const verdict = [
        u.state,
        u.verified === undefined ? '' : `verified=${u.verified}`,
        u.changed_files_verified === undefined || u.changed_files_verified === null
          ? '' : `files_verified=${u.changed_files_verified}`,
        u.commands_executed === undefined ? '' : `commands=${u.commands_executed}/${u.commands_failed} failed`,
      ].filter(Boolean).join(' ');
      lines.push(`### ${u.node_id} (${u.stage})${verdict ? ' — ' + verdict : ''}`);
      if (u.changed_files.length) lines.push(`Changed: ${u.changed_files.join(', ')}`);
      if (u.checks.length) {
        lines.push(`Checks it reported running:`);
        lines.push(bullets(u.checks));
      }
      if ((u.defects || []).length) {
        lines.push(`Defects it reported:`);
        lines.push(bullets(u.defects));
      }
      if ((u.upstream_defects || []).length) {
        lines.push(`Upstream defects it reported:`);
        lines.push(bullets(u.upstream_defects.map((d) => `${d && d.package ? `${d.package}: ` : ''}${(d && d.title) || String(d)}`)));
      }
      if (u.commands.length) {
        lines.push(`Commands actually observed by the adapter:`);
        lines.push(bullets(u.commands.map((cmd) => String(cmd).slice(0, 300))));
      }
      if (u.decisions && u.decisions.length) {
        lines.push(`Decided by a person — these are settled, write them as rules, not as open questions:`);
        lines.push(bullets(u.decisions.map((d) => `${d.question} -> ${d.chose}${d.because ? ` (${d.because})` : ''}`)));
      }
      if (u.handoff) lines.push(capHandoff(u.handoff));
      if (u.evidence) lines.push(`Evidence: ${u.evidence}`);
      lines.push('');
    }
  }

  // Deterministic, computed off run state (graph.mjs's computeWriteScope) - not this stage's
  // own reading of the tree. Shown whenever it exists (reduce, and the goal gate behind it) so
  // a collision the CONTRACT's "name the heading you own" convention missed is visible before
  // either has to notice it in prose. An empty result is not omitted: "checked, found nothing"
  // is itself worth a judge or a fold seeing, the same reasoning prompts.mjs's own reduce
  // contract gives for its own findings lists.
  if (briefing.write_scope) {
    const ws = briefing.write_scope;
    lines.push('');
    lines.push(`## Sibling write-scope check (computed, not self-reported)`);
    if (ws.collisions.length) {
      lines.push(`Files more than one subgoal wrote with no single declared owner:`);
      lines.push(bullets(ws.collisions.map((c) => `${c.file} -> written by ${c.written_by.join(', ')}; declared by ${c.declared_by.length ? c.declared_by.join(', ') : '(nobody)'} — ${c.reason}`)));
    }
    if (ws.undeclared_writers.length) {
      lines.push(`Subgoals that wrote a file another subgoal declared as its own:`);
      lines.push(bullets(ws.undeclared_writers.map((u) => `${u.subgoal_id} wrote ${u.file}, declared by ${u.declared_owners.join(', ')}`)));
    }
    if (ws.heading_collisions.length) {
      lines.push(`Subgoals sharing one document without a clear per-heading split:`);
      lines.push(bullets(ws.heading_collisions.map((h) => `${h.file}: ${h.subgoals.join(' & ')} — ${h.reason}`)));
    }
    if (!ws.collisions.length && !ws.undeclared_writers.length && !ws.heading_collisions.length) {
      lines.push(`Checked: no undeclared file or heading collisions among these subgoals.`);
    }
  }

  if (briefing.prior_feedback) {
    lines.push('');
    lines.push(`## Previous attempt was rejected — fix this`);
    if (n.stage === 'setgoal' && briefing.spec_problems && briefing.spec_problems.length) {
      lines.push(DEGENERATE_SPEC_DIAGNOSIS);
      lines.push('');
      lines.push(`The specific fields that failed:`);
      lines.push(bullets(briefing.spec_problems));
      lines.push('');
    }
    lines.push(briefing.prior_feedback);
  }

  // Decisions a person has already made for this subgoal, carried across a retry. Printed for
  // every stage, not only investigate: a draft on attempt 3 needs them as much as the stage that
  // decides what is still open.
  if (briefing.prior_decisions && briefing.prior_decisions.length) {
    lines.push('');
    lines.push(`## Already decided by a person — settled, do not raise these again`);
    lines.push(`These hold for the whole run, whichever part of it they were asked under: your document must agree with them, and a question that is one of these in other words is not open.`);
    lines.push(bullets(briefing.prior_decisions.map((d) => `${d.question} -> ${d.chose}${d.because ? ` (${d.because})` : ''}${d.decided_for ? ` [decided under ${d.decided_for}]` : ''}`)));
    lines.push('A question above is answered. Write it as the rule it now is; do not list it as an open question, and do not ask it again in any form - a reworded repeat of a settled decision is the same defect as an identical one.');
  }

  // An `ask` node's briefing is read by a PERSON (tm_inbox hands them this path), not by a
  // model - it is the only briefing in this file with that audience, and the questions live on
  // the node rather than in a dep's result, so nothing above would have printed them.
  if (n.stage === 'ask' && Array.isArray(n.questions) && n.questions.length) {
    lines.push('');
    lines.push(`## Decisions waiting on you`);
    lines.push(`The investigation could not settle these from any source it reached. Nothing downstream is written until they are answered.`);
    n.questions.forEach((q, i) => {
      lines.push('');
      lines.push(`### ${i + 1}. ${q.question || q.unknown}`);
      if (q.owner) lines.push(`Owner: ${q.owner}`);
      lines.push(bullets((q.options || []).map((o, j) => {
        const label = typeof o === 'string' ? o : (o.option || '');
        const why = typeof o === 'string' ? '' : (o.consequence ? ` — ${o.consequence}` : '');
        return `${String.fromCharCode(97 + j)}) ${label}${why}${j === 0 ? '  [what the investigation would recommend]' : ''}`;
      })));
    });
  }

  lines.push(mountBlock(run, n));

  lines.push('');
  lines.push(`## Required output`);
  const contract = n.node_id.startsWith('gate:goal') ? CONTRACT['gate:goal'] : CONTRACT[n.stage];
  lines.push(contract || CONTRACT.implement);
  lines.push('');
  lines.push(`Return that JSON object and nothing else.`);
  return lines.join('\n');
}
