"""Render round-trip: deck.mdx -> pptx -> PDF, verified against all three artifacts.

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

import os
import re
import shutil
import subprocess
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

class Renderer:
    """soffice, either on PATH or inside a container."""

    def __init__(self):
        self.image = os.environ.get("DECK_RENDER_DOCKER")
        self.local = shutil.which("soffice") or shutil.which("libreoffice")
        self.available = bool(self.local or (self.image and shutil.which("docker")))

    def workdir(self):
        # A container's daemon may not see /tmp (snap docker does not), so in docker
        # mode the workspace has to live somewhere the daemon can bind-mount.
        if self.local:
            import tempfile
            return Path(tempfile.mkdtemp(prefix="deck-render-"))
        d = Path.home() / ".cache" / "deck-render-test"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        return d

    def sh(self, workdir, script):
        if self.local:
            return subprocess.run(["bash", "-c", script], cwd=workdir,
                                  capture_output=True, text=True, timeout=600)
        return subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "bash", "-u", "0",
             "-v", "%s:/work" % workdir, "-w", "/work", self.image, "-c", script],
            capture_output=True, text=True, timeout=900)

    def to_pdf(self, workdir, name):
        r = self.sh(workdir, "export HOME=/tmp/lohome; mkdir -p $HOME; "
                             "soffice --headless -env:UserInstallation=file:///tmp/loprof "
                             "--convert-to pdf %s 2>&1 | tail -2" % name)
        return r.stdout + r.stderr

    def has_poppler(self, workdir):
        return self.sh(workdir, "command -v pdftotext >/dev/null && echo yes").stdout.strip() == "yes"

    def page_texts(self, workdir, pdf, pages):
        out = []
        for i in range(1, pages + 1):
            r = self.sh(workdir, "pdftotext -f %d -l %d -layout %s -" % (i, i, pdf))
            out.append(r.stdout)
        return out


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
pic1: content.png
text2:
  - 빌드와 배포를 분리해 캐시가 실제로 먹게 했다
  - 롤백은 이전 아티팩트 재지정 한 단계로 줄였다

## @s2
text2: 02
text3: 다음 분기
"""

STALE = ("Decktitlegoeshere", "Onelinethatsayswhy", "Pointoftheslide",
         "Firstsupportingpoint", "Thenumbers", "Rowone", "Apointaboutthepicture")
BRAND = (("navy", "10243F"), ("accent", "E0533D"), ("paper", "FBFAF7"),
         ("ink", "1A1A1A"), ("muted", "6B7785"))

# content image: 1200x500 is 2.4:1, deliberately wider than the 16:9 frame it goes into
IMG_W, IMG_H = 1200, 500


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
    (work / "content.png").write_bytes(
        fixture_template.placeholder_png(IMG_W, IMG_H, (224, 83, 61)))
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
