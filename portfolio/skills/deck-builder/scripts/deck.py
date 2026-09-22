"""
Deck Builder — a compiler for PowerPoint decks.

  template.pptx   the toolchain: a catalog of slide archetypes
  deck.md         the source: what goes on each slide
  deck.pptx       the build artifact: regenerated in full, never hand-edited

Subcommands:
  catalog   template.pptx -> deck.catalog.md  (archetypes, slots, capacity hints)
  check     deck.md       -> diagnostics      (unknown slots, overflow, missing files)
  build     deck.md       -> deck.pptx        (clone archetype slides, swap content)

Python stdlib only: zipfile, xml.etree, re. No python-pptx, no PyYAML.
"""

import argparse
import copy
import os
import re
import shutil
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# ── Namespaces ───────────────────────────────────────────────────────────────

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
for _p, _u in NS.items():
    if _p not in ("ct", "pr"):
        ET.register_namespace(_p, _u)
ET.register_namespace("", NS["pr"])  # default ns for .rels documents

REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"

EMU_PER_PT = 12700


def q(name):
    """'a:t' -> '{http://...}t'"""
    prefix, _, local = name.partition(":")
    return "{%s}%s" % (NS[prefix], local)


# ── Package I/O ──────────────────────────────────────────────────────────────

class Package:
    """A .pptx read fully into memory as {part_name: bytes}."""

    def __init__(self, path):
        self.path = Path(path)
        self.parts = {}
        self.order = []
        with zipfile.ZipFile(self.path) as z:
            for info in z.infolist():
                self.parts[info.filename] = z.read(info.filename)
                self.order.append(info.filename)

    def xml(self, name):
        return ET.fromstring(self.parts[name])

    def set_xml(self, name, root):
        self.parts[name] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)

    def write(self, out_path):
        seen = set()
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for name in self.order:
                if name in self.parts and name not in seen:
                    z.writestr(name, self.parts[name])
                    seen.add(name)
            for name, data in self.parts.items():
                if name not in seen:
                    z.writestr(name, data)
                    seen.add(name)

    def drop(self, name):
        self.parts.pop(name, None)


def rels_name(part):
    p = Path(part)
    return str(p.parent / "_rels" / (p.name + ".rels")).replace(os.sep, "/")


def slide_order(pkg):
    """Template slide part names, in presentation order."""
    pres = pkg.xml("ppt/presentation.xml")
    rels = pkg.xml(rels_name("ppt/presentation.xml"))
    by_id = {}
    for rel in rels:
        by_id[rel.get("Id")] = rel.get("Target")
    out = []
    lst = pres.find(q("p:sldIdLst"))
    if lst is None:
        return out
    for sld in lst.findall(q("p:sldId")):
        target = by_id.get(sld.get(q("r:id")))
        if target:
            out.append("ppt/" + target.replace("../", "").lstrip("/"))
    return out


# ── Shape walking ────────────────────────────────────────────────────────────

def walk_shapes(spTree):
    """Yield (element, index_path) for every addressable shape, in document order."""

    def rec(parent, path):
        for i, child in enumerate(list(parent)):
            tag = child.tag
            here = path + [i]
            if tag == q("p:grpSp"):
                yield from rec(child, here)
            elif tag in (q("p:sp"), q("p:pic"), q("p:graphicFrame")):
                yield child, here

    yield from rec(spTree, [])


def resolve_path(spTree, path):
    el = spTree
    for i in path:
        el = list(el)[i]
    return el


def shape_name(el):
    for tag in ("p:nvSpPr", "p:nvPicPr", "p:nvGraphicFramePr"):
        nv = el.find(q(tag))
        if nv is not None:
            c = nv.find(q("p:cNvPr"))
            if c is not None:
                return c.get("name") or ""
    return ""


def placeholder_type(el):
    nv = el.find(q("p:nvSpPr"))
    if nv is None:
        return None
    ph = nv.find(q("p:nvPr") + "/" + q("p:ph"))
    if ph is None:
        nvPr = nv.find(q("p:nvPr"))
        ph = nvPr.find(q("p:ph")) if nvPr is not None else None
    return ph.get("type", "body") if ph is not None else None


