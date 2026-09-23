"""Render round-trip: deck.mdx -> pptx -> PDF, verified against all three artifacts.

The audit itself is the engine's (deck.collisions) — the same code `deck.py render` runs,
so this suite tests what users get rather than a parallel copy of it.

test_deck.py proves the package we write is well-formed. This proves a real renderer
agrees — that the pptx opens, the template's design is still on the page, and the
content from the .mdx is the content in the PDF.

Needs a renderer. Either is fine:

    soffice on PATH
    DECK_RENDER_DOCKER=<image>   an image with soffice (poppler-utils enables the
                                 text and page checks; without it they are skipped)

With neither, the whole file skips — it is not a failure, and CI without LibreOffice
stays green.

    python3 test_render.py
"""

import contextlib
import io
import os
import re
import struct
import zlib
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import deck            # noqa: E402
import fixture_template  # noqa: E402

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
FAILED = []
SKIPPED = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILED.append(label)


def skip(label):
    print("  skip " + label)
    SKIPPED.append(label)


def norm(s):
    return re.sub(r"\s+", "", s)


# ── Renderer ─────────────────────────────────────────────────────────────────

class Renderer(deck.Renderer):
    """The engine's renderer, plus a workspace the container daemon can actually see."""

    def workdir(self):
        if self.local:
            import tempfile
            return Path(tempfile.mkdtemp(prefix="deck-render-"))
        d = Path.home() / ".cache" / "deck-render-test"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        return d

    def has_poppler(self, workdir):
        return self.sh(workdir, "command -v pdftotext >/dev/null && echo yes"
                       ).stdout.strip() == "yes"

    def page_texts(self, workdir, pdf, pages):
        return [self.sh(workdir, "pdftotext -f %d -l %d -layout %s -" % (i, i, pdf)).stdout
                for i in range(1, pages + 1)]


def make_backdrop(path, tone, w=1920, h=1080):
    """A full-bleed PNG whose tone varies down the page."""
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes(tone(y, h)) * w

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def pdf_page_count(path):
    """Page count straight from the PDF, no tooling required."""
    data = path.read_bytes()
    m = re.search(rb"/Type\s*/Pages[^>]*?/Count\s+(\d+)", data, re.S)
    if m:
        return int(m.group(1))
    return len(re.findall(rb"/Type\s*/Page[^s]", data))


DECK = """---
template: template.pptx
output: deck.pptx
---

## @s1
text2: 배포 파이프라인 재설계
text3: 왜 했고, 무엇이 바뀌었고, 다음 분기에 무엇을 할 것인가
text4: Platform Reliability · 2026 Q3

## @s2
text2: 01
text3: 무엇이 문제였나

## @s3
text1: 배포가 병목이었다
text2:
  - 배포 한 건에 평균 42분, 주 3회가 한계였다
  - 실패하면 원인 파악에만 20분 넘게 걸렸다
    - 로그가 세 시스템에 흩어져 있었다
  - 릴리스 담당자가 사실상 상근 한 명이었다
text4: 42분
text5: 재설계 이전 배포 1건 소요 시간

## @s4
text1: 숫자
table1:
  | 지표 | 이전 | 이후 |
  | 배포 소요 시간 | 42분 | 6분 |
  | 주간 배포 횟수 | 3회 | 31회 |
  | 배포 실패율 | 12% | 0.4% |
  | 롤백 소요 시간 | 18분 | 90초 |

## @s5
text1: 파이프라인 구조
pic1: assets/latency.svg
text2:
  - 빌드와 배포를 분리해 캐시가 실제로 먹게 했다
  - 롤백은 이전 아티팩트 재지정 한 단계로 줄였다

## @s2
text2: 02
text3: 다음 분기
"""

