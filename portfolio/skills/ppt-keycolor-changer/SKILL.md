---
name: ppt-keycolor-changer
description: >-
  Use when the user wants to change, swap, or replace colors in a PPTX/PPT file.
  Also triggers on: PPT 키컬러 변경, 슬라이드 색상 교체, 브랜드 컬러로 교체, 색상 일괄 변경,
  ppt keycolor, 키컬러 교체, 브랜드 적용, 색상 전체 바꿔줘, 색상 스캔해줘, 팔레트 교체.
effort: medium
scenarios:
  - "이 PPT에서 오렌지 계열 색을 전부 토스 파란색으로 바꿔줘"
  - "presentation.pptx 키컬러를 새 브랜드 팔레트로 교체해줘"
  - "PPT 파일에 어떤 색이 얼마나 쓰였는지 먼저 알아봐줄 수 있어?"
  - "Change all #E85E3A and its tonal variants to our new brand blue in my pptx"
  - "슬라이드 색상 전수 스캔해서 교체 후보 보여줘"
compatibility:
  required:
    - python 3.9+ (stdlib only — zipfile, re, colorsys; no external packages needed)
---

## What this skill does

Discovers every color in a PPTX file by scanning raw XML, then replaces source colors
with target colors via case-insensitive string replacement — capturing 100% of color
references including theme tokens, gradient stops, chart series, table cells, hyperlinks,
and schemeClr mappings that python-pptx's API misses.

---

## 7-Step Workflow

### Step 0 · Validate Input

- Accept `.pptx` or `.pptm` only. Reject `.pdf`, `.key`, `.odp`.
- If the user provides a path that ends in `.pdf`, or a directory that contains both
  `foo.pdf` and `foo.pptx`, explicitly confirm: "PPTX 파일로 진행하겠습니다."
- The bundled script is at `scripts/ppt_keycolor_changer.py` relative to this skill root.
  Always use an absolute path when invoking it.

---

### Step 1 · Discover Palette

Run discovery **before** asking about target colors. Always do this first.

```bash
python /abs/path/to/scripts/ppt_keycolor_changer.py discover \
  --input "path/to/file.pptx"
```

This scans all `.xml` and `.rels` entries inside the PPTX ZIP and prints a frequency
table of every `val="XXXXXX"` hex value found — theme file, slide layouts, chart XML,
table styles, hyperlinks — everything.

Present the table to the user, then:

1. **Identify key color candidates**: high-frequency, non-grayscale colors are usually
   brand key colors.
2. **Cluster by hue**: if the user said "오렌지 계열" or named a hue, group discovered
   colors within HSL hue ±15° of that hue and show the cluster as the replacement candidates.
3. **Flag grayscale / always-excluded colors**: mark `#000000`, `#FFFFFF`, `#F9F9F9`, and
   colors with RGB max−min ≤ 20 — these will be preserved by default.
4. **Accent check**: for low-frequency colors, ask whether they should also be replaced
   or left alone.

---

### Step 2 · Resolve Target Colors

The user can specify a target in three ways:

**A. Brand preset** — e.g., "토스 파란색", "Apple blue":

| Preset | Main | Light | Lighter | Muted | Dark |
|---|---|---|---|---|---|
| `toss-vivid` | `0064FF` | `4D96FF` | `99C2FF` | `CCE0FF` | `0047B3` |
| `toss-soft` | `4AC4FF` | `85D8FF` | `C2ECFF` | `B0D8F0` | `0098D9` |
| `apple-blue` | `007AFF` | `5BA4FF` | `B3D1FF` | `D1E7FF` | `005EC2` |
| `material-indigo` | `3F51B5` | `7986CB` | `C5CAE9` | `E8EAF6` | `283593` |
| `kakao-yellow` | `FEE500` | `FFE85C` | `FFF2A0` | `FFF7CC` | `C9B800` |
| `naver-green` | `03C75A` | `3FD882` | `90E8BA` | `C5F5DD` | `029944` |

**B. Custom hex** — user provides exact hex value(s). Use as-is.

**C. Color name** — resolve from knowledge (e.g., "카카오 노란색"), state the hex you
intend to use, and ask for explicit confirmation before proceeding.

---

### Step 3 · Auto-Map Source Palette → Target Palette

When the source has multiple tonal variants (vivid, light, lighter, muted) and the target
is a preset, map by **HSL lightness rank** to preserve the visual hierarchy:

1. Take the source color cluster from Step 1 (all colors within hue ±15°).
2. Sort them by HSL lightness (L value), darkest to lightest.
3. Sort the target preset's 5 tones by lightness in the same order.
4. Pair 1:1 in lightness order.