def extent(el):
    """(cx, cy) in EMU from the shape's own xfrm, or None when inherited."""
    for tag in ("p:spPr", "p:xfrm", "p:grpSpPr"):
        holder = el.find(q(tag))
        if holder is None:
            continue
        xfrm = holder if tag == "p:xfrm" else holder.find(q("a:xfrm"))
        if xfrm is None:
            continue
        ext = xfrm.find(q("a:ext"))
        if ext is not None:
            return int(ext.get("cx", 0)), int(ext.get("cy", 0))
    xfrm = el.find(q("p:xfrm"))
    if xfrm is not None:
        ext = xfrm.find(q("a:ext"))
        if ext is not None:
            return int(ext.get("cx", 0)), int(ext.get("cy", 0))
    return None


def para_text(p):
    return "".join(t.text or "" for t in p.iter(q("a:t")))


def para_level(p):
    pPr = p.find(q("a:pPr"))
    return int(pPr.get("lvl", 0)) if pPr is not None else 0


def first_font_size(txBody):
    for rPr in txBody.iter(q("a:rPr")):
        if rPr.get("sz"):
            return int(rPr.get("sz")) / 100.0
    for d in txBody.iter(q("a:defRPr")):
        if d.get("sz"):
            return int(d.get("sz")) / 100.0
    return None


# ── Slot model ───────────────────────────────────────────────────────────────

class Slot:
    def __init__(self, sid, stype, path, label=""):
        self.id = sid
        self.type = stype        # text | list | table | picture | chart
        self.path = path
        self.label = label
        self.sample = []         # sample lines / rows from the template
        self.max_chars = None    # per line (text/list) estimate
        self.max_items = None    # paragraphs / rows the template shows
        self.ratio = None        # picture aspect "16:9"
        self.cols = None         # table columns


def _is_autofield(txBody):
    """True for shapes that only hold an auto field (slide number, date)."""
    flds = txBody.findall(q("a:p") + "/" + q("a:fld"))
    if not flds:
        return False
    runs = txBody.findall(q("a:p") + "/" + q("a:r"))
    return not any((para_text_of_run(r) or "").strip() for r in runs)


def para_text_of_run(r):
    t = r.find(q("a:t"))
    return t.text if t is not None else ""


def analyze_slide(root):
    """Return the slot list for one slide XML root."""
    spTree = root.find(q("p:cSld") + "/" + q("p:spTree"))
    slots = []
    counters = {"text": 0, "pic": 0, "table": 0, "chart": 0, "title": 0, "subtitle": 0}

    def next_id(kind):
        counters[kind] += 1
        n = counters[kind]
        if kind in ("title", "subtitle"):
            return kind if n == 1 else "%s%d" % (kind, n)
        return "%s%d" % (kind, n)

    for el, path in walk_shapes(spTree):
        name = shape_name(el)
        if el.tag == q("p:sp"):
            txBody = el.find(q("p:txBody"))
            if txBody is None:
                continue
            if _is_autofield(txBody):
                continue
            ph = placeholder_type(el)
            if ph in ("title", "ctrTitle"):
                sid = next_id("title")
            elif ph == "subTitle":
                sid = next_id("subtitle")
            else:
                sid = next_id("text")
            paras = txBody.findall(q("a:p"))
            stype = "list" if len(paras) > 1 else "text"
            slot = Slot(sid, stype, path, name)
            slot.sample = [para_text(p) for p in paras]
            slot.max_items = len(paras)
            ext = extent(el)
            size = first_font_size(txBody) or 18.0
            if ext:
                cx_pt = ext[0] / EMU_PER_PT
                slot.max_chars = max(4, int(cx_pt / (size * 0.55)))
            slots.append(slot)
        elif el.tag == q("p:pic"):
            slot = Slot(next_id("pic"), "picture", path, name)
            ext = extent(el)
            if ext and ext[1]:
                slot.ratio = round(ext[0] / ext[1], 3)
            slots.append(slot)
        elif el.tag == q("p:graphicFrame"):
            tbl = el.find(".//" + q("a:tbl"))
            if tbl is not None:
                slot = Slot(next_id("table"), "table", path, name)
                rows = tbl.findall(q("a:tr"))
                grid = tbl.find(q("a:tblGrid"))
                slot.cols = len(grid.findall(q("a:gridCol"))) if grid is not None else 0
                slot.max_items = len(rows)
                slot.sample = [
                    [para_text(p) for tc in tr.findall(q("a:tc"))
                     for p in tc.find(q("a:txBody")).findall(q("a:p"))][: slot.cols]
                    for tr in rows[:3]
                ]
                slots.append(slot)
                continue
            gd = el.find(q("a:graphic") + "/" + q("a:graphicData"))
            if gd is not None and "chart" in (gd.get("uri") or ""):
                slots.append(Slot(next_id("chart"), "chart", path, name))
    return slots


