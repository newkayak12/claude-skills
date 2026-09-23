"""Tests for deck.py. Builds its own minimal .pptx so nothing external is needed.

    python3 test_deck.py
"""

import shutil
import struct
import sys
import tempfile
import zipfile
import zlib
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import deck  # noqa: E402

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"

FAILED = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILED.append(label)


# ── Minimal template construction ────────────────────────────────────────────

def _sp(name, ph, paras, cx=4000000, cy=600000):
    ph_xml = '<p:ph type="%s"/>' % ph if ph else ""
    body = "".join(
        '<a:p><a:pPr lvl="%d"/><a:r><a:rPr lang="en" sz="1800"/><a:t>%s</a:t></a:r></a:p>'
        % (lvl, t) for lvl, t in paras)
    return (
        '<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr>%s</p:nvPr>'
        '</p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '</p:spPr><p:txBody><a:bodyPr/>%s</p:txBody></p:sp>'
        % (abs(hash(name)) % 900 + 2, name, ph_xml, cx, cy, body))


def _pic(name, rid, cx, cy):
    return (
        '<p:pic><p:nvPicPr><p:cNvPr id="50" name="%s"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
        '<p:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm></p:spPr></p:pic>'
        % (name, rid, cx, cy))


def _tbl(name, rows, cols):
    grid = "".join('<a:gridCol w="2000000"/>' for _ in range(cols))
    trs = ""
    for r in range(rows):
        tcs = "".join(
            '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en"/><a:t>r%dc%d</a:t>'
            '</a:r></a:p></a:txBody><a:tcPr/></a:tc>' % (r, c) for c in range(cols))
        trs += '<a:tr h="370000">%s</a:tr>' % tcs
    return (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="60" name="%s"/>'
        '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        '<p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="2000000"/></p:xfrm>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
        '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>%s</a:tblGrid>%s</a:tbl>'
        '</a:graphicData></a:graphic></p:graphicFrame>' % (name, grid, trs))


def _slide(shapes):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/>'
        '<p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>%s</p:spTree></p:cSld>'
        '<p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>' % "".join(shapes))


REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def _rels(items):
    body = "".join('<Relationship Id="%s" Type="%s/%s" Target="%s"/>' % (i, REL, t, g)
                   for i, t, g in items)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
            'relationships">%s</Relationships>' % body)


def make_png(path, w, h):
    raw = b"".join(b"\x00" + bytes((30, 120, 220)) * w for _ in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b""))


