"""Authors the reference template used by test_render.py.

A TEST FIXTURE, not a fallback. deck.py never calls this and must never acquire a
built-in template: a deck is built from the user's own reference pptx or not at all.
It exists so the render round-trip has a designed deck to work on — brand colors, a
type scale, six archetypes — without shipping a binary fixture in the repo.

    python3 fixture_template.py out.pptx
"""
import zipfile, sys
from pathlib import Path

REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
R = 'xmlns:r="%s"' % REL

NAVY, INK, MUTED, ACCENT, PAPER = "10243F", "1A1A1A", "6B7785", "E0533D", "FBFAF7"
W, H = 12192000, 6858000
_id = [100]


def nid():
    _id[0] += 1
    return _id[0]


def tx(name, x, y, cx, cy, paras, color=INK, size=1800, bold=0, align="l", font="Verdana"):
    body = ""
    for lvl, t in paras:
        body += (
            '<a:p><a:pPr lvl="%d" algn="%s"/><a:r><a:rPr lang="en-US" sz="%d" b="%d" dirty="0">'
            '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>'
            '<a:latin typeface="%s"/></a:rPr><a:t>%s</a:t></a:r></a:p>'
            % (lvl, align, size, bold, color, font, t))
    return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr txBox="1"/><p:nvPr/>'
            '</p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/>'
            '<a:lstStyle/>%s</p:txBody></p:sp>' % (nid(), name, x, y, cx, cy, body))


def rect(name, x, y, cx, cy, color):
    return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            '<a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>'
            '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
            % (nid(), name, x, y, cx, cy, color))


def pic(name, rid, x, y, cx, cy):
    return ('<p:pic><p:nvPicPr><p:cNvPr id="%d" name="%s"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            '<p:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
            % (nid(), name, rid, x, y, cx, cy))


def table(name, x, y, cx, rows, widths):
    grid = "".join('<a:gridCol w="%d"/>' % w for w in widths)
    trs = ""
    for ri, row in enumerate(rows):
        tcs = ""
        for ci, cell in enumerate(row):
            fill = ('<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % NAVY) if ri == 0 else \
                   ('<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % PAPER)
            col = "FFFFFF" if ri == 0 else INK
            tcs += ('<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="%s"/>'
                    '<a:r><a:rPr lang="en-US" sz="1400" b="%d"><a:solidFill>'
                    '<a:srgbClr val="%s"/></a:solidFill><a:latin typeface="Verdana"/></a:rPr>'
                    '<a:t>%s</a:t></a:r></a:p></a:txBody><a:tcPr marL="91440" marR="91440">%s'
                    '</a:tcPr></a:tc>' % ("l" if ci == 0 else "r", 1 if ri == 0 else 0,
                                          col, cell, fill))
        trs += '<a:tr h="400000">%s</a:tr>' % tcs
    return ('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="%d" name="%s"/>'
            '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
            '<p:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></p:xfrm>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/'
            'table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>%s</a:tblGrid>%s'
            '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
            % (nid(), name, x, y, cx, 400000 * len(rows), grid, trs))


def slide(shapes, bg=None):
    bgxml = ('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="%s"/></a:solidFill>'
             '<a:effectLst/></p:bgPr></p:bg>' % bg) if bg else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sld %s %s %s><p:cSld>%s<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
            '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>%s</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
            % (A, R, P, bgxml, "".join(shapes)))


def rels(items):
    body = "".join('<Relationship Id="%s" Type="%s/%s" Target="%s"/>' % (i, REL, t, g)
                   for i, t, g in items)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s'
            '</Relationships>' % body)


THEME = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme %s name="DeckTest">'
         '<a:themeElements><a:clrScheme name="DeckTest">'
         '<a:dk1><a:srgbClr val="%s"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
         '<a:dk2><a:srgbClr val="%s"/></a:dk2><a:lt2><a:srgbClr val="%s"/></a:lt2>'
         '<a:accent1><a:srgbClr val="%s"/></a:accent1><a:accent2><a:srgbClr val="%s"/></a:accent2>'
         '<a:accent3><a:srgbClr val="4C8C7B"/></a:accent3><a:accent4><a:srgbClr val="C9A227"/>'
         '</a:accent4><a:accent5><a:srgbClr val="7A5C9E"/></a:accent5><a:accent6>'
         '<a:srgbClr val="2F6FB2"/></a:accent6><a:hlink><a:srgbClr val="2F6FB2"/></a:hlink>'
         '<a:folHlink><a:srgbClr val="7A5C9E"/></a:folHlink></a:clrScheme>'
         '<a:fontScheme name="DeckTest"><a:majorFont><a:latin typeface="Verdana"/><a:ea '
         'typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin '
         'typeface="Verdana"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
         '</a:fontScheme><a:fmtScheme name="DeckTest"><a:fillStyleLst>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
         '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '</a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
         '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
         '</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>'
         '<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/>'
         '</a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
         '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
         '</a:fmtScheme></a:themeElements></a:theme>'
         % (A, INK, NAVY, PAPER, ACCENT, NAVY))

CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
CT_LAYOUT = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"
CT_MASTER = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"


