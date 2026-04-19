---
name: ppt-keycolor-changer
description: >-
  Use when the user wants to change, swap, or replace colors in a PPTX/PPT file.
  Triggers on: "PPT 색상 바꿔줘", "키컬러 변경", "슬라이드 색상 교체", "change ppt colors",
  "ppt keycolor", "색상 일괄 변경", "브랜드 컬러로 교체", "replace colors in presentation".
scenarios:
  - "이 PPT에서 #003087을 토스 파란색으로 바꿔줘"
  - "presentation.pptx의 배경색 (0, 56, 135)를 전부 #FF5733으로 교체해줘"
  - "PPT 키컬러를 새 브랜드 팔레트로 일괄 변경해줘"
  - "Change all occurrences of #003087 and #E8E8E8 to new brand colors in my pptx"
  - "슬라이드에 쓰인 파란색 계열을 전부 새 팔레트로 교체하고 싶어"
compatibility:
  required:
    - python-pptx (pip install python-pptx)
---

## What this skill does

Finds every element in a PPTX file that uses a specified color (fill, text, line, background, chart) and replaces it with a new color — across all slides at once. Saves as a new file.

---

## Step 1: Resolve colors

The user may specify colors in several ways. Before running the script, normalize all colors to hex:

| Input format | Example | Resolution |
|---|---|---|
| Hex string | `#FF5733` or `FF5733` | Use as-is |
| RGB tuple | `(255, 87, 51)` | Convert: `#FF5733` |
| RGBA tuple | `(255, 87, 51, 0.5)` | Use RGB part only: `#FF5733` |
| Brand/named color | `토스 파란색`, `카카오 노란색`, `Apple blue` | Resolve from your knowledge, then confirm with user |

When the user says a brand color name, state the hex you'll use and ask for confirmation before running the script. Example:
> "토스 파란색은 `#0064FF`로 알고 있어요. 이걸로 진행할까요?"

---

## Step 2: Build color mapping

Collect all (source → target) color pairs. There can be multiple pairs.

Example mappings the user might give:
- "배경의 `#003087`을 `#0064FF`로, 텍스트 `#1A1A1A`는 `#111111`로"
- "두 색을 바꿔줘: 파란색 `#0055B3` → `#FF5733`, 회색 `(200,200,200)` → `#CCCCCC`"

Build a JSON map: `{"OLD_HEX": "NEW_HEX", ...}` (all uppercase, no `#` prefix).

---

## Step 3: Run the script

Use the bundled script `scripts/ppt_keycolor_changer.py`.

```bash
python scripts/ppt_keycolor_changer.py \
  --input "path/to/file.pptx" \
  --mapping '{"003087": "0064FF", "1A1A1A": "111111"}' \
  --tolerance 5
```

**Arguments:**
- `--input`: path to the source PPTX file
- `--mapping`: JSON string of `OLD_HEX → NEW_HEX` pairs (no `#`, uppercase)
- `--tolerance` (optional, default `0`): color match tolerance (0–30). Use `5–10` when the user says "이 색 계열 전부" or if exact matches are sparse. Keep at `0` for precise replacement.
- `--output` (optional): custom output path. Default: `<original_name>_recolored.pptx` in same directory.

The script prints a summary of how many replacements were made per color per element type.

---

## Step 4: Report results

After the script finishes, tell the user:
1. Output file path
2. Total replacements per color (e.g., "003087 → 0064FF: 47 replacements across 12 slides")
3. Element types changed (fills, text, lines, backgrounds, charts)
4. If 0 replacements for a color → warn the user: the color may not exist exactly in the file, suggest raising `--tolerance`

---

## Edge cases

- **Color not found**: Could be due to theme colors (not stored as direct RGB). Mention this limitation and suggest checking with PowerPoint's "Format > Theme Colors."
- **Chart colors**: `python-pptx` has limited chart color access. Script will attempt but may miss some chart series colors — flag this to the user.
- **Transparent/no-fill elements**: Skipped intentionally.
- **Multiple input formats at once**: Fine — resolve each and build the combined mapping before running once.