STRESS = """---
template: template.pptx
output: stress.pptx
---

## @s3
text1: 이 제목은 프레임이 감당할 수 있는 길이를 한참 넘어서도록 일부러 아주 길게 쓴 문장이며 두 줄 이상으로 흐를 것이 확실합니다
text2:
  - 첫 번째 항목입니다 이것도 한 줄에 들어가지 않을 만큼 길게 써서 줄바꿈을 유도합니다
  - 두 번째 항목
  - 세 번째 항목
text4: 4200000000%
text5: 스탯 패널 안에 들어가기에는 지나치게 긴 설명 문장을 넣어서 패널 밖으로 흘러나가게 만듭니다

## @s4
text1: 표 스트레스
table1:
  | 지표 | 이전 | 이후 |
  | 행1 | 0 | 0 |
  | 행2 | 0 | 0 |
  | 행3 | 0 | 0 |
  | 행4 | 0 | 0 |
  | 행5 | 0 | 0 |
  | 행6 | 0 | 0 |
  | 행7 | 0 | 0 |
  | 행8 | 0 | 0 |
  | 행9 | 0 | 0 |
  | 행10 | 0 | 0 |
  | 행11 | 0 | 0 |
  | 행12 | 0 | 0 |
  | 행13 | 0 | 0 |
  | 행14 | 0 | 0 |
"""

STALE = ("Decktitlegoeshere", "Onelinethatsayswhy", "Pointoftheslide",
         "Firstsupportingpoint", "Thenumbers", "Rowone", "Apointaboutthepicture")
BRAND = (("navy", "10243F"), ("accent", "E0533D"), ("paper", "FBFAF7"),
         ("ink", "1A1A1A"), ("muted", "6B7785"))

# Generated art, written in the template's own palette — deliberately 2.4:1, wider than
# the 16:9 frame, so the crop path is exercised on a rasterized asset too.
IMG_W, IMG_H = 1200, 500
SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">
  <rect width="%d" height="%d" fill="#FBFAF7"/>
  <rect x="60" y="60" width="700" height="60" fill="#10243F"/>
  <rect x="60" y="200" width="100" height="60" fill="#E0533D"/>
  <text x="60" y="400" font-family="sans-serif" font-size="40" fill="#1A1A1A">42분 → 6분</text>