# ── deck.md parsing ──────────────────────────────────────────────────────────

class SlideSpec:
    def __init__(self, archetype, line, comment=""):
        self.archetype = archetype
        self.line = line
        self.comment = comment
        self.values = []  # (slot_id, kind, value, line)


SLIDE_RE = re.compile(r"^##\s*@([A-Za-z0-9_-]+)\s*(.*)$")
KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$")


def parse_deck(text):
    """Parse deck.md -> (front_matter dict, [SlideSpec], [error strings])."""
    lines = text.splitlines()
    front, errors, slides = {}, [], []
    i = 0

    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            m = KEY_RE.match(lines[i].strip())
            if m:
                front[m.group(1)] = m.group(2).strip()
            i += 1
        i += 1

    cur = None
    while i < len(lines):
        raw = lines[i]
        line_no = i + 1
        stripped = raw.strip()

        if not stripped or stripped.startswith("<!--"):
            i += 1
            continue

        m = SLIDE_RE.match(raw)
        if m:
            cur = SlideSpec(m.group(1), line_no, m.group(2).strip())
            slides.append(cur)
            i += 1
            continue

        m = KEY_RE.match(raw)
        if m and not raw.startswith((" ", "\t")):
            if cur is None:
                errors.append("line %d: slot '%s' appears before any '## @archetype'"
                              % (line_no, m.group(1)))
                i += 1
                continue
            key, inline = m.group(1), m.group(2).strip()
            if inline:
                cur.values.append((key, "scalar", inline, line_no))
                i += 1
                continue
            block, i = _read_block(lines, i + 1)
            kind, value = _classify_block(block)
            cur.values.append((key, kind, value, line_no))
            continue

        if stripped.startswith("#"):
            i += 1
            continue
        errors.append("line %d: not a slide header or slot — ignored: %r"
                      % (line_no, stripped[:60]))
        i += 1

    return front, slides, errors


def _read_block(lines, i):
    """Collect indented continuation lines starting at i."""
    block = []
    while i < len(lines):
        raw = lines[i]
        if not raw.strip():
            block.append(("", 0))
            i += 1
            continue
        if not raw.startswith((" ", "\t")):
            break
        expanded = raw.replace("\t", "    ")
        indent = len(expanded) - len(expanded.lstrip(" "))
        block.append((expanded.strip(), indent))
        i += 1
    while block and not block[-1][0]:
        block.pop()
    return block, i