If the source has more tones than the target has slots, ask the user which extras to merge
into the closest target tone.

---

### Step 4 · Confirm Mapping Table

Show the full proposed mapping **before running anything**. Format it clearly:

```
Source color  →  Target color    (occurrences)
#E85E3A       →  #0064FF         (193 ← main key color)
#FF8060       →  #4D96FF         (42  ← light variant)
#FFB399       →  #99C2FF         (18  ← lighter variant)

Preserved (won't be touched):
  #000000   [always-exclude]
  #FFFFFF   [always-exclude]
  #808080   [grayscale]
  #336699   [different hue — >60° from source]
```

Also list any colors the user flagged as "leave alone" from the Step 1 review.

Get explicit user confirmation before running Step 5.

---

### Step 5 · Apply via Raw XML Replace

```bash
python /abs/path/to/scripts/ppt_keycolor_changer.py replace \
  --input  "path/to/file.pptx" \
  --mapping '{"E85E3A":"0064FF","FF8060":"4D96FF","FFB399":"99C2FF"}' \
  [--exclude "336699,AABBCC"]   \
  [--suffix tossblue]
```

**Arguments:**

| Flag | Required | Description |
|---|---|---|
| `--input` | yes | Source `.pptx` path |
| `--mapping` | yes | JSON of `"SRC_HEX":"DST_HEX"` pairs (uppercase, no `#`) |
| `--exclude` | no | Comma-separated extra hexes to never replace |
| `--suffix` | no | Label appended to output filename: `file_tossblue.pptx` |
| `--output` | no | Full custom output path (overrides auto-naming) |

**Output naming**: `<original>_<target_or_suffix>.pptx`. If that file already exists,
auto-increments to `_v2`, `_v3`, etc. — no silent overwrites.

**Built-in exclude defaults** (always applied): `#000000`, `#FFFFFF`, `#F9F9F9`, `#FEFEFE`, `#FDFDFD`.

---

### Step 6 · Verify Zero Residuals

The script automatically re-scans the output file after replacement and reports:

- `OK — no residual source colors found.` → done.
- `WARNING — #E85E3A: 12 occurrences remain` → investigate.

If residuals remain after replacement, they almost always mean one of two things:
- **Embedded images (PNG/JPEG/WMF/EMF)** contain the color — the script cannot change
  pixels inside binary media files.
- **External Excel workbook** linked to a chart — some series colors live in the `.xlsx`
  and are not part of the PPTX XML.

Report both cases explicitly to the user.

---

### Step 7 · Report

After completion, tell the user:

1. Output file path (full, absolute)
2. Replacement count per source color
3. Verification result (zero residuals, or list of exceptions with cause)
4. Preserved colors and the reason each was skipped
5. **Always include this caveat**:
   > ⚠️ 슬라이드에 삽입된 이미지(PNG/JPEG 등) 내부의 색상은 XML 치환으로 변경되지 않습니다.
   > 해당 이미지는 포토샵 등에서 별도로 수정이 필요합니다.

---

## Preservation Filter (Default Rules)

The following categories are **never replaced** by the script's built-in defaults and
should be excluded from the mapping Claude proposes:

| Category | Rule |
|---|---|
| Pure black / white | `#000000`, `#FFFFFF`, `#F9F9F9`, `#FEFEFE`, `#FDFDFD` |
| Grayscale | RGB max − min ≤ 20 |
| Different hue family | HSL hue > 60° away from all source colors |

To override a default exclusion, the user must explicitly include it in `--mapping`.

When presenting the Step 4 confirmation table, call out any "don't touch" candidates with
a brief reason so the user can consciously override if they want.

---

## Limitations

| Limitation | Detail |
|---|---|
| **Embedded images** | PNG/JPEG/WMF/EMF inside the PPTX are binary. Pixel colors cannot be changed via XML substitution. Flag any residuals from images in Step 7. |
| **External Excel charts** | If a chart's data is linked to an external `.xlsx`, some series colors are defined there and won't be replaced. The embedded `chartX.xml` inside the PPTX is still processed. |
| **Linked theme tokens (schemeClr)** | Elements using `<a:schemeClr>` reference a theme slot rather than a direct hex. Replacing the hex in `ppt/theme/theme1.xml` propagates to all such elements — the script handles this correctly because it processes every XML file including the theme. |
| **Passwords / encrypted PPTX** | Cannot open the ZIP. Ask the user to remove the password before running. |