</svg>""" % (IMG_W, IMG_H, IMG_W, IMG_H, IMG_W, IMG_H)


def slide_text(z, part):
    return "".join(t.text or "" for t in ET.fromstring(z.read(part)).iter(A + "t"))


def colors(z, parts):
    out = set()
    for p in parts:
        out |= {c.upper() for c in
                re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', z.read(p).decode())}
    return out


def pic_ext(z, part):
    pic = next(e for e in ET.fromstring(z.read(part)).iter(P + "pic"))
    ext = pic.find(P + "spPr/" + A + "xfrm/" + A + "ext")
    return ext.get("cx"), ext.get("cy")


def run(work, r):
    print("fixture")
    fixture_template.build(work / "template.pptx",
                           fixture_template.placeholder_png(64, 36, (200, 200, 200)))
    (work / "assets").mkdir(exist_ok=True)
    (work / "assets" / "latency.svg").write_text(SVG, encoding="utf-8")
    (work / "deck.mdx").write_text(DECK, encoding="utf-8")

    print("build")
    check(deck.main(["check", "--deck", str(work / "deck.mdx")]) == 0,
          "check finds no errors in the fixture deck")
    check(deck.main(["build", "--deck", str(work / "deck.mdx")]) == 0, "build succeeds")

    tz = zipfile.ZipFile(work / "template.pptx")
    dz = zipfile.ZipFile(work / "deck.pptx")
    tparts = deck.slide_order(deck.Package(work / "template.pptx"))
    dparts = deck.slide_order(deck.Package(work / "deck.pptx"))
    front, specs, _ = deck.parse_deck(DECK)
    tslots = {"s%d" % n: {s.id: s.type for s in deck.analyze_slide(ET.fromstring(tz.read(p)))}
              for n, p in enumerate(tparts, 1)}

    print("design survived the build")
    dcol = colors(dz, dparts)
    for name, hexv in BRAND:
        check(hexv in dcol, "brand %s #%s is still in the deck" % (name, hexv))
    check(dcol <= colors(tz, tparts), "no color the template did not have: %s"
          % (dcol - colors(tz, tparts)))
    check(b"<p:bg>" in dz.read(dparts[0]), "the cover keeps its slide background")
    check(dz.read(dparts[0]).count(b"<p:sp>") == tz.read(tparts[0]).count(b"<p:sp>"),
          "the cover keeps every decorative shape")
    check(pic_ext(tz, tparts[4]) == pic_ext(dz, dparts[4]),
          "the picture frame is where the template put it")

    print("picture is cropped, not stretched")
    m = re.search(r"<a:srcRect ([^/]*)/>", dz.read(dparts[4]).decode())
    check(m is not None, "a crop rectangle was written")
    if m:
        vals = {k: int(v) for k, v in re.findall(r'(\w+)="(\d+)"', m.group(1))}
        cx, cy = (int(v) for v in pic_ext(dz, dparts[4]))
        check(set(vals) == {"l", "r"},
              "a source wider than its frame is cropped left/right, got %s" % vals)
        want = round((1 - (cx / cy) / (IMG_W / IMG_H)) / 2 * 100000)
        check(abs(vals.get("l", 0) - want) < 100,
              "the crop trims exactly the overhang (l=%s, expected ~%d)" % (vals.get("l"), want))

    print("outline levels")
    body = [p for tb in ET.fromstring(dz.read(dparts[2])).iter()
            if tb.tag.endswith("}txBody") for p in [tb.findall(A + "p")] if len(p) > 2][0]
    lvls = [(p.find(A + "pPr").get("lvl", "0") if p.find(A + "pPr") is not None else "0")
            for p in body]
    check(lvls == ["0", "0", "1", "0"],
          "the nested item is written at level 1, got %s" % lvls)

    print("render")
    out = r.to_pdf(work, "deck.pptx")
    pdf = work / "deck.pdf"
    check(pdf.is_file(), "a real renderer opened the pptx and wrote a PDF — %s"
          % out.strip().splitlines()[-1:] or out)
    if not pdf.is_file():
        return
    check(pdf_page_count(pdf) == len(specs),
          "the PDF has one page per deck.mdx slide (%d)" % pdf_page_count(pdf))

    if not r.has_poppler(work):
        skip("PDF text checks (no pdftotext in the renderer)")
        return

    print("the PDF carries what deck.mdx said")
    pages = r.page_texts(work, "deck.pdf", len(specs))
    for i, spec in enumerate(specs):
        stext, ptext = norm(slide_text(dz, dparts[i])), norm(pages[i])
        for slot, kind, value, _ in spec.values:
            if tslots[spec.archetype].get(slot) in ("picture", "chart"):
                continue
            vals = ([value] if kind == "scalar" else
                    [t for _, t in value] if kind == "list" else
                    [c for row in value for c in row])
            missing = [v for v in vals if v and norm(v) not in stext]
            check(not missing, "pptx slide %d carries every value (%s)"
                  % (i + 1, "missing: %s" % missing if missing else "ok"))
            missing = [v for v in vals if v and norm(v) not in ptext]
            check(not missing, "pdf page %d carries every value (%s)"
                  % (i + 1, "missing: %s" % missing if missing else "ok"))
    for stale in STALE:
        check(not any(stale in norm(p) for p in pages),
              "no leftover template copy %r in the PDF" % stale)
    check(norm("무엇이 문제였나") in norm(pages[1]) and norm("다음 분기") in norm(pages[5])
          and norm("다음 분기") not in norm(pages[1]),
          "one archetype used twice produced two independent slides")

    print("determinism survives a cold cache")
    deck.main(["build", "--deck", str(work / "deck.mdx"), "--output", str(work / "warm.pptx")])
    shutil.rmtree(work / ".deckcache", ignore_errors=True)
    deck.main(["build", "--deck", str(work / "deck.mdx"), "--output", str(work / "cold.pptx")])
    check((work / "warm.pptx").read_bytes() == (work / "cold.pptx").read_bytes(),
          "re-rasterizing from scratch reproduces the same bytes")

    print("nothing collides on the page")
    bbox = r.bbox(work, "deck.pdf")
    if bbox is None:
        skip("geometric audit (pdftotext -bbox-layout unavailable)")
        return
    hits = deck.collisions(bbox)
    check(not hits, "no text collides or runs off a slide (%s)" % (hits or "clean"))

    print("and the audit is not vacuous — a deck that overflows must fail it")
    (work / "stress.mdx").write_text(STRESS, encoding="utf-8")
    check(deck.main(["check", "--deck", str(work / "stress.mdx")]) == 1,
          "check refuses a deck whose table runs off the slide")
    deck.main(["build", "--deck", str(work / "stress.mdx")])
    r.to_pdf(work, "stress.pptx")
    sbox = r.bbox(work, "stress.pdf")
    shits = deck.collisions(sbox) if sbox else []
    check(len(shits) >= 2,
          "the same audit finds the deliberate overflow (%d hit(s))" % len(shits))
    stext = r.page_texts(work, "stress.pdf", 2)
    check(norm("행14") not in norm(stext[1]),
          "rows past the slide edge really are lost — which is why check errors on them")

    legibility(work, r)


def band_median(png, frac_top, frac_bottom, frac_left=0.05, frac_right=0.95):
    """Median colour of a horizontal band of a rendered page.

    The median, not the mean: the band contains the glyphs as well as the backdrop,
    and the glyphs are the minority of its area, so the median is what sits behind
    them — which is exactly what `check` claims to have measured.
    """
    got = deck.read_png(png)
    if not got:
        return None
    w, h, rows = got
    vals = []
    for y in range(int(h * frac_top), max(int(h * frac_top) + 1, int(h * frac_bottom))):
        row = rows[y]
        for x in range(int(w * frac_left), int(w * frac_right), 3):
            px = row[x]
            vals.append((0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2], px))
    if not vals:
        return None
    vals.sort(key=lambda v: v[0])
    px = vals[len(vals) // 2][1]
    return "%02X%02X%02X" % px[:3]


LEGIBILITY = """---
template: template.pptx
output: legible.pptx
---