def _classify_block(block):
    if not block:
        return "scalar", ""
    if any(t.startswith("|") for t, _ in block if t):
        rows = []
        for t, _ in block:
            if not t.startswith("|"):
                continue
            cells = [c.strip() for c in t.strip("|").split("|")]
            if all(set(c) <= set("-: ") and c for c in cells):
                continue  # markdown separator row
            rows.append(cells)
        return "table", rows
    if any(t.startswith("- ") or t == "-" for t, _ in block if t):
        base = min(ind for t, ind in block if t)
        items = []
        for t, ind in block:
            if not t.startswith("-"):
                continue
            items.append(((ind - base) // 2, t[1:].strip()))
        return "list", items
    return "scalar", "\n".join(t for t, _ in block)


# ── Text writing ─────────────────────────────────────────────────────────────

def _set_para_text(p, text):
    """Replace a paragraph's runs with a single run carrying `text`."""
    runs = p.findall(q("a:r"))
    keep = runs[0] if runs else None
    for child in list(p):
        if child.tag in (q("a:r"), q("a:br"), q("a:fld")) and child is not keep:
            p.remove(child)
    if keep is None:
        keep = ET.SubElement(p, q("a:r"))
        endPr = p.find(q("a:endParaRPr"))
        if endPr is not None:
            rPr = ET.SubElement(keep, q("a:rPr"))
            for k, v in endPr.attrib.items():
                rPr.set(k, v)
            for sub in list(endPr):
                rPr.append(copy.deepcopy(sub))
        ET.SubElement(keep, q("a:t"))
    t = keep.find(q("a:t"))
    if t is None:
        t = ET.SubElement(keep, q("a:t"))
    t.text = text
    if text != text.strip():
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def _write_paragraphs(txBody, items):
    """items: [(level, text)]. Reuses template paragraphs as formatting prototypes."""
    paras = txBody.findall(q("a:p"))
    if not paras:
        paras = [ET.SubElement(txBody, q("a:p"))]
    by_level = {}
    for p in paras:
        by_level.setdefault(para_level(p), p)
    for p in txBody.findall(q("a:p")):
        txBody.remove(p)
    if not items:
        items = [(0, "")]
    for level, text in items:
        proto = by_level.get(level)
        if proto is None:
            proto = by_level[min(by_level)] if by_level else paras[0]
        p = copy.deepcopy(proto)
        if para_level(p) != level:
            pPr = p.find(q("a:pPr"))
            if pPr is None:
                pPr = ET.Element(q("a:pPr"))
                p.insert(0, pPr)
            if level:
                pPr.set("lvl", str(level))
            else:
                pPr.attrib.pop("lvl", None)
        _set_para_text(p, text)
        txBody.append(p)


def _write_table(tbl, rows):
    trs = tbl.findall(q("a:tr"))
    if not trs:
        return
    tblPr = tbl.find(q("a:tblPr"))
    has_header = tblPr is not None and tblPr.get("firstRow") == "1" and len(trs) > 1
    header, body_protos = (trs[0], trs[1:]) if has_header else (None, trs)
    proto = body_protos[-1] if body_protos else trs[-1]
    grid = tbl.find(q("a:tblGrid"))
    ncols = len(grid.findall(q("a:gridCol"))) if grid is not None else len(proto.findall(q("a:tc")))

    supplied = list(rows)
    if has_header and supplied:
        for tc, text in zip(header.findall(q("a:tc")), supplied[0]):
            _write_paragraphs(tc.find(q("a:txBody")), [(0, text)])
        supplied = supplied[1:]

    for tr in trs:
        if tr is not header:
            tbl.remove(tr)
    for cells in supplied:
        tr = copy.deepcopy(proto)
        tcs = tr.findall(q("a:tc"))
        for col in range(min(ncols, len(tcs))):
            text = cells[col] if col < len(cells) else ""
            _write_paragraphs(tcs[col].find(q("a:txBody")), [(0, text)])
        tbl.append(tr)


# ── Image helpers ────────────────────────────────────────────────────────────

def image_size(path):
    """(w, h) for PNG/JPEG/GIF without external libraries; None if unknown."""
    data = Path(path).read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + seg_len
        return None
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h
    return None


def center_crop(src_ratio, frame_ratio):
    """a:srcRect percentages (l, t, r, b in 1/1000 %) for a fill-without-distortion crop."""
    if not src_ratio or not frame_ratio:
        return None
    if abs(src_ratio - frame_ratio) < 1e-3:
        return None
    if src_ratio > frame_ratio:      # source too wide: trim left/right
        keep = frame_ratio / src_ratio
        cut = int(round((1 - keep) / 2 * 100000))
        return {"l": cut, "r": cut}
    keep = src_ratio / frame_ratio   # source too tall: trim top/bottom
    cut = int(round((1 - keep) / 2 * 100000))
    return {"t": cut, "b": cut}


IMAGE_CT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml",
    ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff",
}


# ── Catalog ──────────────────────────────────────────────────────────────────

def ratio_label(r):
    if not r:
        return "—"
    for w, h in ((16, 9), (4, 3), (3, 2), (1, 1), (21, 9), (2, 3), (3, 4), (9, 16)):
        if abs(r - w / h) < 0.04:
            return "%d:%d frame" % (w, h)
    return "%.2f:1 frame" % r


def truncate(s, n=44):
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def slide_title(slots):
    for s in slots:
        if s.id == "title" and s.sample:
            return truncate(s.sample[0], 40)
    for s in slots:
        if s.type in ("text", "list") and s.sample and s.sample[0].strip():
            return truncate(s.sample[0], 40)
    return "(untitled)"


def layout_of(pkg, slide_part):
    rn = rels_name(slide_part)
    if rn not in pkg.parts:
        return ""
    for rel in ET.fromstring(pkg.parts[rn]):
        if rel.get("Type", "").endswith("/slideLayout"):
            target = "ppt/" + rel.get("Target").replace("../", "")
            if target in pkg.parts:
                root = ET.fromstring(pkg.parts[target])
                cSld = root.find(q("p:cSld"))
                if cSld is not None and cSld.get("name"):
                    return cSld.get("name")
            return Path(target).stem
    return ""


def stub_for(archetype, slots, title):
    out = ["## @%s   <!-- %s -->" % (archetype, title)]
    for s in slots:
        if s.type == "text":
            if not (s.sample and s.sample[0].strip()):
                continue
            out.append("%s: %s" % (s.id, truncate(s.sample[0], 40)))
        elif s.type == "list":
            out.append("%s:" % s.id)
            for sample in (s.sample or [""])[:3]:
                out.append("  - %s" % truncate(sample, 40))
        elif s.type == "table":
            out.append("%s:" % s.id)
            for row in (s.sample or [[]])[:2]:
                out.append("  | %s |" % " | ".join(truncate(c, 18) for c in row))
        elif s.type == "picture":
            out.append("%s: path/to/image.png" % s.id)
        elif s.type == "chart":
            out.append("# %s: chart — not writable, template data is kept" % s.id)
    return "\n".join(out)


def cmd_catalog(args):
    pkg = Package(args.template)
    parts = slide_order(pkg)
    lines = [
        "# Deck catalog — %s" % Path(args.template).name,
        "",
        "%d archetypes. In `deck.md`, start a slide with `## @<archetype>` and set slots by id."
        % len(parts),
        "Slots you leave out keep the template's own content. `slot: !drop` removes the shape.",
        "",
        "```",
        "---",
        "template: %s" % args.template,
        "output: deck.pptx",
        "---",
        "```",
        "",
    ]
    for idx, part in enumerate(parts, 1):
        slots = analyze_slide(ET.fromstring(pkg.parts[part]))
        title = slide_title(slots)
        layout = layout_of(pkg, part)
        lines.append("## @s%d · %s%s" % (idx, title, "  (layout: %s)" % layout if layout else ""))
        lines.append("")
        if not slots:
            lines += ["No addressable slots — this slide is decorative and clones as-is.", ""]
            continue
        lines.append("| slot | type | template shows | capacity |")
        lines.append("|---|---|---|---|")
        for s in slots:
            if s.type == "text":
                shows = '"%s"' % truncate(s.sample[0] if s.sample else "")
                cap = "~%d chars/line" % s.max_chars if s.max_chars else "inherited"
            elif s.type == "list":
                shows = "%d items · %s" % (s.max_items, truncate(s.sample[0] if s.sample else "", 28))
                cap = "~%d chars/line" % s.max_chars if s.max_chars else "inherited"
            elif s.type == "table":
                shows = "%d rows × %d cols" % (s.max_items, s.cols or 0)
                cap = "header row kept" 
            elif s.type == "picture":
                shows = s.label or "picture"
                cap = ratio_label(s.ratio)
            else:
                shows = s.label or "chart"
                cap = "not writable"
            lines.append("| `%s` | %s | %s | %s |" % (s.id, s.type, shows, cap))
        lines += ["", "```markdown", stub_for("s%d" % idx, slots, title), "```", ""]
    text = "\n".join(lines) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print("catalog -> %s  (%d archetypes)" % (args.output, len(parts)))
    else:
        sys.stdout.write(text)
    return 0


# ── Applying values ──────────────────────────────────────────────────────────

def as_items(kind, value):
    if kind == "list":
        return value
    if kind == "table":
        return [(0, " ".join(r)) for r in value]
    text = value or ""
    return [(0, line) for line in text.split("\n")]


def apply_value(spTree, slot, kind, value, imgctx, problems, where):
    el = resolve_path(spTree, slot.path)
    if isinstance(value, str) and value.strip() == "!drop":
        for parent in spTree.iter():
            if el in list(parent):
                parent.remove(el)
                return
        return

    if slot.type in ("text", "list"):
        txBody = el.find(q("p:txBody"))
        _write_paragraphs(txBody, as_items(kind, value))
    elif slot.type == "table":
        if kind != "table":
            problems.append("%s: slot '%s' is a table — use `| a | b |` rows" % (where, slot.id))
            return
        tbl = el.find(".//" + q("a:tbl"))
        _write_table(tbl, value)
    elif slot.type == "picture":
        if kind != "scalar":
            problems.append("%s: slot '%s' is a picture — give it a file path" % (where, slot.id))
            return
        _swap_picture(el, value, imgctx, problems, where, slot)
    elif slot.type == "chart":
        problems.append("%s: slot '%s' is a chart — chart data is not writable, "
                        "template values kept" % (where, slot.id))


def _swap_picture(el, path, imgctx, problems, where, slot):
    src = (imgctx["base"] / path).resolve() if not Path(path).is_absolute() else Path(path)
    if not src.is_file():
        problems.append("%s: image not found: %s" % (where, src))
        return
    ext = src.suffix.lower()
    if ext not in IMAGE_CT:
        problems.append("%s: unsupported image type %s" % (where, ext))
        return
    key = str(src)
    if key in imgctx["by_src"]:
        part = imgctx["by_src"][key]
    else:
        imgctx["n"] += 1
        part = "ppt/media/deckbuilder%d%s" % (imgctx["n"], ext)
        imgctx["pkg"].parts[part] = src.read_bytes()
        imgctx["by_src"][key] = part
        imgctx["exts"].add(ext)
    rid = imgctx["add_rel"](REL_IMAGE, "../media/" + Path(part).name)

    blip = el.find(".//" + q("a:blip"))
    if blip is None:
        problems.append("%s: slot '%s' has no image fill to replace" % (where, slot.id))
        return
    blip.set(q("r:embed"), rid)
    fill = el.find(q("p:blipFill"))
    if fill is not None:
        for old in fill.findall(q("a:srcRect")):
            fill.remove(old)
        size = image_size(src)
        crop = center_crop(size[0] / size[1] if size and size[1] else None, slot.ratio)
        if crop:
            rect = ET.Element(q("a:srcRect"))
            for k, v in crop.items():
                rect.set(k, str(v))
            fill.insert(list(fill).index(blip) + 1, rect)


# ── Build ────────────────────────────────────────────────────────────────────

def resolve_template(front, args, md_path):
    if args.template:
        return Path(args.template)
    t = front.get("template")
    if not t:
        raise SystemExit("error: no template — put `template: path.pptx` in the front matter "
                         "or pass --template")
    p = Path(t)
    return p if p.is_absolute() else (md_path.parent / p)


def cmd_build(args):
    md_path = Path(args.deck)
    front, specs, errors = parse_deck(md_path.read_text(encoding="utf-8"))
    template = resolve_template(front, args, md_path)
    out = Path(args.output or front.get("output") or md_path.with_suffix(".pptx"))
    if not out.is_absolute():
        out = md_path.parent / out
    if not specs:
        raise SystemExit("error: deck.md has no slides (no `## @archetype` headers)")

    pkg = Package(template)
    protos = slide_order(pkg)
    proto_xml = {n: pkg.parts[n] for n in protos}
    proto_rels = {n: pkg.parts.get(rels_name(n)) for n in protos}

    for n in protos:
        pkg.drop(n)
        pkg.drop(rels_name(n))
    for n in [k for k in list(pkg.parts) if k.startswith("ppt/notesSlides/")]:
        pkg.drop(n)

    imgctx = {"pkg": pkg, "base": md_path.parent.resolve(), "n": 0,
              "by_src": {}, "exts": set(), "add_rel": None}
    problems = list(errors)
    new_parts = []

    for i, spec in enumerate(specs, 1):
        m = re.fullmatch(r"s(\d+)", spec.archetype)
        if not m or not (1 <= int(m.group(1)) <= len(protos)):
            problems.append("line %d: unknown archetype '@%s' (template has s1..s%d)"
                            % (spec.line, spec.archetype, len(protos)))
            continue
        proto = protos[int(m.group(1)) - 1]
        root = ET.fromstring(proto_xml[proto])
        spTree = root.find(q("p:cSld") + "/" + q("p:spTree"))
        slots = {s.id: s for s in analyze_slide(root)}

        rels_root = ET.fromstring(proto_rels[proto]) if proto_rels.get(proto) else \
            ET.Element(q("pr:Relationships"))
        for rel in list(rels_root):
            if rel.get("Type") == REL_NOTES:
                rels_root.remove(rel)
        used = {int(re.sub(r"\D", "", rel.get("Id")) or 0) for rel in rels_root}
        counter = [max(used) if used else 0]

        def add_rel(rtype, target, _root=rels_root, _c=counter):
            _c[0] += 1
            rid = "rId%d" % _c[0]
            el = ET.SubElement(_root, q("pr:Relationship"))
            el.set("Id", rid)
            el.set("Type", rtype)
            el.set("Target", target)
            return rid

        imgctx["add_rel"] = add_rel

        for slot_id, kind, value, line in spec.values:
            where = "line %d" % line
            if slot_id not in slots:
                problems.append("%s: '@%s' has no slot '%s' (has: %s)"
                                % (where, spec.archetype, slot_id,
                                   ", ".join(slots) or "none"))
                continue
            apply_value(spTree, slots[slot_id], kind, value, imgctx, problems, where)

        part = "ppt/slides/slide%d.xml" % i
        pkg.parts[part] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
        pkg.parts[rels_name(part)] = ET.tostring(rels_root, encoding="UTF-8",
                                                 xml_declaration=True)
        new_parts.append(part)

    _rewrite_presentation(pkg, new_parts)
    _rewrite_content_types(pkg, new_parts, imgctx["exts"])
    out.parent.mkdir(parents=True, exist_ok=True)
    pkg.write(out)

    fatal = [p for p in problems if "not writable" not in p]
    print("build -> %s  (%d slides from %s)" % (out, len(new_parts), template.name))
    for p in problems:
        print("  ! %s" % p)
    if imgctx["n"]:
        print("  %d image(s) embedded" % imgctx["n"])
    return 1 if fatal and args.strict else 0


def _rewrite_presentation(pkg, new_parts):
    pres = pkg.xml("ppt/presentation.xml")
    rels = pkg.xml(rels_name("ppt/presentation.xml"))
    for rel in list(rels):
        if rel.get("Type") == REL_SLIDE:
            rels.remove(rel)
    used = {int(re.sub(r"\D", "", rel.get("Id")) or 0) for rel in rels}
    nxt = (max(used) if used else 0) + 1

    lst = pres.find(q("p:sldIdLst"))
    if lst is None:
        lst = ET.Element(q("p:sldIdLst"))
        anchor = pres.find(q("p:sldMasterIdLst"))
        pres.insert(list(pres).index(anchor) + 1 if anchor is not None else 0, lst)
    for sld in list(lst):
        lst.remove(sld)

    for n, part in enumerate(new_parts):
        rid = "rId%d" % (nxt + n)
        rel = ET.SubElement(rels, q("pr:Relationship"))
        rel.set("Id", rid)
        rel.set("Type", REL_SLIDE)
        rel.set("Target", "slides/" + Path(part).name)
        sld = ET.SubElement(lst, q("p:sldId"))
        sld.set("id", str(256 + n))
        sld.set(q("r:id"), rid)

    pkg.set_xml("ppt/presentation.xml", pres)
    pkg.set_xml(rels_name("ppt/presentation.xml"), rels)


def _rewrite_content_types(pkg, new_parts, exts):
    text = pkg.parts["[Content_Types].xml"].decode("utf-8")
    text = re.sub(r'<Override[^>]*PartName="/ppt/(?:slides|notesSlides)/[^"]*"[^>]*/>', "", text)
    defaults = ""
    for ext in sorted(exts):
        bare = ext.lstrip(".")
        if 'Extension="%s"' % bare not in text:
            defaults += '<Default Extension="%s" ContentType="%s"/>' % (bare, IMAGE_CT[ext])
    overrides = "".join(
        '<Override PartName="/%s" ContentType="%s"/>' % (p, CT_SLIDE) for p in new_parts)
    text = text.replace("</Types>", defaults + overrides + "</Types>")
    pkg.parts["[Content_Types].xml"] = text.encode("utf-8")


# ── Check ────────────────────────────────────────────────────────────────────

def cmd_check(args):
    md_path = Path(args.deck)
    front, specs, errors = parse_deck(md_path.read_text(encoding="utf-8"))
    template = resolve_template(front, args, md_path)
    pkg = Package(template)
    protos = slide_order(pkg)
    catalog = {"s%d" % i: analyze_slide(ET.fromstring(pkg.parts[n]))
               for i, n in enumerate(protos, 1)}

    errs, warns = list(errors), []
    for spec in specs:
        tag = "@%s (line %d)" % (spec.archetype, spec.line)
        slots = catalog.get(spec.archetype)
        if slots is None:
            errs.append("%s: unknown archetype — template has s1..s%d" % (tag, len(protos)))
            continue
        by_id = {s.id: s for s in slots}
        seen = set()
        for slot_id, kind, value, line in spec.values:
            seen.add(slot_id)
            slot = by_id.get(slot_id)
            if slot is None:
                errs.append("line %d: %s has no slot '%s' — available: %s"
                            % (line, tag, slot_id, ", ".join(by_id)))
                continue
            if slot.type == "picture" and kind == "scalar" and value.strip() != "!drop":
                p = Path(value)
                p = p if p.is_absolute() else md_path.parent / p
                if not p.is_file():
                    errs.append("line %d: %s.%s — image not found: %s"
                                % (line, tag, slot_id, p))
            if slot.type == "table" and kind != "table":
                errs.append("line %d: %s.%s is a table — use `| a | b |` rows"
                            % (line, tag, slot_id))
            if slot.type == "chart":
                warns.append("line %d: %s.%s is a chart — not writable, template data kept"
                             % (line, tag, slot_id))
            if slot.type in ("text", "list") and slot.max_chars:
                for lvl, text in as_items(kind, value):
                    if len(text) > slot.max_chars:
                        warns.append("line %d: %s.%s — %d chars vs ~%d/line, will wrap or "
                                     "overflow: %r" % (line, tag, slot_id, len(text),
                                                       slot.max_chars, truncate(text, 34)))
            if slot.type == "list" and slot.max_items and kind == "list" \
                    and len(value) > slot.max_items:
                warns.append("line %d: %s.%s — %d items vs %d in the template; extra items "
                             "are cloned and may run past the frame"
                             % (line, tag, slot_id, len(value), slot.max_items))
        untouched = [s.id for s in slots if s.id not in seen and s.type != "chart"]
        if untouched:
            warns.append("%s: keeps template content for %s" % (tag, ", ".join(untouched)))

    print("check %s against %s" % (md_path.name, template.name))
    print("  %d slides, %d error(s), %d warning(s)" % (len(specs), len(errs), len(warns)))
    for e in errs:
        print("  ERROR  %s" % e)
    for w in warns:
        print("  warn   %s" % w)
    return 1 if errs else 0


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("catalog", help="template.pptx -> catalog markdown")
    c.add_argument("--template", required=True)
    c.add_argument("--output")
    c.set_defaults(func=cmd_catalog)

    k = sub.add_parser("check", help="validate deck.md against the template")
    k.add_argument("--deck", required=True)
    k.add_argument("--template")
    k.set_defaults(func=cmd_check)

    b = sub.add_parser("build", help="deck.md -> deck.pptx")
    b.add_argument("--deck", required=True)
    b.add_argument("--template")
    b.add_argument("--output")
    b.add_argument("--strict", action="store_true", help="exit nonzero on any problem")
    b.set_defaults(func=cmd_build)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