def build(out_path, image_bytes):
    M = 838200                                  # side margin
    slides = []

    # s1 — cover
    slides.append(slide([
        rect("Accent bar", M, 1700000, 1200000, 60000, ACCENT),
        tx("Title", M, 2050000, 9000000, 1600000,
           [(0, "Deck title goes here")], color="FFFFFF", size=4400, bold=1),
        tx("Subtitle", M, 3800000, 8200000, 700000,
           [(0, "One line that says why this deck exists")], color="9FB0C4", size=1800),
        tx("Footer", M, 5600000, 5000000, 400000,
           [(0, "Team · Q0 0000")], color="6C7F96", size=1200),
    ], bg=NAVY))

    # s2 — section divider
    slides.append(slide([
        rect("Band", 0, 2600000, W, 1700000, PAPER),
        tx("Kicker", M, 2900000, 3000000, 400000,
           [(0, "SECTION")], color=ACCENT, size=1200, bold=1),
        tx("Title", M, 3300000, 9500000, 900000,
           [(0, "Section title")], color=NAVY, size=3200, bold=1),
    ]))

    # s3 — bullets with a stat panel
    slides.append(slide([
        tx("Title", M, 700000, 7000000, 700000,
           [(0, "Point of the slide")], color=NAVY, size=2800, bold=1),
        tx("Body", M, 1800000, 6300000, 3200000,
           [(0, "First supporting point"), (0, "Second supporting point"),
            (1, "A nested qualifier")], color=INK, size=1600),
        rect("Panel", 7700000, 1750000, 3650000, 2600000, PAPER),
        tx("Stat", 8000000, 2100000, 3050000, 1000000,
           [(0, "00%")], color=ACCENT, size=4000, bold=1),
        tx("Stat label", 8000000, 3200000, 3050000, 900000,
           [(0, "what the number measures")], color=MUTED, size=1300),
    ]))

    # s4 — table
    slides.append(slide([
        tx("Title", M, 700000, 7000000, 700000,
           [(0, "The numbers")], color=NAVY, size=2800, bold=1),
        table("Metrics", M, 1900000, 10500000,
              [["Metric", "Before", "After"],
               ["Row one", "0", "0"],
               ["Row two", "0", "0"],
               ["Row three", "0", "0"]],
              [5300000, 2600000, 2600000]),
    ]))

    # s5 — picture beside bullets
    slides.append(slide([
        tx("Title", M, 700000, 7000000, 700000,
           [(0, "Picture slide")], color=NAVY, size=2800, bold=1),
        pic("Visual", "rId2", M, 1900000, 5600000, 3150000),
        tx("Body", 6900000, 1900000, 4450000, 3150000,
           [(0, "A point about the picture"), (0, "Another point")], color=INK, size=1600),
    ]))

    # s6 — dark slide with a picture: the case where a white-backed image reads as a
    # pasted box, and where `| transparent` has to prove itself.
    slides.append(slide([
        tx("Title", M, 700000, 7000000, 700000,
           [(0, "Dark slide with a visual")], color="FFFFFF", size=2800, bold=1),
        pic("Visual", "rId2", M, 1900000, 5600000, 3150000),
        tx("Body", 6900000, 1900000, 4450000, 3150000,
           [(0, "A point about the picture"), (0, "Another point")],
           color="C7D3E2", size=1600),
    ], bg=NAVY))

    parts = {
        "_rels/.rels": rels([("rId1", "officeDocument", "ppt/presentation.xml")]),
        "ppt/presentation.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation %s %s %s>'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            '<p:sldIdLst>%s</p:sldIdLst><p:sldSz cx="%d" cy="%d"/>'
            '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
            % (A, R, P,
               "".join('<p:sldId id="%d" r:id="rId%d"/>' % (256 + i, 2 + i)
                       for i in range(len(slides))), W, H),
        "ppt/_rels/presentation.xml.rels": rels(
            [("rId1", "slideMaster", "slideMasters/slideMaster1.xml")]
            + [("rId%d" % (2 + i), "slide", "slides/slide%d.xml" % (i + 1))
               for i in range(len(slides))]
            + [("rId%d" % (2 + len(slides)), "theme", "theme/theme1.xml")]),
        "ppt/slideMasters/slideMaster1.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster %s %s %s>'
            '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
            '<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>'
            '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
            '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" '
            'accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" '
            'accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
            '</p:sldMaster>' % (A, R, P),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
            ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId2", "theme", "../theme/theme1.xml")]),
        "ppt/slideLayouts/slideLayout1.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sldLayout %s %s %s type="blank" preserve="1"><p:cSld name="Blank">'
            '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/>'
            '</p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>' % (A, R, P),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([
            ("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
        "ppt/theme/theme1.xml": THEME,
    }
    for i, s in enumerate(slides, 1):
        parts["ppt/slides/slide%d.xml" % i] = s
        r = [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]
        if i in (5, 6):
            r.append(("rId2", "image", "../media/image1.png"))
        parts["ppt/slides/_rels/slide%d.xml.rels" % i] = rels(r)

    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://'
          'schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
          'relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Default Extension="png" ContentType="image/png"/>'
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.'
          'openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
          '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="%s"/>'
          '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="%s"/>'
          '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.'
          'openxmlformats-officedocument.theme+xml"/>%s</Types>'
          % (CT_MASTER, CT_LAYOUT,
             "".join('<Override PartName="/ppt/slides/slide%d.xml" ContentType="%s"/>'
                     % (i, CT_SLIDE) for i in range(1, len(slides) + 1))))
    parts["[Content_Types].xml"] = ct

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
        z.writestr("ppt/media/image1.png", image_bytes)
    print("template -> %s  (%d archetypes)" % (out_path, len(slides)))


def placeholder_png(w, h, rgb):
    import struct, zlib
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "template.pptx",
          placeholder_png(64, 36, (200, 200, 200)))
