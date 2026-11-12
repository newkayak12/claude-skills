---
name: resume-builder
effort: medium
description: >-
  Use when a resume must be written into the user's own Word template: "이력서 만들어줘", "이력서 docx",
  "Word 템플릿에 이력서", "resume docx", "build my resume from this template". Catalog, build, check, PDF, fit.
scenarios:
  - "Build my resume into this Word template from resume-deck.mdx, then render the PDF."
  - "The resume is two lines over one page — tell me what to cut."
  - "Map this template's lines to roles: it is all Normal, only the run format differs."
  - "이력서 만들어줘. 내 템플릿 docx 그대로 쓰고 사진도 유지해줘"
  - "이력서 docx 뽑고 PDF로 페이지 수 확인해줘"
  - "Word 템플릿에 이력서 채워줘, 한 장에 맞게"
compatibility:
  required:
    - python 3.9+ (stdlib only)
  recommended:
    - LibreOffice (soffice on PATH) or DECK_RENDER_DOCKER=<image> — `render` needs it; catalog and build do not
    - pdftotext (poppler) — `over_lines` needs it
  remote_mcp_note: >-
    LibreOffice가 없으면 `build`까지는 동작하고 `render`만 멈춥니다. 페이지 수와 넘친 줄 수는 렌더한
    PDF에서만 알 수 있으니 가능하면 설치하세요.
---

# Resume Builder — resume-deck.mdx into the user's own .docx

The user's template is the toolchain; the build copies its look, never a re-styled copy. **Not for** what
the resume says (`manage` step 9 designs `resume-skeleton.md`) or a pptx (`deck-builder`).

Engine, run from the workspace root: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/resume-builder/scripts/resume.py <cmd>`
(`catalog`, `build`, `render`; one JSON object each). Detail: `references/resume.md`.

## Process

1. **Catalog.** `catalog --template template/<file>.docx`: paragraph styles (id, name, count, sample,
   suggested role) and `looks` (each distinct size, weight, colour, list once, with its text).
2. **Front matter.** In `resume-deck.mdx`: `template:`, `pages:` (the user's budget), and one mapping.
   `styles:` role → paragraph style when the template has real styles; `samples:` role → the opening
   text of the template paragraph whose look it takes when every line is `Normal`.
   Roles: `#` name, `##` section, `###` entry, `-` bullet, plain body; any other `{role} text`.
   Finish from the front matter, never a post-build script: `title:`, `author:`, `photo_alt:`, `keep:`
   (roles held with the next line), `spacing:` (pt) where the template reads too tight, `look:` (size,
   colour, label colour) where a sample is too small or faint; a
   `라벨: 값` line takes a two-format sample's label and value; links are made by the build.
   Every entry of one kind has the same lines (each project its 설명·기술·역할, each company its
   bullets); one with less is filled from the skeleton or asked, never left uneven. Each entry keeps
   its `글감: <id>` line (dropped by the build) so `manage claims --file resume-deck.mdx` can check it.
3. **Build.** `build` copies the template, drops its sample body, writes each line in its role's look
   (numbering included), keeps the photo on the first paragraph. A role mapped nowhere, a style the
   template lacks, or a sample text no paragraph starts with is refused before anything is written.
4. **Final checks.** The build output carries `warnings` (an unconfirmed `[확인 필요: …]` line is kept
   and named) and `ai_traces: {removed, removed_text, reported}`. A submitted document carries no AI
   trace (user, 2026-11-11: "흔적을 다 지워야죠 공식적으로 제출하는 문서인데"): an AI disclaimer in alt
   text, an AI tool or library in the document properties, and every visible sentence that says AI
   wrote it or may be wrong ("ChatGPT로 작성", "AI로 작성해서 틀릴 수 있습니다", `Generated with`,
   `Co-Authored-By`, a model as writer) are taken out; the rest of the paragraph stays. Say each
   `removed_text` line to the user and fix the same words in `resume-deck.mdx`, or the next build brings them back.
   Nothing is called submittable before `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/office_render.py final-check
   [--dir build] [--allow "Claude Code,Codex"] [--author NAME]` has run over `resume.docx` and `resume.pdf`:
   one verdict per file (`깨끗함` or the list), exit non-zero on any finding. It takes the same traces
   out of the docx (`--author` writes creator and last editor), renders the PDF again from a docx it
   changed, and checks PDF metadata and text. Work annotations (`[확인 필요`, `TODO`, `FIXME`,
   `(본인 확인`) are questions, reported and kept until the person answers. `--allow` lists the tools
   the person really lists as their own skills ("Claude Code로 개발" stays).
5. **Render.** Only when the user says: `render` writes `build/resume.pdf`, counts pages against `pages:`,
   rewrites the page previews `build/pages/resume-p-N.png` (stale ones deleted) and prints the
   `final_check` verdicts.
6. **Review.** After every render, not only when over budget, run `render-review` on the PDF and its fresh previews.
7. **Fit.** Over budget: `over_lines` is the number of text lines past the last allowed page. Propose
   cuts with their line counts (a section, a block to one bullet) and wait. Cut text, never type size,
   line spacing or margins. Then render and review again.

The user's material never goes to git: the engine refuses a template, source or output a git repository
would carry (`.gitignore` it or work outside it).

## Output Template

```
이력서 <빌드함 | 안 함> — <paragraphs>줄, 템플릿 <file>
매핑: <styles | samples>로 <roles>
최종 검사: final-check <파일별 깨끗함 | n건 (<항목>)> · AI 흔적 <removed>건 제거 · [확인 필요] <n>건
렌더: <pages>쪽 / 예산 <pages>쪽 · 넘친 줄 <over_lines | 없음 | 렌더 안 함>
정하실 것: <잘라낼 후보와 줄 수 | 없음>
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Lists the template's styles and looks, proposes the role mapping | Confirm the mapping; say which lines are which when the template does not |
| Builds into your template, keeps the photo, runs the final AI-trace check | Provide the template and `resume-deck.mdx`; keep both out of git |
| Takes every AI trace out and lists what it took; reports every unconfirmed line | Answer `[확인 필요]` lines; fix removed lines in your source |
| Renders when told, sizes the cut by `over_lines`, waits | Say when to render; choose what to cut |

## Related Skills

- `manage` — step 9 designs the resume (`resume-skeleton.md`) and calls this skill to build it
- `render-review` — page-by-page review of the rendered PDF
- `deck-builder` — the pptx counterpart; same renderer and the same final AI-trace check
- `write:like-me` — the voice of every sentence written into the source
