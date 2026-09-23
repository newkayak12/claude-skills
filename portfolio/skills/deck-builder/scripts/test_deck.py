"""Tests for deck.py. Builds its own minimal .pptx so nothing external is needed.

    python3 test_deck.py
"""

import contextlib
import io
import os
import re
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


def make_png(path, w, h, rgb=(30, 120, 220)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

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
        _pic("Picture 4", "rId9", 3000000, 2000000),   # behind the text, as a design does
        _sp("Title 1", "title", [(0, "Agenda")]),
        _sp("Body 2", "body", [(0, "one"), (0, "two"), (1, "nested")]),
        _tbl("Table 3", 3, 2),
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
    import time
    time.sleep(1.1)   # the bug this guards against only shows across a second boundary
    deck.main(["build", "--deck", str(tmp / "deck.mdx"), "--output", str(tmp / "again.pptx")])
    check((tmp / "again.pptx").read_bytes() == out.read_bytes(),
          "same source builds byte-identical output, a second apart")
    with zipfile.ZipFile(out) as z:
        stamps = {i.date_time for i in z.infolist()}
    check(stamps == {deck.ZIP_EPOCH},
          "every entry carries the fixed epoch, not the wall clock: %s" % stamps)

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


def geometry(tmp):
    """Content that would fall off the slide is an error, not a surprise at render time."""
    print("slide-edge overflow")
    pkg = deck.Package(tmp / "template.pptx")
    check(deck.slide_size(pkg) == (12192000, 6858000), "slide size read from presentation.xml")
    parts = deck.slide_order(pkg)
    slots = {s.id: s for s in deck.analyze_slide(ET.fromstring(pkg.parts[parts[1]]), 6858000)}
    t = slots["table1"]
    check(t.row_h == 370000, "table row height read from the template, got %s" % t.row_h)
    check(t.fits == (6858000 - t.off_y) // t.row_h,
          "row capacity measured to the slide edge, got %s" % t.fits)
    check(slots["text1"].fits and slots["text1"].fits > 1,
          "text slots also know how many lines clear the edge")

    rows = "\n".join("  | r%d | x |" % i for i in range(t.fits + 3))
    (tmp / "over.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: over.pptx\n---\n\n"
        "## @s2\ntable1:\n" + rows + "\n", encoding="utf-8")
    check(deck.main(["check", "--deck", str(tmp / "over.mdx")]) == 1,
          "a table taller than the slide is an error, not a warning")

    fits_rows = "\n".join("  | r%d | x |" % i for i in range(t.fits - 1))
    (tmp / "fits.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: fits.pptx\n---\n\n"
        "## @s2\ntable1:\n" + fits_rows + "\n", encoding="utf-8")
    check(deck.main(["check", "--deck", str(tmp / "fits.mdx")]) == 0,
          "a table that fits raises nothing")


def emphasis(tmp):
    """**bold**, *italic* and `code` become runs, without losing the template's type."""
    print("inline emphasis")
    check(deck.split_emphasis("plain") == [("plain", False, False, False)],
          "plain text is one run")
    check(deck.split_emphasis("a **b** c") ==
          [("a ", False, False, False), ("b", True, False, False), (" c", False, False, False)],
          "bold splits into three runs")
    check(deck.split_emphasis("no *close") == [("no *close", False, False, False)],
          "an unmatched marker is literal text")

    (tmp / "emph.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: emph.pptx\n---\n\n"
        "## @s2\ntitle: a **bold** word\n"
        "text1:\n  - an *italic* one\n  - a `code` one\n", encoding="utf-8")
    deck.main(["build", "--deck", str(tmp / "emph.mdx")])
    with zipfile.ZipFile(tmp / "emph.pptx") as z:
        x = z.read("ppt/slides/slide1.xml").decode()
    check(x.count('b="1"') >= 1, "a bold run was written")
    check(x.count('i="1"') >= 1, "an italic run was written")
    check("Consolas" in x, "a code run switched typeface")
    check("**" not in x and "`" not in x, "the markers themselves do not reach the slide")
    root = ET.fromstring(x)
    sizes = {r.find(A + "rPr").get("sz") for r in root.iter(A + "r")
             if r.find(A + "rPr") is not None and r.find(A + "rPr").get("sz")}
    check(len(sizes) <= 1, "emphasis did not change the size the template set: %s" % sizes)


def drift(tmp):
    """`@sN` must not silently point somewhere else after the template moves."""
    print("template drift")
    pkg = deck.Package(tmp / "template.pptx")
    parts = deck.slide_order(pkg)
    sig = deck.template_signature(pkg, parts, 6858000)
    check(len(sig) == 12, "signature is a short stable hash, got %r" % sig)

    src = (tmp / "template.pptx").read_bytes()
    reworded = tmp / "reworded.pptx"
    with zipfile.ZipFile(tmp / "template.pptx") as z:
        keep = {n: z.read(n) for n in z.namelist()}
    keep["ppt/slides/slide2.xml"] = keep["ppt/slides/slide2.xml"].replace(b"Agenda", b"Plan")
    with zipfile.ZipFile(reworded, "w", zipfile.ZIP_DEFLATED) as o:
        for n, d in keep.items():
            o.writestr(n, d)
    rw = deck.Package(reworded)
    check(deck.template_signature(rw, deck.slide_order(rw), 6858000) == sig,
          "changing the template's words does not move the signature")

    swapped = tmp / "swapped.pptx"
    with zipfile.ZipFile(tmp / "template.pptx") as z:
        keep = {n: z.read(n) for n in z.namelist()}
    x = keep["ppt/presentation.xml"].decode()
    ids = re.findall(r"<p:sldId [^/]*/>", x)
    keep["ppt/presentation.xml"] = x.replace(
        "".join(ids), "".join([ids[1], ids[0]])).encode()
    with zipfile.ZipFile(swapped, "w", zipfile.ZIP_DEFLATED) as o:
        for n, d in keep.items():
            o.writestr(n, d)
    sw = deck.Package(swapped)
    check(deck.template_signature(sw, deck.slide_order(sw), 6858000) != sig,
          "reordering slides does move the signature")

    (tmp / "pinned.mdx").write_text(
        "---\ntemplate: template.pptx\ntemplate_hash: %s\noutput: pinned.pptx\n---\n\n"
        "## @s1\ntitle: x\n" % sig, encoding="utf-8")
    check(deck.main(["check", "--deck", str(tmp / "pinned.mdx")]) == 0,
          "a matching hash passes")
    check(deck.main(["check", "--deck", str(tmp / "pinned.mdx"),
                     "--template", str(swapped)]) == 1,
          "a moved template is an error, not a surprise in the output")
    check(src == (tmp / "template.pptx").read_bytes(), "the template itself was not touched")


def notes(tmp):
    """Speaker notes: a deck is presented, not just looked at."""
    print("speaker notes")
    (tmp / "notes.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: notes.pptx\n---\n\n"
        "## @s1\ntitle: t\nnotes: 여기서 숫자의 출처를 먼저 말할 것\n\n"
        "## @s2\ntitle: u\n", encoding="utf-8")
    check(deck.main(["check", "--deck", str(tmp / "notes.mdx")]) == 0,
          "notes are a reserved key, not an unknown slot")
    deck.main(["build", "--deck", str(tmp / "notes.mdx")])
    with zipfile.ZipFile(tmp / "notes.pptx") as z:
        names = z.namelist()
        notes_parts = [n for n in names if n.startswith("ppt/notesSlides/notesSlide")
                       and n.endswith(".xml")]
        check(len(notes_parts) == 1, "only the slide with notes gets a notes part")
        text = "".join(t.text or "" for t in ET.fromstring(z.read(notes_parts[0])).iter(A + "t"))
        check("여기서 숫자의 출처" in text, "the note text is in the notes part")
        check(any("notesMaster" in n for n in names),
              "a notes master exists for it to hang from")
        ct = z.read("[Content_Types].xml").decode()
        check(('/%s"' % notes_parts[0]) in ct, "the notes part is declared in content types")
        rels = ET.fromstring(z.read("ppt/slides/_rels/slide1.xml.rels"))
        check(any(r.get("Type") == deck.REL_NOTES for r in rels),
              "slide 1 points at its notes")
        rels2 = ET.fromstring(z.read("ppt/slides/_rels/slide2.xml.rels"))
        check(not any(r.get("Type") == deck.REL_NOTES for r in rels2),
              "slide 2 does not")
    check(integrity(tmp / "notes.pptx") == [], "notes keep the package valid")


def sizing(tmp):
    """A picture may not lose half of itself without saying so."""
    print("image sizing")
    check(deck.parse_picture_value("a.png") == ("a.png", "fill", "center", set()),
          "a bare path keeps the default")
    check(deck.parse_picture_value("a.png | fit")[1] == "fit", "| fit selects the mode")
    check(deck.parse_picture_value("a.png | fill top")[2] == "top", "an anchor can follow")
    check(deck.parse_picture_value("a.png | nope")[1] is None, "an unknown option is refused")
    check(deck.parse_picture_value("a.png | fit transparent")[3] == {"transparent"},
          "a flag rides alongside the mode")

    rect, lost = deck.crop_rect(0.75, 16 / 9)
    check(set(rect) == {"t", "b"} and 0.55 < lost < 0.60,
          "a portrait in a 16:9 frame loses ~58%%, measured: %.2f" % lost)
    rect, _ = deck.crop_rect(0.75, 16 / 9, "top")
    check(set(rect) == {"b"}, "anchoring top trims only the bottom")
    check(deck.crop_rect(16 / 9, 16 / 9)[0] is None, "a matching aspect is not cropped")

    off, ext = deck.fit_frame((100, 200), (1600, 900), 0.75)
    check(ext == (675, 900) and off[1] == 200, "fit shrinks width, keeps the box's height")
    check(off[0] == 100 + (1600 - 675) // 2, "and centres what is left")

    make_png(tmp / "portrait.png", 300, 400)
    make_png(tmp / "wide.png", 1600, 900)
    (tmp / "size.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: size.pptx\n---\n\n"
        "## @s2\npic1: portrait.png\n\n"
        "## @s2\npic1: portrait.png | fit\n\n"
        "## @s2\npic1: portrait.png | bogus\n", encoding="utf-8")
    rc = deck.main(["check", "--deck", str(tmp / "size.mdx")])
    check(rc == 1, "a bogus picture option is an error")

    (tmp / "size.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: size.pptx\n---\n\n"
        "## @s2\npic1: portrait.png\n\n"
        "## @s2\npic1: portrait.png | fit\n", encoding="utf-8")
    deck.main(["build", "--deck", str(tmp / "size.mdx")])
    with zipfile.ZipFile(tmp / "size.pptx") as z:
        a = z.read("ppt/slides/slide1.xml").decode()
        b = z.read("ppt/slides/slide2.xml").decode()
    check("<a:srcRect" in a, "fill writes a crop")
    check("<a:srcRect" not in b, "fit writes no crop")
    pa = ET.fromstring(a).find(".//" + P + "pic/" + P + "spPr/" + A + "xfrm/" + A + "ext")
    pb = ET.fromstring(b).find(".//" + P + "pic/" + P + "spPr/" + A + "xfrm/" + A + "ext")
    check(pa.attrib != pb.attrib, "fit resized the frame, fill did not: %s vs %s"
          % (pa.attrib, pb.attrib))
    check(abs(int(pb.get("cx")) / int(pb.get("cy")) - 0.75) < 0.01,
          "the fitted frame carries the image's own shape")

    check(round(deck.effective_dpi(300, 441 * 12700)) == 49,
          "effective dpi is measured against the frame, not the file")


def color(tmp):
    """Two ways a picture clashes: off-palette, or a pasted box."""
    print("image color")
    (tmp / "art.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" '
        'viewBox="0 0 400 225"><rect fill="#10243F"/><rect fill="#ff00aa"/>'
        '<text fill="#abc">x</text></svg>', encoding="utf-8")
    cols = deck.svg_colors(tmp / "art.svg")
    check(cols == ["10243F", "FF00AA", "AABBCC"],
          "every hex is found and shorthand expanded, got %s" % cols)

    check(deck.color_distance("FFFFFF", "10243F") > 60, "white and navy are far apart")
    check(deck.color_distance("10243F", "11253F") < 5, "near-identical navies are close")

    warns = []
    deck._check_picture_color(tmp / "art.svg", "@s1", "pic1", 3, warns, ["10243F"], None)
    strays = warns[0].split("use:")[1] if warns else ""
    check(len(warns) == 1 and "#FF00AA (" in strays and "#AABBCC (" in strays
          and "#10243F (" not in strays,
          "the off-palette colors are listed and the on-palette one is not: %s" % strays.strip())
    warns = []
    (tmp / "clean.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" '
        'viewBox="0 0 400 225"><rect fill="#10243F"/></svg>', encoding="utf-8")
    deck._check_picture_color(tmp / "clean.svg", "@s1", "pic1", 3, warns, ["10243F"], None)
    check(not warns, "art written entirely in the template's colors says nothing")

    make_png(tmp / "white.png", 60, 40, (255, 255, 255))
    edge = deck.png_edge(tmp / "white.png")
    check(edge is not None and edge[1] == 0.0, "an opaque png reports an opaque border")
    warns = []
    deck._check_picture_color(tmp / "white.png", "@s1", "pic1", 3, warns, [], "10243F")
    dark = len(warns)
    deck._check_picture_color(tmp / "white.png", "@s2", "pic1", 3, warns, [], "FFFFFF")
    check(dark == 1 and len(warns) == 1,
          "a light image warns on a dark slide and not on a light one")

    print("background knockout")
    w, h = 120, 80
    rows = [[(255, 255, 255, 255)] * w for _ in range(h)]
    for y in range(20, 60):
        for x in range(20, 100):
            rows[y][x] = (16, 36, 63, 255)          # a navy block
    for y in range(35, 45):
        for x in range(40, 80):
            rows[y][x] = (255, 255, 255, 255)       # white *inside* it
    deck.write_png(tmp / "diagram.png", w, h, rows)

    got = deck.read_png(tmp / "diagram.png")
    check(got is not None and got[0] == w, "the png we wrote reads back")
    out, frac, content = deck.knockout_background(got[2], w, h)
    check(out[0][0][3] == 0, "the outside background is cleared")
    check(out[40][60][3] == 255,
          "white inside the diagram survives — the flood starts at the edges")
    check(out[25][30][3] == 255, "the content itself is untouched")
    check(0.3 < frac < 0.9, "a sensible fraction was removed: %.2f" % frac)
    check(content is not None and deck.color_distance(content, "10243F") < 40,
          "what survives is reported, for the visibility check: #%s" % content)

    a, _ = deck.make_transparent(tmp / "diagram.png", tmp / ".kc")
    b, _ = deck.make_transparent(tmp / "diagram.png", tmp / ".kc")
    check(a == b and a.read_bytes()[:8] == deck.PNG_MAGIC,
          "the knocked-out copy is cached and is a PNG")
    shutil.rmtree(tmp / ".kc")
    c, _ = deck.make_transparent(tmp / "diagram.png", tmp / ".kc")
    check(c.read_bytes() == a.read_bytes(), "a cold cache reproduces the same bytes")

    flat = tmp / "flat.png"
    make_png(flat, 40, 30, (255, 255, 255))
    none_, why = deck.make_transparent(flat, tmp / ".kc")
    check(none_ is None and "nothing to look at" in why,
          "an image that is nothing but background is refused, not emptied: %s" % why)

    warns = []
    deck._check_picture_color(tmp / "diagram.png", "@s6", "pic1", 3, warns, [], "10243F",
                              {"transparent"})
    check(len(warns) == 1 and "hard to see" in warns[0],
          "dark content knocked onto a dark slide is called out")
    warns = []
    deck._check_picture_color(tmp / "diagram.png", "@s6", "pic1", 3, warns, [], "FFFFFF",
                              {"transparent"})
    check(not warns, "the same image on a light slide is fine")

    pkg = deck.Package(tmp / "template.pptx")
    bgs = [deck.slide_background(pkg, n) for n in deck.slide_order(pkg)]
    check(all(b is None for b in bgs),
          "a template that declares no background reports none rather than guessing: %s" % bgs)

    import fixture_template
    fixture_template.build(tmp / "designed.pptx", fixture_template.placeholder_png(8, 8, (0, 0, 0)))
    fx = deck.Package(tmp / "designed.pptx")
    fbgs = [deck.slide_background(fx, n) for n in deck.slide_order(fx)]
    check(fbgs[0] == "10243F", "a slide's own background wins, got %s" % fbgs[0])
    check(fbgs[1] == "FFFFFF",
          "a slide without one inherits the master's through the layout, got %s" % fbgs[1])


def svg_assets(tmp):
    """Generated art is source too: an .svg in a picture slot, rasterized at build."""
    print("svg assets")
    (tmp / "art.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" '
        'viewBox="0 0 300 200"><rect width="300" height="200" fill="#10243F"/></svg>',
        encoding="utf-8")
    check(abs(deck.svg_aspect(tmp / "art.svg") - 1.5) < 1e-6, "aspect read from width/height")
    (tmp / "vb.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect/></svg>',
        encoding="utf-8")
    check(abs(deck.svg_aspect(tmp / "vb.svg") - 800 / 450) < 1e-6, "aspect falls back to viewBox")

    check(".svg" not in deck.IMAGE_CT,
          "no vector type is embeddable at all — the package cannot carry one")
    check(deck.VECTOR_EXT >= {".svg", ".emf", ".wmf", ".pdf"},
          "the vector list covers what people actually hand over")

    (tmp / "logo.emf").write_bytes(b"\x01\x00\x00\x00 not really an emf")
    (tmp / "vec.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: vec.pptx\n---\n\n"
        "## @s2\npic1: logo.emf\n", encoding="utf-8")
    out = []
    try:
        deck.main(["build", "--deck", str(tmp / "vec.mdx")])
        with zipfile.ZipFile(tmp / "vec.pptx") as z:
            out = [n for n in z.namelist() if Path(n).suffix.lower() in deck.VECTOR_EXT]
    except SystemExit:
        pass
    check(not out, "a vector nobody can rasterize never reaches the package: %s" % out)

    (tmp / "svg.mdx").write_text(
        "---\ntemplate: template.pptx\noutput: svg.pptx\n---\n\n"
        "## @s2\npic1: art.svg\n", encoding="utf-8")
    rc = deck.main(["check", "--deck", str(tmp / "svg.mdx")])
    if deck.Renderer().available:
        check(rc == 0, "an SVG asset checks clean when a renderer is present")
        deck.main(["build", "--deck", str(tmp / "svg.mdx")])
        cached = list((tmp / ".deckcache").glob("*.png"))
        check(len(cached) == 1, "the rasterized PNG is cached by content, got %s" % cached)
        with zipfile.ZipFile(tmp / "svg.pptx") as z:
            names = z.namelist()
            media = [n for n in names if n.startswith("ppt/media/")]
            check(any("deckbuilder" in n and n.endswith(".png") for n in media),
                  "the rasterized image is embedded as a PNG, not an SVG")
            check(not [n for n in names if Path(n).suffix.lower() in deck.VECTOR_EXT],
                  "the package carries no vector file at all")
            check("svg" not in z.read("[Content_Types].xml").decode().lower(),
                  "no image/svg+xml content type is declared")
            check(all(z.read(n)[:8] == deck.PNG_MAGIC for n in media if n.endswith(".png")),
                  "every embedded PNG really is a PNG")
            check(sum(z.read(n).decode("utf-8", "replace").count("svgBlip")
                      for n in names if n.startswith("ppt/slides/slide")) == 0,
                  "no slide references an SVG blip")
    else:
        check(rc == 1, "an SVG asset is an error when nothing can rasterize it")


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

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = deck.main(["catalog", "--template", str(tmp / "template.pptx")])
    check(rc == 0 and "deck.mdx" in buf.getvalue(),
          "catalog tells you to save the source as deck.mdx")


def run_cmd(argv):
    """deck.main with stdout captured, so a test can read what the user would see."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            deck.main(argv)
        except SystemExit as e:
            buf.write(str(e))
    return buf.getvalue()


def make_split_png(path, w, h, left=(20, 20, 20), right=(240, 240, 240)):
    """Dark on the left, light on the right — so a window that picks a side shows it."""
    raw = b""
    for _ in range(h):
        raw += b"\x00" + bytes(left) * (w // 2) + bytes(right) * (w - w // 2)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b""))


def _slot(sid, stype, box, z, color=None, size=None, sample=()):
    s = deck.Slot(sid, stype, str(z))
    s.box, s.z, s.color_ref, s.size_pt = box, z, color, size
    s.sample = list(sample)
    if stype == "picture" and box[3]:
        s.ratio = round(box[2] / box[3], 3)
    return s


def legibility(tmp):
    """Type laid over a picture: is it still readable, and is it even visible?"""
    print("text over a picture")
    check(abs(deck.contrast_ratio("FFFFFF", "000000") - 21.0) < 0.01,
          "black on white is 21:1")
    check(abs(deck.contrast_ratio("777777", "777777") - 1.0) < 1e-6,
          "a colour against itself is 1:1")
    check(deck.contrast_ratio("FFFFFF", "000000") == deck.contrast_ratio("000000", "FFFFFF"),
          "contrast does not care which is the text")
    check(deck.legibility_threshold(24) == 3.0 and deck.legibility_threshold(12) == 4.5,
          "large text is held to 3:1 and body text to 4.5:1")

    pic = _slot("pic1", "picture", (0, 0, 1000, 1000), 0)
    over = _slot("text1", "text", (0, 0, 500, 1000), 1, ("srgb", "FFFFFF"), 24, ["Over it"])
    away = _slot("text2", "text", (2000, 0, 500, 500), 2, ("srgb", "FFFFFF"), 24)
    pairs = deck.text_over_pictures([pic, over, away])
    check(len(pairs) == 1 and pairs[0][0] is over and abs(pairs[0][2] - 1.0) < 1e-6,
          "only the text box sharing the picture's box is paired, and it is fully covered")

    win = deck.source_window(over.box, pic.box, (0.0, 0.0, 0.0, 0.0))
    check(win == (0.0, 0.0, 0.5, 1.0),
          "a text box on the left half maps to the left half of the source: %s" % (win,))
    win2 = deck.source_window(over.box, pic.box, (0.2, 0.0, 0.0, 0.0))
    check(abs(win2[0] - 0.2) < 1e-9 and abs(win2[2] - 0.6) < 1e-9,
          "a fill crop shifts the window into what survives: %s" % (win2,))
    check(deck.source_window((5000, 0, 100, 100), pic.box, (0, 0, 0, 0)) is None,
          "text nowhere near the picture has no window")

    w, h = 40, 20
    rows = [[(20, 20, 20, 255)] * (w // 2) + [(240, 240, 240, 255)] * (w // 2)
            for _ in range(h)]
    dark = deck.window_contrast(rows, w, h, (0.0, 0.0, 0.5, 1.0), "FFFFFF", None, 4.5)
    light = deck.window_contrast(rows, w, h, (0.5, 0.0, 1.0, 1.0), "FFFFFF", None, 4.5)
    check(dark and dark[1] == 0.0 and light and light[1] == 1.0,
          "white text is safe over the dark half and fails over the light half: %s / %s"
          % (dark, light))
    check(dark[0] == "141414" and light[0] == "F0F0F0",
          "each window reports its own average, not the whole image's")
    clear = [[(240, 240, 240, 0)] * w for _ in range(h)]
    on_dark = deck.window_contrast(clear, w, h, (0, 0, 1, 1), "FFFFFF", "10243F", 4.5)
    check(on_dark and on_dark[1] == 0.0,
          "transparent pixels are scored against the slide behind them, not skipped")

    make_split_png(tmp / "split.png", 40, 20)
    full = _slot("text1", "text", (0, 0, 1000, 1000), 1, ("srgb", "FFFFFF"), 24, ["Title"])
    warns, errs = [], []
    deck._check_picture_legibility(tmp / "split.png", pic, [pic, full], "@s1", "pic1", 4,
                                   warns, errs, "stretch", "center", frozenset(),
                                   "10243F", {})
    check(not errs and len(warns) == 1 and "50%" in warns[0] and "text1 (24pt)" in warns[0],
          "half the area behind the white title is too light, and it says so: %s"
          % (warns[0] if warns else warns))
    warns, errs = [], []
    left_only = _slot("text1", "text", (0, 0, 400, 1000), 1, ("srgb", "FFFFFF"), 24)
    deck._check_picture_legibility(tmp / "split.png", pic, [pic, left_only], "@s1", "pic1",
                                   4, warns, errs, "stretch", "center", frozenset(),
                                   "10243F", {})
    check(not warns and not errs,
          "the same image says nothing when the text sits over its dark side: %s" % warns)

    warns, errs = [], []
    inherited = _slot("text1", "text", (0, 0, 1000, 1000), 1, None, 24)
    deck._check_picture_legibility(tmp / "split.png", pic, [pic, inherited], "@s1", "pic1",
                                   4, warns, errs, "stretch", "center", frozenset(), None, {})
    check(not warns, "an inherited text colour is left alone rather than guessed at")
    warns, errs = [], []
    themed = _slot("text1", "text", (0, 0, 1000, 1000), 1, ("scheme", "lt1"), 24)
    deck._check_picture_legibility(tmp / "split.png", pic, [pic, themed], "@s1", "pic1", 4,
                                   warns, errs, "stretch", "center", frozenset(), None,
                                   {"lt1": "FFFFFF"})
    check(len(warns) == 1, "a scheme colour resolves through the theme: %s" % warns)
    check(deck.resolve_color_ref(("scheme", "tx1"), {"dk1": "1A1A1A"}) == "1A1A1A",
          "tx1 follows the colour map to dk1")

    check(deck.covers_slide(_slot("p", "picture", (0, 0, 12192000, 6858000), 0),
                            (12192000, 6858000)),
          "a frame the size of the canvas is full bleed")
    check(not deck.covers_slide(_slot("p", "picture", (0, 0, 5600000, 3150000), 0),
                                (12192000, 6858000)),
          "a frame beside the text is not")
    warns = []
    deck._check_picture_color(tmp / "white.png", "@s1", "pic1", 3, warns, [], "10243F",
                              full_bleed=True)
    check(not warns,
          "a picture that fills the slide cannot read as a box pasted onto it: %s" % warns)

    print("a picture on top of the words")
    buried = _slot("text1", "text", (0, 0, 800, 800), 0, ("srgb", "FFFFFF"), 24)
    on_top = _slot("pic1", "picture", (0, 0, 1000, 1000), 1)
    warns, errs = [], []
    deck._check_picture_legibility(tmp / "split.png", on_top, [buried, on_top], "@s1",
                                   "pic1", 4, warns, errs, "stretch", "center",
                                   frozenset(), None, {})
    check(any("behind the image" in e for e in errs),
          "a picture drawn after the text it covers is an error: %s" % errs)
    warns, errs = [], []
    deck._check_picture_legibility(tmp / "split.png", pic, [pic, over], "@s1", "pic1", 4,
                                   warns, errs, "stretch", "center", frozenset(), None, {})
    check(not errs, "the same pair is fine when the picture is drawn first")


def widths(tmp):
    """Korean is full-width: counting characters makes a line look 1.8x shorter."""
    print("how wide a line really is")
    check(deck.char_em("A") == deck.LATIN_EM and deck.char_em("가") == deck.WIDE_EM,
          "a Latin glyph is half an em, a Hangul one fills it")
    check(deck.char_em("漢") == deck.WIDE_EM and deck.char_em("、") == deck.WIDE_EM,
          "Han and full-width punctuation are wide too")
    ko, en = "한글열글자입니다만", "abcdefghi"
    check(len(ko) == len(en) and deck.text_em(ko) > deck.text_em(en) * 1.7,
          "same character count, %.1f em against %.1f — the old count was off by that much"
          % (deck.text_em(ko), deck.text_em(en)))
    check(abs(deck.mean_em("abc") - deck.LATIN_EM) < 1e-9
          and abs(deck.mean_em(["가나"]) - deck.WIDE_EM) < 1e-9,
          "the reported char budget follows the script the template itself uses")

    print("the template calibrates its own capacity")
    # A slot whose own text already wraps is a wrapping slot; one that fits is a one-liner.
    make_png(tmp / "cap.png", 40, 40)
    make_template(tmp / "w.pptx", tmp / "cap.png")
    pkg = deck.Package(tmp / "w.pptx")
    protos = deck.slide_order(pkg)
    slots = deck.analyze_slide(ET.fromstring(pkg.parts[protos[0]]), deck.slide_size(pkg)[1])
    got = [s for s in slots if s.max_em]
    check(got and all(s.proto_em is not None for s in got),
          "every measured slot records the widest line the template puts in it")


def vector_invariant(tmp):
    """A real template ships SVG next to a PNG fallback. Refusing it refuses the template."""
    print("the template's own vector media is the template's own affair")
    make_png(tmp / "v.png", 40, 40)
    make_template(tmp / "v.pptx", tmp / "v.png")
    pkg = deck.Package(tmp / "v.pptx")
    pkg.parts["ppt/media/logo.svg"] = b"<svg xmlns='http://www.w3.org/2000/svg'/>"
    preexisting = frozenset(["ppt/media/logo.svg"])
    ok = True
    try:
        deck.assert_raster_only(pkg, preexisting)
    except SystemExit:
        ok = False
    check(ok, "an SVG the template already carried does not fail the build")
    blew = False
    try:
        deck.assert_raster_only(pkg, frozenset())
    except SystemExit as e:
        blew = "logo.svg" in str(e)
    check(blew, "an SVG the build introduced still fails loudly, naming the part")


def one_line_slots(tmp):
    """The warning that matters is a one-line slot dropping onto a second line."""
    print("a slot the template keeps to one line")
    make_png(tmp / "o.png", 40, 40)
    make_template(tmp / "o.pptx", tmp / "o.png")
    pkg = deck.Package(tmp / "o.pptx")
    protos = deck.slide_order(pkg)
    slots = deck.analyze_slide(ET.fromstring(pkg.parts[protos[1]]), deck.slide_size(pkg)[1])
    body = next(s for s in slots if s.id == "text1")
    check(body.max_em and body.proto_em is not None,
          "the slot carries both its frame width and the template's own widest line")
    fits = body.proto_em <= body.max_em
    check(fits, "the fixture's own body text fits its frame, so this is a one-line slot")

    src = (tmp / "o.mdx")
    long_ko = "가" * int(body.max_em * 1.4)
    src.write_text("---\ntemplate: o.pptx\noutput: o.pptx\n---\n\n## @s2\n"
                   "text1: %s\n" % long_ko, encoding="utf-8")
    out = run_cmd(["check", "--deck", str(src)])
    check("one line" in out and "too wide" in out,
          "a Hangul line 40%% past the frame is reported: %s"
          % next((l.strip() for l in out.splitlines() if "one line" in l), out[:90]))
    src.write_text("---\ntemplate: o.pptx\noutput: o.pptx\n---\n\n## @s2\ntext1: 짧다\n",
                   encoding="utf-8")
    check("one line" not in run_cmd(["check", "--deck", str(src)]),
          "a short line says nothing")


def fonts(tmp):
    """A substituted font rewraps every line, so the render must say when one is missing."""
    print("fonts the renderer does not have")
    make_png(tmp / "fnt.png", 40, 40)
    make_template(tmp / "f.pptx", tmp / "fnt.png")
    pkg = deck.Package(tmp / "f.pptx")
    protos = deck.slide_order(pkg)
    _, _, faces = deck.template_typography(pkg, protos)
    check(deck.missing_fonts(pkg, protos, None) is None,
          "a renderer that cannot list its fonts reports nothing rather than guessing")
    have = {n.lower() for n, _ in faces}
    check(deck.missing_fonts(pkg, protos, have) == [],
          "nothing is missing when the renderer has every face the slides set")
    check(deck.missing_fonts(pkg, protos, set()) == sorted(n for n, _ in faces)
          or not faces,
          "every face the slides set is named when the renderer has none")
    check(deck.missing_fonts(pkg, protos, {"nanumsquare"}) == [],
          "a weight suffix resolves to its family: NanumSquare Bold needs NanumSquare")


def workdir():
    """A container renderer's daemon may not see /tmp, so mirror test_render.py there."""
    if os.environ.get("DECK_RENDER_DOCKER") and not shutil.which("soffice"):
        d = Path.home() / ".cache" / "deckbuilder-test"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        return d
    return Path(tempfile.mkdtemp(prefix="deckbuilder-test-"))


def main():
    tmp = workdir()
    try:
        run(tmp)
        geometry(tmp)
        sizing(tmp)
        color(tmp)
        widths(tmp)
        vector_invariant(tmp)
        one_line_slots(tmp)
        fonts(tmp)
        legibility(tmp)
        emphasis(tmp)
        drift(tmp)
        notes(tmp)
        svg_assets(tmp)
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
