# ATS Rules — Korean Job Market Reference

Shared reference for portfolio/ skills (resume-tailorer, portfolio-rewrite, etc.).
Covers keyword matching rules and formatting considerations for ATS systems used by Korean employers.

---

## Why ATS Matters in the Korean Market

Many Korean companies — including chaebols, large tech firms, and mid-size companies using platforms
like Wanted, Saramin, JobKorea, or in-house HR systems — pass resumes through automated screening
before any human review. A resume can be factually correct and well-written but still fail ATS
screening if the vocabulary does not match the JD's exact phrasing.

---

## Keyword Matching Rules

### 1. Use the Exact JD Phrasing

If the JD says "대용량 트래픽 처리" and you write "고성능 시스템 운영", ATS may not match them.
Use the JD's exact phrase where the experience is accurate — do not paraphrase.

### 2. Frequency Signals Emphasis

A skill or requirement that appears multiple times in the JD is weighted more heavily.
Front-load the resume's skills section and summary with high-frequency JD terms.

### 3. Spell Out Acronyms Once

Write out acronyms on first use, then use the abbreviation:
- "CI/CD (지속적 통합 및 배포)"
- "MSA (마이크로서비스 아키텍처)"
- "OKR (목표 및 핵심 결과 지표)"

This ensures both the abbreviation and the full form are indexed.

### 4. Korean and English Variants

Some ATS systems index Korean and English separately. For key technologies, include both forms
where natural:
- "쿠버네티스 (Kubernetes)"
- "스프링 부트 (Spring Boot)"

Do not force this for every term — use judgment on where it reads naturally.

---

## Formatting Rules

### Avoid Tables and Text Boxes

ATS parsers commonly drop content inside HTML tables, Word text boxes, or multi-column layouts.
Use plain linear text for all experience and skills content.

### File Format

Submit as PDF unless the JD or application system specifies otherwise. PDFs preserve formatting
and are parsed reliably by modern ATS systems. Do not use HWP (한글) unless explicitly required —
HWP parsing in ATS is inconsistent.

### Section Headers

Use standard section labels that ATS systems are trained to recognize:
- 경력 / Work Experience
- 기술 스택 / Skills
- 학력 / Education
- 자격증 / Certifications

Avoid creative headers like "내가 해온 것들" — ATS may not classify the section correctly.

### No Headers/Footers for Critical Content

ATS parsers frequently skip content in page headers and footers. Put name, contact, and role
title in the body of the document.

---

## Platform-Specific Notes

| Platform | Notes |
|----------|-------|
| Wanted | Structured form entry — keywords in each field matter most |
| Saramin / JobKorea | PDF upload + keyword extraction; exact match scoring |
| LinkedIn (Korea) | English and Korean profiles indexed separately; maintain both if targeting global roles |
| Company career portals (삼성, 카카오, 네이버 등) | In-house ATS varies; follow JD language exactly |

---

## Usage Notes

- These rules apply during the keyword alignment step of resume tailoring.
- For culture-fit vocabulary adjustments by company type, see `korea-company-culture-signals.md`
  in this same directory.