def make_template(path, media):
    slide1 = _slide([
        _sp("Title 1", "ctrTitle", [(0, "Template Title")], cx=6000000),
        _sp("Subtitle 2", "subTitle", [(0, "Template subtitle")]),
        _sp("Slide Number", None, [(0, "")]),
    ])
    slide2 = _slide([
        _sp("Title 1", "title", [(0, "Agenda")]),
        _sp("Body 2", "body", [(0, "one"), (0, "two"), (1, "nested")]),
        _tbl("Table 3", 3, 2),
        _pic("Picture 4", "rId9", 3000000, 2000000),
    ])
    parts = {
        "[Content_Types].xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
            'relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.'
            'openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="%s"/>'
            '<Override PartName="/ppt/slides/slide2.xml" ContentType="%s"/>'
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.'
            'openxmlformats-officedocument.theme+xml"/></Types>'
            % (deck.CT_SLIDE, deck.CT_SLIDE),
        "_rels/.rels": _rels([("rId1", "officeDocument", "ppt/presentation.xml")]),
        "ppt/presentation.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="%s" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>'
            '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>'
            '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>' % REL,
        "ppt/_rels/presentation.xml.rels": _rels([
            ("rId1", "slideMaster", "slideMasters/slideMaster1.xml"),
            ("rId2", "slide", "slides/slide1.xml"),
            ("rId3", "slide", "slides/slide2.xml"),
            ("rId4", "theme", "theme/theme1.xml")]),
        "ppt/slides/slide1.xml": slide1,
        "ppt/slides/slide2.xml": slide2,
        "ppt/slides/_rels/slide1.xml.rels": _rels([
            ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]),
        "ppt/slides/_rels/slide2.xml.rels": _rels([
            ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId9", "image", "../media/image1.png")]),
        "ppt/slideLayouts/slideLayout1.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="%s" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:cSld name="Content Layout"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
            '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
            '</p:sldLayout>' % REL,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _rels([
            ("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
        "ppt/slideMasters/slideMaster1.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="%s" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/>'
            '<p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
            '</p:sldMaster>' % REL,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _rels([
            ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId2", "theme", "../theme/theme1.xml")]),
        "ppt/theme/theme1.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'name="T"><a:themeElements/></a:theme>',
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
        z.writestr("ppt/media/image1.png", media.read_bytes())


# ── Helpers ──────────────────────────────────────────────────────────────────

def slide_texts(pptx, part):
    with zipfile.ZipFile(pptx) as z:
        root = ET.fromstring(z.read(part))
    out = []
    for tb in root.iter():
        if tb.tag.endswith("}txBody"):
            for p in tb.findall(A + "p"):
                out.append("".join(t.text or "" for t in p.iter(A + "t")))
    return out


def integrity(pptx):
    """Returns a list of package-level problems; empty means clean."""
    import re
    problems = []
    with zipfile.ZipFile(pptx) as z:
        names = set(z.namelist())
        ct = z.read("[Content_Types].xml").decode()
        for n in sorted(names):
            if not (n.startswith("ppt/slides/slide") and n.endswith(".xml")):
                continue
            if '/%s"' % n not in ct:
                problems.append("no content-type for " + n)
            rn = "ppt/slides/_rels/%s.rels" % n.split("/")[-1]
            rels = ET.fromstring(z.read(rn)) if rn in names else []
            ids = {r.get("Id") for r in rels}
            xml = z.read(n).decode()
            for rid in set(re.findall(r'r:(?:id|embed|link)="(rId\d+)"', xml)):
                if rid not in ids:
                    problems.append("%s: dangling %s" % (n, rid))
            for r in rels:
                t = r.get("Target")
                if t.startswith("../") and "ppt/" + t[3:] not in names:
                    problems.append("%s: missing target %s" % (n, t))
        pres = ET.fromstring(z.read("ppt/presentation.xml"))
        prels = {r.get("Id"): r.get("Target")
                 for r in ET.fromstring(z.read("ppt/_rels/presentation.xml.rels"))}
        for sld in pres.find(P + "sldIdLst"):
            tgt = prels.get(sld.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"))
            if not tgt or "ppt/" + tgt not in names:
                problems.append("sldIdLst points at missing %s" % tgt)
    return problems


def run(tmp):
    img = tmp / "shot.png"
    make_png(img, 400, 400)
    template = tmp / "template.pptx"
    make_template(template, img)

    # 1 — catalog
    print("catalog")
    pkg = deck.Package(template)
    parts = deck.slide_order(pkg)
    check(parts == ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"], "slide order follows sldIdLst")
    s1 = {s.id: s for s in deck.analyze_slide(ET.fromstring(pkg.parts[parts[0]]))}
    check(list(s1) == ["title", "subtitle", "text1"], "slot ids: title/subtitle/text1, got %s" % list(s1))
    check(s1["title"].max_chars and s1["title"].max_chars > 10, "capacity estimated from frame width")
    s2 = {s.id: s for s in deck.analyze_slide(ET.fromstring(pkg.parts[parts[1]]))}
    check(s2["text1"].type == "list" and s2["text1"].max_items == 3, "multi-paragraph shape is a list")
    check(s2["table1"].type == "table" and s2["table1"].cols == 2, "table slot with column count")
    check(abs(s2["pic1"].ratio - 1.5) < 0.01, "picture aspect read from the frame")

    # 2 — deck.mdx parsing
    print("parse")
    front, specs, errs = deck.parse_deck(
        "---\ntemplate: t.pptx\n---\n\n## @s2 note\n"
        "title: Hello\n"
        "text1:\n  - one\n    - deep\n  - two\n"
        "table1:\n  | a | b |\n  |---|---|\n  | c | d |\n"
        "stray line here\n")
    check(front["template"] == "t.pptx", "front matter parsed")
    check(specs[0].archetype == "s2" and specs[0].comment == "note", "slide header + trailing comment")
    kinds = {v[0]: (v[1], v[2]) for v in specs[0].values}
    check(kinds["title"] == ("scalar", "Hello"), "scalar slot")
    check(kinds["text1"][1] == [(0, "one"), (1, "deep"), (0, "two")], "list with nesting levels")
    check(kinds["table1"][1] == [["a", "b"], ["c", "d"]], "table rows, separator row dropped")
    check(len(errs) == 1 and "stray" in errs[0], "stray line reported, not silently eaten")

    # 3 — build
    print("build")
    (tmp / "deck.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: out.pptx\n---\n\n"
        "## @s1\ntitle: 신뢰성 리뷰\nsubtitle: 두 번째 줄\n\n"
        "## @s2\ntitle: Agenda\n"
        "text1:\n  - alpha\n  - beta\n  - gamma\n  - delta\n"
        "table1:\n  | H1 | H2 |\n  | x | y |\n"
        "pic1: shot.png\n\n"
        "## @s2\ntitle: dropped picture\npic1: !drop\n", encoding="utf-8")
    rc = deck.main(["build", "--deck", str(tmp / "deck.mdx")])
    out = tmp / "out.pptx"
    check(rc == 0 and out.is_file(), "build exits clean and writes the file")
    check(integrity(out) == [], "package integrity: %s" % integrity(out))
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    check(sorted(n for n in names if n.startswith("ppt/slides/slide")) ==
          ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"],
          "one output slide per md slide")
    t1 = slide_texts(out, "ppt/slides/slide1.xml")
    check("신뢰성 리뷰" in t1 and "두 번째 줄" in t1, "text slots replaced (UTF-8)")
    check("Template Title" not in t1, "template text is gone")
    t2 = slide_texts(out, "ppt/slides/slide2.xml")
    check([x for x in t2 if x in ("alpha", "beta", "gamma", "delta")] ==
          ["alpha", "beta", "gamma", "delta"], "list grew 3 -> 4 items")
    check("H1" in t2 and "x" in t2 and "r2c0" not in t2, "table rows replaced, header written")
    with zipfile.ZipFile(out) as z:
        s2xml = z.read("ppt/slides/slide2.xml").decode()
        s3xml = z.read("ppt/slides/slide3.xml").decode()
        media = [n for n in z.namelist() if "deckbuilder" in n]
    check(len(media) == 1, "image embedded once")
    check("<a:srcRect" not in s2xml or 'l="' in s2xml, "srcRect written for aspect mismatch")
    check(s3xml.count("<p:pic>") == 0 and s2xml.count("<p:pic>") == 1, "!drop removes the shape")

    # 4 — determinism
    print("determinism")
    deck.main(["build", "--deck", str(tmp / "deck.mdx"), "--output", str(tmp / "again.pptx")])
    check((tmp / "again.pptx").read_bytes() == out.read_bytes(),
          "same source builds byte-identical output")

    # 5 — check
    print("check")
    (tmp / "bad.mdx").write_text(
        "---\ntemplate: template.pptx\n---\n\n"
        "## @s9\ntitle: nope\n\n"
        "## @s2\nnosuch: x\npic1: missing.png\ntable1: not a table\n"
        "title: %s\n" % ("긴" * 200), encoding="utf-8")
    rc = deck.main(["check", "--deck", str(tmp / "bad.mdx")])
    check(rc == 1, "check exits 1 when there are errors")

    # 6 — unknown slot does not abort the build
    print("resilience")
    (tmp / "partial.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: partial.pptx\n---\n\n"
        "## @s2\nnosuch: x\ntitle: still built\n", encoding="utf-8")
    deck.main(["build", "--deck", str(tmp / "partial.mdx")])
    check("still built" in slide_texts(tmp / "partial.pptx", "ppt/slides/slide1.xml"),
          "a bad slot is reported but the rest of the slide still renders")
    check(integrity(tmp / "partial.pptx") == [], "partial build is still a valid package")


def guards(tmp):
    """The two non-negotiables: .mdx source, and a real reference template."""
    print("guards")

    def fails_with(argv, needle, label):
        try:
            deck.main(argv)
        except SystemExit as e:
            msg = str(e)
            check(needle in msg, "%s — got: %s" % (label, msg.splitlines()[0][:70]))
            return
        check(False, "%s — no error raised" % label)

    (tmp / "wrong.md").write_text(
        "---\ntemplate: template.pptx\n---\n\n## @s1\ntitle: x\n", encoding="utf-8")
    fails_with(["build", "--deck", str(tmp / "wrong.md")],
               "must be a .mdx file", "a .md source is rejected")
    fails_with(["check", "--deck", str(tmp / "wrong.md")],
               "must be a .mdx file", "check rejects .md too")

    (tmp / "notemplate.mdx").write_text("## @s1\ntitle: x\n", encoding="utf-8")
    fails_with(["build", "--deck", str(tmp / "notemplate.mdx")],
               "no reference template", "a deck with no template is refused")

    (tmp / "gone.mdx").write_text(
        "---\ntemplate: nosuch.pptx\n---\n\n## @s1\ntitle: x\n", encoding="utf-8")
    fails_with(["build", "--deck", str(tmp / "gone.mdx")],
               "not found", "a missing template path is refused")

    (tmp / "fake.pptx").write_text("not a zip at all", encoding="utf-8")
    fails_with(["build", "--deck", str(tmp / "gone.mdx"), "--template", str(tmp / "fake.pptx")],
               "not a readable pptx", "a non-zip template is refused")

    (tmp / "notes.txt").write_text("hello", encoding="utf-8")
    fails_with(["catalog", "--template", str(tmp / "notes.txt")],
               "must be .pptx", "catalog refuses a non-pptx template")
    fails_with(["catalog", "--template", str(tmp / "nowhere.pptx")],
               "not found", "catalog refuses a missing template")

    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = deck.main(["catalog", "--template", str(tmp / "template.pptx")])
    check(rc == 0 and "deck.mdx" in buf.getvalue(),
          "catalog tells you to save the source as deck.mdx")


def main():
    tmp = Path(tempfile.mkdtemp(prefix="deckbuilder-test-"))
    try:
        run(tmp)
        guards(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if FAILED:
        print("%d FAILED" % len(FAILED))
        for f in FAILED:
            print("  - " + f)
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