## @s7
pic1: bright.png
text1: 읽히지 않는 제목
text2: 뒤에 깔린 하늘이 거의 흰색이기 때문이다

## @s7
pic1: dark.png
text1: 읽히는 제목
text2: 배경이 흰 글자를 받아줄 만큼 어둡기 때문이다
"""


def legibility(work, r):
    """What `check` predicts about text over a picture is what the renderer paints."""
    print("white type over a picture — prediction vs the page")
    make_backdrop(work / "bright.png", lambda y, h: (230 - int(30 * y / h),
                                                     238 - int(20 * y / h), 248))
    make_backdrop(work / "dark.png", lambda y, h: (12 + int(20 * y / h),
                                                   26 + int(18 * y / h), 52))
    (work / "legible.mdx").write_text(LEGIBILITY, encoding="utf-8")

    warns = []
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        deck.main(["check", "--deck", str(work / "legible.mdx")])
    warns = [ln for ln in out.getvalue().splitlines()
             if "falls below" in ln]
    bright = [w for w in warns if "bright.png" in w]
    dark = [w for w in warns if "dark.png" in w]
    check(len(bright) == 2 and not dark,
          "check warns for both text slots on the bright backdrop and neither on the dark")
    check(any("3.0:1" in w for w in bright) and any("4.5:1" in w for w in bright),
          "the 40pt title is held to 3:1 and the 16pt line to 4.5:1: %s"
          % [w.split("falls below")[1][:6] for w in bright])

    deck.main(["build", "--deck", str(work / "legible.mdx")])
    r.to_pdf(work, "legible.pptx")
    pages = r.previews(work, "legible.pdf", dpi=96)
    if len(pages) < 2:
        skip("rendered legibility band (pdftoppm unavailable)")
        return
    # the 40pt title sits at y = 4200000 of 6858000 EMU, 900000 tall
    top, bot = 4200000 / 6858000.0, 5100000 / 6858000.0
    lit = band_median(pages[0], top, bot)
    shade = band_median(pages[1], top, bot)
    check(lit and shade and deck.contrast_ratio(lit, "FFFFFF") < 3.0
          <= deck.contrast_ratio(shade, "FFFFFF"),
          "the page agrees: #%s behind the bright title (%.1f:1), #%s behind the dark one "
          "(%.1f:1)" % (lit, deck.contrast_ratio(lit, "FFFFFF"), shade,
                        deck.contrast_ratio(shade, "FFFFFF")))


def main():
    r = Renderer()
    if not r.available:
        print("SKIPPED — no renderer.")
        print("  install LibreOffice (soffice on PATH), or set DECK_RENDER_DOCKER=<image>")
        return 0
    print("renderer: %s" % ("soffice on PATH" if r.local else "docker " + r.image))
    work = r.workdir()
    try:
        run(work, r)
    finally:
        if r.local:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print("\nartifacts kept in %s" % work)
    print()
    if FAILED:
        print("%d FAILED" % len(FAILED))
        for f in FAILED:
            print("  - " + f)
        return 1
    print("all passed%s" % (" (%d skipped)" % len(SKIPPED) if SKIPPED else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
