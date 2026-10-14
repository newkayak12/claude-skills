"""
Deck Builder — a compiler for PowerPoint decks.

  template.pptx   the toolchain: a catalog of slide archetypes. Always required —
                  there is no built-in template and no default deck design.
  deck.mdx        the source: what goes on each slide
  deck.pptx       the build artifact: regenerated in full, never hand-edited

Subcommands:
  catalog   template.pptx -> deck.catalog.md  (archetypes, slots, capacity hints)
  check     deck.mdx      -> diagnostics      (unknown slots, overflow, missing files)
  build     deck.mdx      -> deck.pptx        (clone archetype slides, swap content)
  render    deck.mdx      -> pdf + previews   (build, then look: collisions, off-slide)

A deck is read by people, so "the text is in the file" is not the bar. `render` puts the
deck through a real renderer and reports what physically collides on the page.

Python stdlib only: zipfile, xml.etree, re. No python-pptx, no PyYAML.
"""

import argparse
import copy
import hashlib
import os
import math
import re
import unicodedata
import shutil
import zlib
import statistics
import struct
import subprocess
import sys
import tempfile
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

REL_NOTESMASTER = ("http://schemas.openxmlformats.org/officeDocument/2006/"
                   "relationships/notesMaster")
CT_NOTES = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
CT_NOTESMASTER = ("application/vnd.openxmlformats-officedocument.presentationml."
                  "notesMaster+xml")
RESERVED_KEYS = ("notes",)
REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"

EMU_PER_PT = 12700
DECK_EXT = ".mdx"
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)   # fixed so identical sources give identical bytes


def q(name):
    """'a:t' -> '{http://...}t'"""
    prefix, _, local = name.partition(":")
    return "{%s}%s" % (NS[prefix], local)


# ── Package I/O ──────────────────────────────────────────────────────────────

class TemplateError(SystemExit):
    pass


def require_template(path):
    """A reference template is mandatory. Fail loudly and early, never guess one."""
    if path is None:
        raise TemplateError(
            "error: no reference template.\n"
            "  deck-builder never invents a deck design — every slide is a clone of a\n"
            "  slide that already exists in a template. Put `template: <file>.pptx` in the\n"
            "  front matter of your %s, or pass --template." % DECK_EXT)
    path = Path(path)
    if not path.exists():
        raise TemplateError("error: reference template not found: %s" % path)
    if not path.is_file():
        raise TemplateError("error: reference template is not a file: %s" % path)
    if path.suffix.lower() not in (".pptx", ".pptm"):
        raise TemplateError(
            "error: reference template must be .pptx or .pptm, got %s: %s"
            % (path.suffix or "no extension", path))
    try:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
    except zipfile.BadZipFile:
        raise TemplateError(
            "error: %s is not a readable pptx (password-protected or corrupt?)" % path)
    if "ppt/presentation.xml" not in names:
        raise TemplateError("error: %s has no ppt/presentation.xml — not a presentation" % path)
    return path


def require_deck(path):
    """Deck sources are .mdx: a source file, not a document someone reads as markdown."""
    path = Path(path)
    if path.suffix.lower() != DECK_EXT:
        raise SystemExit(
            "error: deck source must be a %s file, got %s\n"
            "  the deck source is compiled, not read — rename it:  mv %s %s"
            % (DECK_EXT, path.name, path.name, path.with_suffix(DECK_EXT).name))
    if not path.is_file():
        raise SystemExit("error: deck source not found: %s" % path)
    return path


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
        """Write the package with fixed entry timestamps.

        zipfile stamps entries with the wall clock, which would make two builds of the
        same source differ in bytes for no reason anyone can act on. Pinning the zip
        epoch is what makes "the same deck.mdx gives the same pptx" a real guarantee
        rather than one that only holds inside a single second.
        """
        seen = set()
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for name in list(self.order) + list(self.parts):
                if name not in self.parts or name in seen:
                    continue
                info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o600 << 16
                z.writestr(info, self.parts[name])
                seen.add(name)

    def drop(self, name):
        self.parts.pop(name, None)


def rels_name(part):
    p = Path(part)
    return str(p.parent / "_rels" / (p.name + ".rels")).replace(os.sep, "/")


def slide_size(pkg):
    """(cx, cy) of the slide canvas in EMU."""
    sz = pkg.xml("ppt/presentation.xml").find(q("p:sldSz"))
    if sz is None:
        return 12192000, 6858000
    return int(sz.get("cx", 12192000)), int(sz.get("cy", 6858000))


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


def offset(el):
    """(x, y) in EMU from the shape's own xfrm, or None when inherited."""
    for tag in ("p:spPr", "p:xfrm", "p:grpSpPr"):
        holder = el.find(q(tag))
        if holder is None:
            continue
        xfrm = holder if tag == "p:xfrm" else holder.find(q("a:xfrm"))
        if xfrm is None:
            continue
        off = xfrm.find(q("a:off"))
        if off is not None:
            return int(off.get("x", 0)), int(off.get("y", 0))
    return None


# ── Font metrics ─────────────────────────────────────────────────────────────
# head (unitsPerEm) · hhea (ascender/descender/lineGap, numberOfHMetrics) · hmtx (advance
# per glyph) · cmap (codepoint -> glyph, formats 4 and 12) · name. An OTF's hmtx is the
# same as a TTF's, so the outline flavour does not matter. No kerning, no shaping.

class Font:
    def __init__(self, path, tables):
        self.path = str(path)
        head, hhea = tables["head"], tables["hhea"]
        self.units_per_em = struct.unpack_from(">H", head, 18)[0]
        self.ascender, self.descender, self.line_gap = struct.unpack_from(">hhh", hhea, 4)
        self._nhm = struct.unpack_from(">H", hhea, 34)[0]
        self._hmtx = tables["hmtx"]
        self._cmap = _parse_cmap(tables["cmap"])
        self.names = _parse_names(tables.get("name", b""))
        self.label = (self.names.get(4) or self.names.get(16) or self.names.get(1)
                      or Path(path).stem)

    def advance(self, cp):
        """Advance in font units, or None when the font has no glyph for cp."""
        gid = self._cmap.get(cp)
        if gid is None:
            return None
        i = min(gid, self._nhm - 1)
        return struct.unpack_from(">H", self._hmtx, 4 * i)[0]

    def width(self, text, size):
        """Points. A character with no glyph takes the font's .notdef width."""
        notdef = struct.unpack_from(">H", self._hmtx, 0)[0]
        total = 0
        for ch in text:
            a = self.advance(ord(ch))
            total += notdef if a is None else a
        return total * size / self.units_per_em

    def line_height(self, size):
        return (self.ascender - self.descender + self.line_gap) * size / self.units_per_em


def _parse_cmap(data):
    n = struct.unpack_from(">H", data, 2)[0]
    subs = []
    for i in range(n):
        plat, enc, off = struct.unpack_from(">HHI", data, 4 + 8 * i)
        fmt = struct.unpack_from(">H", data, off)[0]
        if fmt in (4, 12) and (plat, enc) in ((3, 10), (3, 1), (0, 3), (0, 4), (0, 6)):
            subs.append((fmt, off))
    subs.sort(key=lambda s: -s[0])          # format 12 covers the astral planes
    out = {}
    for fmt, off in subs:
        if fmt == 12:
            groups = struct.unpack_from(">I", data, off + 12)[0]
            for g in range(groups):
                start, end, gid = struct.unpack_from(">III", data, off + 16 + 12 * g)
                for c in range(start, end + 1):
                    out.setdefault(c, gid + c - start)
        else:
            seg = struct.unpack_from(">H", data, off + 6)[0] // 2
            ends = off + 14
            starts, deltas, ranges = ends + 2 * seg + 2, ends + 4 * seg + 2, ends + 6 * seg + 2
            for s in range(seg):
                end = struct.unpack_from(">H", data, ends + 2 * s)[0]
                start = struct.unpack_from(">H", data, starts + 2 * s)[0]
                delta = struct.unpack_from(">h", data, deltas + 2 * s)[0]
                rng = struct.unpack_from(">H", data, ranges + 2 * s)[0]
                if end == 0xFFFF:
                    end = min(end, 0xFFFE)
                for c in range(start, end + 1):
                    if rng == 0:
                        gid = (c + delta) & 0xFFFF
                    else:
                        pos = ranges + 2 * s + rng + 2 * (c - start)
                        gid = struct.unpack_from(">H", data, pos)[0]
                        gid = (gid + delta) & 0xFFFF if gid else 0
                    if gid:
                        out.setdefault(c, gid)
    return out


def _parse_names(data):
    """name id -> string, preferring the English record over a localised one."""
    if len(data) < 6:
        return {}
    count, base = struct.unpack_from(">HH", data, 2)
    out, rank = {}, {}
    for i in range(count):
        plat, _, lang, nid, ln, off = struct.unpack_from(">HHHHHH", data, 6 + 12 * i)
        raw = data[base + off: base + off + ln]
        try:
            s = raw.decode("utf-16-be") if plat in (0, 3) else raw.decode("mac_roman")
        except UnicodeDecodeError:
            continue
        r = 0 if (plat == 3 and lang == 0x409) else 1 if (plat == 1 and lang == 0) else 2
        if nid not in out or r < rank[nid]:
            out[nid], rank[nid] = s, r
    return out


def _sfnt_tables(f, wanted):
    """Read only the wanted tables from an open font file (first face of a .ttc)."""
    f.seek(0)
    head = f.read(12)
    base = 0
    if head[:4] == b"ttcf":
        f.seek(12)
        base = struct.unpack(">I", f.read(4))[0]
        f.seek(base)
        head = f.read(12)
    n = struct.unpack_from(">H", head, 4)[0]
    recs = f.read(16 * n)
    out = {}
    for i in range(n):
        tag, _, off, ln = struct.unpack_from(">4sIII", recs, 16 * i)
        t = tag.decode("latin-1")
        if t in wanted:
            f.seek(off)
            out[t] = f.read(ln)
    return out


def read_font(path):
    """Parse a TTF/OTF/TTC file into a Font. Raises on anything that is not a usable sfnt."""
    with open(str(path), "rb") as f:
        tables = _sfnt_tables(f, ("head", "hhea", "hmtx", "cmap", "name"))
    for need in ("head", "hhea", "hmtx", "cmap"):
        if need not in tables:
            raise ValueError("%s: no %s table" % (path, need))
    return Font(path, tables)


FONT_EXT = (".ttf", ".otf", ".ttc")
STD_FONT_DIRS = ("/System/Library/Fonts", "/Library/Fonts", "~/Library/Fonts",
                 "/usr/share/fonts", "/usr/local/share/fonts", "~/.fonts",
                 "~/.local/share/fonts", "C:\\Windows\\Fonts")
# NanumSquare / NanumSquareRound / NanumSquare Neo (OFL), shipped so a template on them
# measures and renders on real metrics with nothing installed.
BUNDLED_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_INDEX = {}      # dirs tuple -> {key: path}
_FONTS = {}      # path -> Font


def _norm(s):
    return re.sub(r"[\s_\-]+", "", s or "").lower()


def _font_keys(names):
    fam, sub = names.get(1, ""), names.get(2, "")
    tfam, tsub = names.get(16, ""), names.get(17, "")
    keys = {_norm(names.get(4)), _norm(fam + " " + sub), _norm(tfam + " " + tsub)}
    if _norm(sub) in ("regular", "") and fam:
        keys.add(_norm(fam))
    if _norm(tsub) in ("regular", "") and tfam:
        keys.add(_norm(tfam))
    keys.discard("")
    return keys


def _scan(dirs):
    key = tuple(str(d) for d in dirs)
    if key in _INDEX:
        return _INDEX[key]
    index = {}
    for d in dirs:
        for root, _, files in os.walk(os.path.expanduser(str(d))):
            for fn in sorted(files):
                if not fn.lower().endswith(FONT_EXT):
                    continue
                p = os.path.join(root, fn)
                try:
                    with open(p, "rb") as f:
                        names = _parse_names(_sfnt_tables(f, ("name",)).get("name", b""))
                except (OSError, struct.error, ValueError):
                    continue
                for k in _font_keys(names):
                    index.setdefault(k, p)
    _INDEX[key] = index
    return index


def _load(path):
    if path not in _FONTS:
        try:
            _FONTS[path] = read_font(path)
        except (OSError, struct.error, ValueError):
            _FONTS[path] = None
    return _FONTS[path]


def find_font(family, bold=False, dirs=None):
    """The Font for a typeface name, or None. Never a substitute: a near miss is a lie
    about every width downstream, so an absent face stays absent and the caller says 추정.

    dirs=None searches DECK_FONT_DIRS, then the bundled fonts, then fontconfig, then the
    standard directories."""
    n = _norm(family)
    if not n:
        return None
    cands = ([n + "bold", n] if bold else [n + "regular", n])
    if dirs is not None:
        stages = [list(dirs)]
    else:
        env = [d for d in os.environ.get("DECK_FONT_DIRS", "").split(os.pathsep) if d]
        stages = [env, [str(BUNDLED_FONT_DIR)], "fc", list(STD_FONT_DIRS)]
    for stage in stages:
        if stage == "fc":
            path = _fc_match(family, bold)
            if path:
                font = _load(path)
                if font and set(cands) & _font_keys(font.names):
                    return font
            continue
        if not stage:
            continue
        index = _scan(stage)
        for c in cands:
            if c in index:
                return _load(index[c])
    return None


def _fc_match(family, bold):
    try:
        r = subprocess.run(["fc-match", "-f", "%{file}", family + (":bold" if bold else "")],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


LATIN_EM = 0.55          # average advance of a Latin glyph, in em
WIDE_EM = 1.0            # a full-width CJK glyph occupies the whole em box


def char_em(ch):
    """Advance width of one character in em.

    A Hangul or Han glyph fills its em box; a Latin one averages just over half.
    Counting characters instead of width makes a Korean line look 1.8x shorter
    than it is, which is exactly how an overflowing title passes `check`.
    """
    return WIDE_EM if unicodedata.east_asian_width(ch) in ("W", "F") else LATIN_EM


def text_em(s):
    return sum(char_em(c) for c in s)


def mean_em(samples):
    """Average glyph width across some sample lines, for reporting a char budget."""
    joined = "".join(s for s in samples if s)
    return (text_em(joined) / len(joined)) if joined else LATIN_EM


def para_text(p):
    return "".join(t.text or "" for t in p.iter(q("a:t")))


def para_segments(p):
    """The paragraph's text split at its line breaks (<a:br/>): each piece starts a line."""
    segs = [""]
    for child in p:
        if child.tag == q("a:br"):
            segs.append("")
        elif child.tag in (q("a:r"), q("a:fld")):
            segs[-1] += "".join(t.text or "" for t in child.iter(q("a:t")))
    return segs


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
        self.segments = []       # per sample paragraph: its text split at explicit line breaks
        self.max_chars = None    # per line, in the script the template itself uses
        self.max_em = None       # per line, in em — the measure that does not lie
        self.proto_em = None     # the widest line the template itself puts here
        self.proto_vol = None    # total width of everything the template puts here
        self.proto_lines = None  # rendered lines the template's own content takes
        self.max_items = None    # paragraphs / rows the template shows
        self.ratio = None        # picture aspect "16:9"
        self.cols = None         # table columns
        self.off_y = None        # frame top in EMU
        self.row_h = None        # table row height in EMU
        self.line_h = None       # estimated line height in EMU
        self.fits = None         # rows/lines that clear the slide edge
        self.size_pt = None      # font size the template sets here
        self.frame_pt = None     # picture frame size in points
        self.box = None          # (x, y, cx, cy) in EMU, when the shape carries one
        self.z = 0               # document order: later shapes paint over earlier ones
        self.color_ref = None    # ("srgb", hex) | ("scheme", name) for the first run
        self.font = None         # Font for Latin text, when the file was found
        self.ea_font = None      # Font for East Asian text
        self.face = ""           # the typeface the slide asks for, as written
        self.estimated = True    # True: widths come from the em model, not a font file
        self.wrap = "square"     # bodyPr wrap: "none" never breaks a line
        self.insets = (7.2, 3.6, 7.2, 3.6)   # l, t, r, b in points
        self.eff_size = 18.0     # pt, after any autofit scale
        self.lnspc = 1.0         # paragraph line spacing multiple
        self.para_formats = []   # per template paragraph: (level, [run format label])
        self.has_br = False      # the template breaks a line inside a paragraph here


def run_face(txBody):
    """(latin typeface, east-asian typeface, bold) of the first run that names a face.
    Theme references (+mn-lt) are not resolved here — those slots stay estimated."""
    for rPr in list(txBody.iter(q("a:rPr"))) + list(txBody.iter(q("a:endParaRPr"))):
        latin, ea = rPr.find(q("a:latin")), rPr.find(q("a:ea"))
        lt = latin.get("typeface") if latin is not None else None
        et = ea.get("typeface") if ea is not None else None
        if lt and not lt.startswith("+"):
            et = et if et and not et.startswith("+") else lt
            return lt, et, rPr.get("b") == "1"
    return None, None, False


def body_geometry(txBody):
    """(wrap, (l, t, r, b) insets in pt, fontScale, line spacing multiple)."""
    bp = txBody.find(q("a:bodyPr"))
    if bp is None:
        bp = ET.Element("x")
    ins = tuple(int(bp.get(k, d)) / EMU_PER_PT for k, d in
                (("lIns", 91440), ("tIns", 45720), ("rIns", 91440), ("bIns", 45720)))
    na = bp.find(q("a:normAutofit"))
    scale = int(na.get("fontScale", 100000)) / 100000.0 if na is not None else 1.0
    spc = 1.0
    sp = txBody.find(".//" + q("a:pPr") + "/" + q("a:lnSpc") + "/" + q("a:spcPct"))
    if sp is not None:
        spc = int(sp.get("val", 100000)) / 100000.0
    return bp.get("wrap", "square"), ins, scale, spc


def _is_ea(ch):
    return unicodedata.east_asian_width(ch) in ("W", "F")


def slot_em(slot, s):
    """Width of s in em at the slot's size: from the font file when there is one, else
    the em model. The only place a width is read."""
    if slot.estimated:
        return text_em(s)
    total = 0.0
    for ch in s:
        f = slot.ea_font if _is_ea(ch) else slot.font
        a = f.advance(ord(ch))
        total += (a / f.units_per_em) if a is not None else char_em(ch)
    return total


def wrap_count(slot, text):
    """Lines one paragraph takes: greedy word wrap on measured widths. Breaks fall at
    spaces; a word wider than the line is broken at the character that overflows."""
    avail = slot.max_em
    lines, cur = 1, 0.0
    for word in re.findall(r"\S+\s*|\s+", text) or [""]:
        body = word.rstrip()
        w = slot_em(slot, body)
        trail = slot_em(slot, word[len(body):])
        if cur + w <= avail + 1e-9:
            cur += w + trail
            continue
        if cur > 0:
            lines, cur = lines + 1, 0.0
        if w <= avail + 1e-9:
            cur = w + trail
            continue
        for ch in body:
            cw = slot_em(slot, ch)
            if cur + cw > avail + 1e-9 and cur > 0:
                lines, cur = lines + 1, 0.0
            cur += cw
        cur += trail
    return lines


def _is_autofield(txBody):
    """True for shapes that only hold an auto field (slide number, date)."""
    flds = txBody.findall(q("a:p") + "/" + q("a:fld"))
    if not flds:
        return False
    runs = txBody.findall(q("a:p") + "/" + q("a:r"))
    return not any((para_text_of_run(r) or "").strip() for r in runs)


def shape_box(el):
    """(x, y, cx, cy) in EMU, or None when the shape inherits its geometry."""
    off, ext = offset(el), extent(el)
    return (off[0], off[1], ext[0], ext[1]) if off and ext else None


def text_color_ref(txBody):
    """How the first run asks for its colour, unresolved: ("srgb", hex) | ("scheme", name).

    Unresolved on purpose — a scheme reference only means something next to a theme,
    and analyze_slide does not have one.
    """
    for holder in list(txBody.iter(q("a:rPr"))) + list(txBody.iter(q("a:defRPr"))):
        fill = holder.find(q("a:solidFill"))
        if fill is None:
            continue
        srgb = fill.find(q("a:srgbClr"))
        if srgb is not None:
            return ("srgb", srgb.get("val", "").upper())
        scheme = fill.find(q("a:schemeClr"))
        if scheme is not None:
            return ("scheme", scheme.get("val", ""))
    return None


def para_text_of_run(r):
    t = r.find(q("a:t"))
    return t.text if t is not None else ""


def analyze_slide(root, slide_cy=None):
    """Return the slot list for one slide XML root.

    With slide_cy given, each stacking slot also reports how many rows or lines
    clear the bottom of the slide — past that, the renderer simply cuts them off."""
    spTree = root.find(q("p:cSld") + "/" + q("p:spTree"))
    slots = []
    counters = {"text": 0, "pic": 0, "table": 0, "chart": 0, "title": 0, "subtitle": 0}

    def next_id(kind):
        counters[kind] += 1
        n = counters[kind]
        if kind in ("title", "subtitle"):
            return kind if n == 1 else "%s%d" % (kind, n)
        return "%s%d" % (kind, n)

    for z, (el, path) in enumerate(walk_shapes(spTree)):
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
            slot.segments = [para_segments(p) for p in paras]
            slot.max_items = len(paras)
            slot.para_formats = [(para_level(p), [format_label(r) for r in run_formats(p)])
                                 for p in paras]
            slot.has_br = any(p.find(q("a:br")) is not None for p in paras)
            ext, off = extent(el), offset(el)
            size = first_font_size(txBody) or 18.0
            wrap, ins, scale, spc = body_geometry(txBody)
            size *= scale
            lt, et, bold = run_face(txBody)
            slot.face, slot.wrap, slot.insets, slot.eff_size, slot.lnspc = lt or "", wrap, ins, size, spc
            if lt:
                slot.font = find_font(lt, bold)
                slot.ea_font = find_font(et, bold) if et != lt else slot.font
            slot.estimated = slot.font is None or slot.ea_font is None
            if ext:
                cx_pt = ext[0] / EMU_PER_PT - ins[0] - ins[2]
                slot.max_em = max(2.0, cx_pt / size)
                joined = "".join(slot.sample)
                mean = (slot_em(slot, joined) / len(joined)) if joined else (
                    LATIN_EM if slot.estimated else slot_em(slot, "\uac00"))
                slot.max_chars = max(4, int(slot.max_em / mean))
                slot.proto_em = max([slot_em(slot, t) for t in slot.sample] or [0.0])
                slot.proto_vol = sum(slot_em(slot, t) for t in slot.sample)
                slot.proto_lines = sum(wrapped_lines(slot, segs) for segs in slot.segments)
            slot.size_pt = first_font_size(txBody)
            slot.line_h = int((slot.font.line_height(size) * spc if slot.font
                               else size * 1.2) * EMU_PER_PT)
            slot.box, slot.z = shape_box(el), z
            slot.color_ref = text_color_ref(txBody)
            if off:
                slot.off_y = off[1]
                if slide_cy:
                    slot.fits = max(1, (slide_cy - slot.off_y) // slot.line_h)
            slots.append(slot)
        elif el.tag == q("p:pic"):
            slot = Slot(next_id("pic"), "picture", path, name)
            ext = extent(el)
            if ext and ext[1]:
                slot.ratio = round(ext[0] / ext[1], 3)
                slot.frame_pt = (round(pt(ext[0])), round(pt(ext[1])))
            slot.box, slot.z = shape_box(el), z
            slots.append(slot)
        elif el.tag == q("p:graphicFrame"):
            tbl = el.find(".//" + q("a:tbl"))
            if tbl is not None:
                slot = Slot(next_id("table"), "table", path, name)
                rows = tbl.findall(q("a:tr"))
                grid = tbl.find(q("a:tblGrid"))
                slot.cols = len(grid.findall(q("a:gridCol"))) if grid is not None else 0
                slot.max_items = len(rows)
                heights = [int(tr.get("h", 0)) for tr in rows if tr.get("h")]
                slot.row_h = max(heights) if heights else None
                off = offset(el)
                if off:
                    slot.off_y = off[1]
                    if slide_cy and slot.row_h:
                        slot.fits = max(1, (slide_cy - slot.off_y) // slot.row_h)
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


# ── deck.mdx parsing ──────────────────────────────────────────────────────────

class SlideSpec:
    def __init__(self, archetype, line, comment=""):
        self.archetype = archetype
        self.line = line
        self.comment = comment
        self.values = []  # (slot_id, kind, value, line)


SLIDE_RE = re.compile(r"^##\s*@([A-Za-z0-9_-]+)\s*(.*)$")
KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$")


def parse_deck(text):
    """Parse deck.mdx -> (front_matter dict, [SlideSpec], [error strings])."""
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

EMPHASIS_RE = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`")


def split_emphasis(text):
    """[(text, bold, italic, mono)] from **bold**, *italic* and `code`.

    The run's own formatting is the template's; emphasis only flips attributes on a
    copy of it, so a bolded phrase keeps the font, size and color it was going to have.
    """
    out, pos = [], 0
    for m in EMPHASIS_RE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False, False, False))
        bold, italic, mono = m.group(1), m.group(2), m.group(3)
        out.append((bold or italic or mono, bool(bold), bool(italic), bool(mono)))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False, False, False))
    return out or [(text, False, False, False)]


BR_RE = re.compile(r"<br\s*/?>", re.I)
SPAN_RE = re.compile(r"(?<!\\)\[(.+?)\]\{(\d+)\}")


LOOK_ATTRS = ("sz", "b", "i", "u", "strike", "spc", "baseline", "cap", "kern")


def run_look(r):
    """What a run looks like — size, weight, colour, face — ignoring lang/dirty/err,
    which split one visible format into many."""
    rPr = r.find(q("a:rPr"))
    if rPr is None:
        return ()
    kids = tuple(ET.tostring(c) for c in rPr
                 if c.tag in (q("a:solidFill"), q("a:latin"), q("a:ea"), q("a:highlight")))
    off = {"b": "0", "i": "0", "u": "none", "strike": "noStrike", "baseline": "0"}
    return tuple(None if rPr.get(a) == off.get(a) else rPr.get(a) for a in LOOK_ATTRS) + kids


def run_formats(p):
    """The paragraph's distinct run formats, in order of appearance: [run element].
    `[text]{n}` in deck.mdx picks format n; unmarked text is format 1."""
    seen, out = set(), []
    for r in p.findall(q("a:r")):
        key = run_look(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def format_label(r):
    """`16pt #435EA0 굵게` — what a run format looks like, for the catalog."""
    rPr = r.find(q("a:rPr"))
    if rPr is None:
        return "상속"
    bits = ["%gpt" % (int(rPr.get("sz")) / 100.0)] if rPr.get("sz") else []
    fill = rPr.find(q("a:solidFill"))
    if fill is not None:
        c = fill.find(q("a:srgbClr"))
        s = fill.find(q("a:schemeClr"))
        bits.append("#" + c.get("val") if c is not None else s.get("val") if s is not None else "")
    if rPr.get("b") == "1":
        bits.append("굵게")
    return " ".join(b for b in bits if b) or "상속"


ESCAPES = (("\\ ", ""), ("\\*", ""), ("\\`", ""), ("\\[", ""),
           ("\\]", ""))


def protect(text):
    """Escaped characters out of the parsers' way: `\\ ` a space the parser would trim
    (a value ending in `\\` ends in a space), `\\*` `\\`` `\\[` literal."""
    if text.endswith("\\") and not text.endswith("\\\\"):
        text = text[:-1] + ""
    for esc, mark in ESCAPES:
        text = text.replace(esc, mark)
    return text


def restore(text):
    for esc, mark in ESCAPES:
        text = text.replace(mark, esc[1])
    return text


def split_spans(text):
    """[(text, format n) | (None, 'br')] from `[text]{n}` spans and `<br>`; escapes stay
    protected for split_emphasis and come back through restore()."""
    text = protect(text)
    out = []
    for i, line in enumerate(BR_RE.split(text)):
        if i:
            out.append((None, "br"))
        pos = 0
        for m in SPAN_RE.finditer(line):
            if m.start() > pos:
                out.append((line[pos:m.start()], 1))
            out.append((m.group(1), int(m.group(2))))
            pos = m.end()
        if pos < len(line) or not line:
            out.append((line[pos:], 1))
    return out


def plain_text(text):
    """What a reader sees of a value: markup removed, `<br>` as a newline."""
    out = "".join("\n" if t is None else t for t, _ in split_spans(text))
    return restore(EMPHASIS_RE.sub(lambda m: m.group(1) or m.group(2) or m.group(3), out))


def max_span_format(text):
    return max([n for t, n in split_spans(text) if t is not None] or [1])


def _set_para_text(p, text):
    """Replace a paragraph's runs with runs carrying `text`, honouring inline emphasis,
    `[text]{n}` (the paragraph's own run format n) and `<br>`."""
    formats = [copy.deepcopy(r) for r in run_formats(p)]
    base = formats[0] if formats else None
    for child in list(p):
        if child.tag in (q("a:r"), q("a:br"), q("a:fld")):
            p.remove(child)
    if base is None:
        base = ET.Element(q("a:r"))
        endPr = p.find(q("a:endParaRPr"))
        if endPr is not None:
            rPr = ET.SubElement(base, q("a:rPr"))
            for k, v in endPr.attrib.items():
                rPr.set(k, v)
            for sub in list(endPr):
                rPr.append(copy.deepcopy(sub))
        ET.SubElement(base, q("a:t"))
    formats = formats or [base]

    anchor = p.find(q("a:endParaRPr"))
    pieces = []
    for span, n in split_spans(text):
        if span is None:
            pieces.append((None, None, False, False, False))
            continue
        fmt = formats[n - 1] if 0 < n <= len(formats) else formats[0]
        pieces += [(fmt,) + e for e in split_emphasis(span) if e[0] or not span]
    for fmt, chunk, bold, italic, mono in pieces:
        if fmt is None:
            br = ET.Element(q("a:br"))
            rp = base.find(q("a:rPr"))
            if rp is not None:
                br.append(copy.deepcopy(rp))
            if anchor is not None:
                p.insert(list(p).index(anchor), br)
            else:
                p.append(br)
            continue
        run = copy.deepcopy(fmt)
        rPr = run.find(q("a:rPr"))
        if rPr is None:
            rPr = ET.Element(q("a:rPr"))
            run.insert(0, rPr)
        if bold:
            rPr.set("b", "1")
        if italic:
            rPr.set("i", "1")
        if mono:
            for tag in ("a:latin", "a:cs"):
                for old in rPr.findall(q(tag)):
                    rPr.remove(old)
            latin = ET.SubElement(rPr, q("a:latin"))
            latin.set("typeface", "Consolas")
        t = run.find(q("a:t"))
        if t is None:
            t = ET.SubElement(run, q("a:t"))
        chunk = restore(chunk)
        t.text = chunk
        if chunk != chunk.strip():
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        if anchor is not None:
            p.insert(list(p).index(anchor), run)
        else:
            p.append(run)


def prototype_para(paras, by_level, i, level):
    """Item i is cloned from template paragraph i when that one sits at the same level —
    so each keeps its own indent and run formats — else the first paragraph of the level."""
    if i < len(paras) and para_level(paras[i]) == level:
        return paras[i]
    proto = by_level.get(level)
    if proto is None:
        proto = by_level[min(by_level)] if by_level else paras[0]
    return proto


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
    for i, (level, text) in enumerate(items):
        proto = prototype_para(paras, by_level, i, level)
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
    for i, cells in enumerate(supplied):
        # Row i keeps template row i's own cell formats; rows past the template's repeat the last.
        tr = copy.deepcopy(body_protos[i] if i < len(body_protos) else proto)
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


FIT_MODES = ("fill", "fit", "stretch")
ANCHORS = ("center", "top", "bottom", "left", "right")
FLAGS = ("transparent",)
UNDERFILL_FLOOR = 60.0   # em — below this the slot is a label, and emptiness means nothing
UNDERFILL_RATIO = 0.55   # of the template's own volume
SPILL_SLACK = 1          # lines, em-model slots only — the estimate is worth about this much, and a
                         # designed frame often carries less slack than that, so only a
                         # gross overrun is knowable here. `render` settles the rest.


def parse_picture_value(value):
    """`path.png | fit transparent` -> (path, mode, anchor, flags)."""
    path, mode, anchor, flags = value, "fill", "center", set()
    if "|" in value:
        path, _, opts = value.rpartition("|")
        path = path.strip()
        for word in opts.split():
            word = word.lower()
            if word in FIT_MODES:
                mode = word
            elif word in ANCHORS:
                anchor = word
            elif word in FLAGS:
                flags.add(word)
            else:
                return value.strip(), None, word, flags   # unknown: caller reports it
    return path.strip(), mode, anchor, flags


def crop_rect(src_ratio, frame_ratio, anchor="center"):
    """a:srcRect (l, t, r, b in 1/1000 %) for a fill crop, plus the fraction discarded.

    A crop throws content away, so the caller is told how much — the same rule the table
    overflow follows: the engine may not lose content quietly.
    """
    if not src_ratio or not frame_ratio:
        return None, 0.0
    if abs(src_ratio - frame_ratio) / frame_ratio < 0.005:
        return None, 0.0
    if src_ratio > frame_ratio:                 # wider than the frame: trim the sides
        keep = frame_ratio / src_ratio
        cut = int(round((1 - keep) * 100000))
        if anchor == "left":
            rect = {"r": cut}
        elif anchor == "right":
            rect = {"l": cut}
        else:
            rect = {"l": cut // 2, "r": cut - cut // 2}
    else:                                       # taller than the frame: trim top/bottom
        keep = src_ratio / frame_ratio
        cut = int(round((1 - keep) * 100000))
        if anchor == "top":
            rect = {"b": cut}
        elif anchor == "bottom":
            rect = {"t": cut}
        else:
            rect = {"t": cut // 2, "b": cut - cut // 2}
    return rect, (1 - keep)


def fit_frame(off, ext, src_ratio):
    """Shrink the frame to the image's shape, centred in the box the template drew.

    `fit` keeps the whole image at the cost of leaving slide background inside the
    template's box — the opposite trade from `fill`, and the right one for a diagram
    or a screenshot where the edges carry meaning.
    """
    if not off or not ext or not src_ratio:
        return None
    cx, cy = ext
    frame_ratio = cx / cy if cy else src_ratio
    if src_ratio > frame_ratio:
        ncx, ncy = cx, int(round(cx / src_ratio))
    else:
        ncy, ncx = cy, int(round(cy * src_ratio))
    return (off[0] + (cx - ncx) // 2, off[1] + (cy - ncy) // 2), (ncx, ncy)


def set_frame(el, off, ext):
    spPr = el.find(q("p:spPr"))
    if spPr is None:
        return False
    xfrm = spPr.find(q("a:xfrm"))
    if xfrm is None:
        return False
    o, e = xfrm.find(q("a:off")), xfrm.find(q("a:ext"))
    if o is None or e is None:
        return False
    o.set("x", str(off[0]))
    o.set("y", str(off[1]))
    e.set("cx", str(ext[0]))
    e.set("cy", str(ext[1]))
    return True


# ── Color ────────────────────────────────────────────────────────────────────

HEX_RE = re.compile(r"#([0-9A-Fa-f]{6})\b|#([0-9A-Fa-f]{3})\b")


def svg_colors(path):
    """Every hex the SVG paints with, uppercased and expanded from shorthand."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    out = []
    for long_, short in HEX_RE.findall(text):
        if long_:
            out.append(long_.upper())
        elif short:
            out.append("".join(c * 2 for c in short).upper())
    seen = []
    for c in out:
        if c not in seen:
            seen.append(c)
    return seen


def rgb(hexv):
    h = hexv.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def color_distance(a, b):
    """Rough perceptual distance, 0-100. Good enough to tell 'clashes' from 'close'."""
    ra, ga, ba = rgb(a)
    rb, gb, bb = rgb(b)
    rm = (ra + rb) / 2
    d = ((2 + rm / 256) * (ra - rb) ** 2 + 4 * (ga - gb) ** 2
         + (2 + (255 - rm) / 256) * (ba - bb) ** 2) ** 0.5
    return min(100.0, d / 765 * 100)


def nearest(hexv, palette):
    if not palette:
        return None, 100.0
    best = min(palette, key=lambda c: color_distance(hexv, c))
    return best, color_distance(hexv, best)


def read_png(path, max_pixels=8_000_000):
    """(width, height, rows) for a plain PNG. rows are lists of (r,g,b,a).

    stdlib only — enough to look at an image's edges, not a general decoder.
    Interlaced or 16-bit-with-oddities files return None rather than a wrong answer.
    """
    data = Path(path).read_bytes()
    if data[:8] != PNG_MAGIC:
        return None
    pos, idat, pal, trns = 8, [], None, None
    w = h = depth = ctype = interlace = None
    while pos < len(data) - 8:
        ln = int.from_bytes(data[pos:pos + 4], "big")
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"PLTE":
            pal = body
        elif tag == b"tRNS":
            trns = body
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
        pos += 12 + ln
    if not w or interlace or depth not in (8, 16) or ctype not in (0, 2, 3, 4, 6):
        return None
    if w * h > max_pixels:
        return None
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = channels * (depth // 8)
    stride = w * bpp
    raw = zlib.decompress(b"".join(idat))
    if len(raw) < (stride + 1) * h:
        return None

    rows, prev = [], bytearray(stride)
    at = 0
    for _ in range(h):
        ft = raw[at]
        line = bytearray(raw[at + 1:at + 1 + stride])
        at += 1 + stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if ft == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ft == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ft == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        prev = line
        step = depth // 8
        px = []
        for x in range(w):
            o = x * bpp
            v = [line[o + i * step] for i in range(channels)]
            if ctype == 0:
                px.append((v[0], v[0], v[0], 255))
            elif ctype == 4:
                px.append((v[0], v[0], v[0], v[1]))
            elif ctype == 2:
                px.append((v[0], v[1], v[2], 255))
            elif ctype == 6:
                px.append((v[0], v[1], v[2], v[3]))
            else:
                i = v[0] * 3
                alpha = trns[v[0]] if trns and v[0] < len(trns) else 255
                px.append((pal[i], pal[i + 1], pal[i + 2], alpha) if pal else (0, 0, 0, 255))
        rows.append(px)
    return w, h, rows


def png_edge(path):
    """(dominant border hex, transparent fraction) — what the image's frame looks like."""
    got = read_png(path)
    if not got:
        return None
    w, h, rows = got
    edge = list(rows[0]) + list(rows[-1])
    for row in rows:
        edge.append(row[0])
        edge.append(row[-1])
    clear = sum(1 for p in edge if p[3] < 16)
    opaque = [p for p in edge if p[3] >= 16]
    if not opaque:
        return None, 1.0
    buckets = {}
    for r, g, b, _ in opaque:
        buckets.setdefault((r // 16, g // 16, b // 16), []).append((r, g, b))
    top = buckets[max(buckets, key=lambda k: len(buckets[k]))]
    avg = tuple(round(sum(c[i] for c in top) / len(top)) for i in range(3))
    return "%02X%02X%02X" % avg, clear / len(edge)


def write_png(path, w, h, rows):
    """RGBA PNG, unfiltered scanlines. Deterministic: same pixels, same bytes."""
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, body):
        c = tag + body
        return struct.pack(">I", len(body)) + c + struct.pack(">I", zlib.crc32(c))

    Path(path).write_bytes(
        PNG_MAGIC
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b""))


def knockout_background(rows, w, h, tol=14.0):
    """Flood the border colour away from the edges inward, leaving alpha 0 behind.

    Flooding from the edges rather than replacing every matching pixel is the whole
    point: a diagram full of white boxes keeps them, and only the background that
    actually touches the outside is removed.
    """
    corners = [rows[0][0], rows[0][-1], rows[-1][0], rows[-1][-1]]
    opaque = [c for c in corners if c[3] >= 16]
    if not opaque:
        return rows, 0.0, None
    base = tuple(round(sum(c[i] for c in opaque) / len(opaque)) for i in range(3))
    base_hex = "%02X%02X%02X" % base

    def matches(px):
        return px[3] >= 16 and color_distance("%02X%02X%02X" % px[:3], base_hex) <= tol

    out = [list(r) for r in rows]
    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))
    removed = 0
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not matches(out[y][x]):
            continue
        r, g, b, _ = out[y][x]
        out[y][x] = (r, g, b, 0)
        removed += 1
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))

    kept = [px for row in out for px in row if px[3] >= 16]
    content = None
    if kept:
        content = "%02X%02X%02X" % tuple(
            round(sum(px[i] for px in kept) / len(kept)) for i in range(3))
    return out, removed / (w * h), content


def analyse_knockout(path, tol=14.0):
    """(border hex, transparent fraction, mean colour of what survives) without writing."""
    got = read_png(path)
    if not got:
        return None
    w, h, rows = got
    edge = png_edge(path)
    out, frac, content = knockout_background(rows, w, h, tol)
    return (edge[0] if edge else None), frac, content


def make_transparent(src, cache_dir, tol=14.0):
    """Write a knocked-out copy into the cache; same source, same bytes, every time."""
    data = Path(src).read_bytes()
    key = hashlib.sha256(data + b"|knockout|%.1f" % tol).hexdigest()[:16]
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / ("%s.png" % key)
    if out.is_file():
        return out, None
    got = read_png(src)
    if not got:
        return None, ("%s could not be decoded, so its background cannot be removed — "
                      "transparency needs a plain (non-interlaced) PNG" % Path(src).name)
    w, h, rows = got
    rows, frac, content = knockout_background(rows, w, h, tol)
    if frac < 0.01:
        return None, ("%s has no uniform border to remove — its edges are already varied "
                      "or transparent" % Path(src).name)
    if frac > 0.98:
        return None, ("%s is background nearly all the way through — knocking it out "
                      "would leave %.0f%% of the image, which is nothing to look at"
                      % (Path(src).name, (1 - frac) * 100))
    write_png(out, w, h, rows)
    return out, None


# ── Text over a picture ──────────────────────────────────────────────────────

def resolve_color_ref(ref, theme):
    """A slot's colour reference against a theme map, or None when it is inherited."""
    if not ref:
        return None
    kind, val = ref
    if kind == "srgb":
        return val or None
    alias = {"tx1": "dk1", "bg1": "lt1", "tx2": "dk2", "bg2": "lt2"}
    return theme.get(alias.get(val, val))


def relative_luminance(hexv):
    """WCAG 2.x relative luminance for #RRGGBB."""
    out = []
    for c in rgb(hexv):
        c = c / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast_ratio(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def box_intersection(a, b):
    """The shared rectangle of two (x, y, cx, cy) boxes, or None."""
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    return (x0, y0, x1 - x0, y1 - y0) if x1 > x0 and y1 > y0 else None


def covered_fraction(inner, outer):
    """How much of `inner` the box `outer` sits on."""
    got = box_intersection(inner, outer)
    if not got or not inner[2] or not inner[3]:
        return 0.0
    return (got[2] * got[3]) / float(inner[2] * inner[3])


def covers_slide(slot, size, tol=0.97):
    """True when a picture frame is effectively the whole canvas."""
    if not slot.box or not size or not size[0] or not size[1]:
        return False
    return (slot.box[2] / float(size[0]) >= tol and slot.box[3] / float(size[1]) >= tol)


def wrapped_lines(slot, items):
    """How many rendered lines the items take in this slot's frame."""
    if not slot.max_em or slot.wrap == "none":
        return len(items)
    if slot.estimated:
        return sum(max(1, math.ceil(text_em(t) / slot.max_em)) for t in items)
    return sum(wrap_count(slot, t) for t in items)


def spill(slot, items):
    """(EMU this text runs lower than the template's own did, lines, template lines).

    Not "does it fit the box": line spacing, autofit and the em model together put an
    absolute answer out of reach — measured against this template it calls 46% of the
    designer's own text overflowing. What is knowable is the difference. The template's
    own content sits where the designer accepted it, so lines beyond that many are the
    ones pushing down the slide, and how far is (extra lines x line height).
    """
    if not slot.box or not slot.line_h or not slot.max_em or slot.proto_lines is None:
        return None
    lines = wrapped_lines(slot, items)
    extra = lines - slot.proto_lines - (SPILL_SLACK if slot.estimated else 0)
    return (max(0, extra) * slot.line_h, lines, slot.proto_lines)


def shapes_below(slot, slots, over_emu):
    """Slots the spilled text runs into, nearest first."""
    if not slot.box or over_emu <= 0:
        return []
    bottom = slot.box[1] + slot.box[3]
    reach = (slot.box[0], bottom, slot.box[2], over_emu)
    hit = []
    for other in slots:
        if other is slot or not other.box:
            continue
        if box_intersection(reach, other.box):
            hit.append((other.box[1], other))
    return [o for _, o in sorted(hit, key=lambda kv: kv[0])]


# ── Critical zone ────────────────────────────────────────────────────────────
#
# The gap between neighbouring shapes is the template's, not ours: a gap that recurs
# across its slides (within ±ZONE_TOL_PT, at least ZONE_MIN_REPEAT times) is that
# pair's zone, and content must not run into it. Shapes that overlap or share a group
# are one unit — the outermost outline around them — since their own gaps say nothing.

ZONE_TOL_PT = 1.0
ZONE_MIN_REPEAT = 2
ZONE_BAND = 0.5          # neighbours share at least this much of the smaller cross extent


def zone_role(slot):
    if slot.id.startswith("title"):
        return "제목"
    if slot.type in ("text", "list"):
        return "본문"
    return {"picture": "그림", "table": "표", "chart": "차트"}.get(slot.type, slot.type)


def zone_units(slots):
    """[(box in pt, [slots])]: overlapping or grouped shapes merged into their outline."""
    units = [([s], tuple(pt(v) for v in s.box)) for s in slots if s.box]

    def touch(a, b):
        return box_intersection(a[1], b[1]) is not None or any(
            len(x.path) > 1 and x.path[:-1] == y.path[:-1] for x in a[0] for y in b[0])

    merged = True
    while merged:
        merged = False
        for i in range(len(units)):
            for j in range(i + 1, len(units)):
                if touch(units[i], units[j]):
                    (ma, ba), (mb, bb) = units[i], units[j]
                    x0, y0 = min(ba[0], bb[0]), min(ba[1], bb[1])
                    x1 = max(ba[0] + ba[2], bb[0] + bb[2])
                    y1 = max(ba[1] + ba[3], bb[1] + bb[3])
                    units[i] = (ma + mb, (x0, y0, x1 - x0, y1 - y0))
                    del units[j]
                    merged = True
                    break
            if merged:
                break
    return [(box, members) for members, box in units]


def unit_label(members):
    if len(members) == 1:
        return "`%s`" % members[0].id
    return "외곽선(%d개 도형: %s)" % (len(members), ", ".join(m.id for m in members))


def unit_role(members):
    roles = {zone_role(m) for m in members}
    return roles.pop() if len(roles) == 1 else "외곽선"


def neighbour_gaps(units):
    """[(i, j, axis, gap_pt)]: for each unit, its nearest neighbour below ('↓') and to
    the right ('→') that shares at least ZONE_BAND of the cross extent."""
    out = []
    for i, (a, _) in enumerate(units):
        for axis, lo, ext in (("↓", 1, 3), ("→", 0, 2)):
            cl, ce = 1 - lo, 5 - ext
            best = None
            for j, (b, _) in enumerate(units):
                if i == j:
                    continue
                gap = b[lo] - (a[lo] + a[ext])
                if gap < 0:
                    continue
                shared = min(a[cl] + a[ce], b[cl] + b[ce]) - max(a[cl], b[cl])
                if shared < ZONE_BAND * min(a[ce], b[ce]):
                    continue
                if best is None or gap < best[1]:
                    best = (j, gap)
            if best:
                out.append((i, best[0], axis, best[1]))
    return out


def template_zones(pkg, parts, slide_cy):
    """{archetype: [pair]} — every neighbouring pair on every slide, with the zone the
    template's own recurring gaps give it. A pair is a dict: a, b (member slot ids),
    a_box, b_box (pt), label, axis, gap, count, zone (None = 기준 없음), borrowed, spread."""
    pairs = {}
    for idx, part in enumerate(parts, 1):
        slots = analyze_slide(ET.fromstring(pkg.parts[part]), slide_cy)
        units = zone_units(slots)
        recs = []
        for i, j, axis, gap in neighbour_gaps(units):
            (ab, am), (bb, bm) = units[i], units[j]
            recs.append({"a": [m.id for m in am], "b": [m.id for m in bm],
                         "a_box": ab, "b_box": bb, "axis": axis, "gap": gap,
                         "label": "%s %s %s" % (unit_label(am), axis, unit_label(bm)),
                         "key": (unit_role(am), unit_role(bm), axis),
                         "count": 1, "zone": None, "borrowed": False, "spread": 0.0})
        pairs["s%d" % idx] = recs
    by_key = {}
    for recs in pairs.values():
        for r in recs:
            by_key.setdefault(r["key"], []).append(r)
    for recs in by_key.values():
        recs.sort(key=lambda r: r["gap"])
        clusters, cur = [], []
        for r in recs:
            if cur and r["gap"] - cur[0]["gap"] > 2 * ZONE_TOL_PT:
                clusters.append(cur)
                cur = []
            cur.append(r)
        clusters.append(cur)
        recurring = [c for c in clusters if len(c) >= ZONE_MIN_REPEAT]
        for c in clusters:
            if len(c) >= ZONE_MIN_REPEAT:
                z = statistics.median(r["gap"] for r in c)
                for r in c:
                    r.update(count=len(c), zone=z, spread=c[-1]["gap"] - c[0]["gap"])
            elif recurring:
                near = min(recurring, key=lambda k: abs(statistics.median(
                    r["gap"] for r in k) - c[0]["gap"]))
                for r in c:
                    r.update(zone=min(r["gap"], statistics.median(x["gap"] for x in near)),
                             borrowed=True, spread=near[-1]["gap"] - near[0]["gap"])
    return pairs


def zone_cell(r):
    if r["zone"] is None:
        return "기준 없음"
    return "%.1fpt%s" % (r["zone"], " (빌림)" if r["borrowed"] else "")


def text_over_pictures(slots, min_frac=0.12):
    """[(text_slot, picture_slot, covered fraction)] for text that shares a picture's box.

    Only geometry — whether it is actually hard to read depends on the image that
    lands there, which the template does not know.
    """
    pics = [s for s in slots if s.type == "picture" and s.box]
    out = []
    for slot in slots:
        if slot.type not in ("text", "list") or not slot.box:
            continue
        for pic in pics:
            frac = covered_fraction(slot.box, pic.box)
            if frac >= min_frac:
                out.append((slot, pic, frac))
    return out


def source_window(text_box, pic_box, crop):
    """The part of the SOURCE image that ends up under a text box, as (l, t, r, b) in 0..1.

    `crop` is the a:srcRect fractions already thrown away on each side, so the window is
    measured against what survives rather than against the original file.
    """
    hit = box_intersection(text_box, pic_box)
    if not hit:
        return None
    cl, ct, cr, cb = crop
    keep_x, keep_y = 1.0 - cl - cr, 1.0 - ct - cb
    if keep_x <= 0 or keep_y <= 0 or not pic_box[2] or not pic_box[3]:
        return None
    fx0 = (hit[0] - pic_box[0]) / float(pic_box[2])
    fy0 = (hit[1] - pic_box[1]) / float(pic_box[3])
    fx1 = fx0 + hit[2] / float(pic_box[2])
    fy1 = fy0 + hit[3] / float(pic_box[3])
    return (cl + fx0 * keep_x, ct + fy0 * keep_y,
            cl + fx1 * keep_x, ct + fy1 * keep_y)


def window_contrast(rows, w, h, win, text_hex, background, threshold, samples=4000):
    """(mean colour, fraction of the area below `threshold`) under one text box.

    Pixels the image leaves transparent show the slide instead, so they are scored
    against the background rather than dropped — otherwise a knocked-out PNG would
    always look safe.
    """
    x0, y0 = int(win[0] * w), int(win[1] * h)
    x1, y1 = max(x0 + 1, int(win[2] * w)), max(y0 + 1, int(win[3] * h))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return None
    total = (x1 - x0) * (y1 - y0)
    step = max(1, int((total / float(samples)) ** 0.5))
    acc, n, bad = [0, 0, 0], 0, 0
    for y in range(y0, y1, step):
        row = rows[y]
        for x in range(x0, x1, step):
            px = row[x]
            here = background if px[3] < 16 else "%02X%02X%02X" % px[:3]
            if here is None:
                continue
            for i in range(3):
                acc[i] += rgb(here)[i]
            n += 1
            if contrast_ratio(here, text_hex) < threshold:
                bad += 1
    if not n:
        return None
    return "%02X%02X%02X" % tuple(round(v / n) for v in acc), bad / float(n)


def legibility_threshold(size_pt):
    """WCAG: 3:1 is enough for large text, 4.5:1 for body."""
    return 3.0 if (size_pt or 18.0) >= 18.0 else 4.5


def slide_background(pkg, slide_part):
    """The solid color behind a slide, following slide -> layout -> master."""
    def bg_of(part):
        if part not in pkg.parts:
            return None
        bg = ET.fromstring(pkg.parts[part]).find(q("p:cSld") + "/" + q("p:bg"))
        if bg is None:
            return None
        srgb = bg.find(".//" + q("a:srgbClr"))
        return srgb.get("val").upper() if srgb is not None else None

    here = bg_of(slide_part)
    if here:
        return here
    chain = [slide_part]
    for rel_type in ("/slideLayout", "/slideMaster"):
        rn = rels_name(chain[-1])
        if rn not in pkg.parts:
            break
        nxt = None
        for rel in ET.fromstring(pkg.parts[rn]):
            if rel.get("Type", "").endswith(rel_type):
                nxt = "ppt/" + rel.get("Target").replace("../", "")
        if not nxt:
            break
        chain.append(nxt)
        found = bg_of(nxt)
        if found:
            return found
    return None


# ── SVG assets ───────────────────────────────────────────────────────────────

def svg_aspect(path):
    """Width/height of an SVG from its own attributes; None when it declares neither."""
    head = Path(path).read_text(encoding="utf-8", errors="replace")[:4000]
    w = re.search(r'\bwidth="([\d.]+)', head)
    h = re.search(r'\bheight="([\d.]+)', head)
    if w and h and float(h.group(1)):
        return float(w.group(1)) / float(h.group(1))
    vb = re.search(r'viewBox="\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)', head)
    if vb and float(vb.group(2)):
        return float(vb.group(1)) / float(vb.group(2))
    return None


def rasterize_svg(src, frame_cx, cache_dir, renderer, dpi=200):
    """SVG source -> PNG, sized for the frame it goes into and cached by content.

    Generated art is source too, so the same .svg must always produce the same bytes:
    the cache is keyed on the file's content and the target size, and LibreOffice's PNG
    export is itself byte-stable, so a cold cache reproduces a warm one.
    """
    data = Path(src).read_bytes()
    width = int(min(4000, max(400, (frame_cx or 5000000) / 914400 * dpi)))
    aspect = svg_aspect(src) or 16 / 9
    height = max(1, int(round(width / aspect)))
    key = hashlib.sha256(data + b"|%dx%d" % (width, height)).hexdigest()[:16]
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / ("%s.png" % key)
    if out.is_file():
        return out, False
    (cache_dir / ("%s.svg" % key)).write_bytes(data)
    opts = ('{"PixelWidth":{"type":"long","value":%d},'
            '"PixelHeight":{"type":"long","value":%d}}' % (width, height))
    r = renderer.sh(cache_dir,
                    "export HOME=/tmp/lohome; mkdir -p $HOME; "
                    "soffice --headless -env:UserInstallation=file:///tmp/loprof "
                    "--convert-to 'png:draw_png_Export:%s' --outdir . %s.svg 2>&1 | tail -2; "
                    "chmod -R a+rwX . 2>/dev/null || true" % (opts, key))
    (cache_dir / ("%s.svg" % key)).unlink(missing_ok=True)
    if not out.is_file():
        hint = ""
        if not renderer.local:
            hint = ("\n  the renderer runs in a container, and its daemon has to be able to "
                    "bind-mount\n  %s — a snap or rootless docker cannot see /tmp. Keep the "
                    "deck under your home\n  directory, or install LibreOffice locally."
                    % cache_dir)
        raise SystemExit("error: could not rasterize %s\n  %s%s"
                         % (src, (r.stdout + r.stderr).strip(), hint))
    return out, True


# What may be embedded. Vector formats are deliberately absent: a slide has to render
# the same in PowerPoint, Keynote, Google Slides and a PDF export, and SVG does not —
# so an .svg source is rasterized on the way in and the package only ever carries raster.
IMAGE_CT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".bmp": "image/bmp",
    ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff",
}
VECTOR_EXT = {".svg", ".svgz", ".emf", ".wmf", ".eps", ".pdf", ".ai"}
RASTERIZABLE = {".svg"}
# Renders everywhere. The rest embed, but old PowerPoint may show nothing.
UNIVERSAL_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# ── Speaker notes ────────────────────────────────────────────────────────────

_NS_DECL = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="%s" '
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' % NS["r"])

BLANK_NOTES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<p:notes %s><p:cSld><p:spTree>'
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>'
    '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
    '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>'
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/>'
    '<a:t></a:t></a:r></a:p></p:txBody></p:sp>'
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>' % _NS_DECL)

BLANK_NOTESMASTER = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<p:notesMaster %s><p:cSld><p:bg><p:bgPr>'
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    '<p:grpSpPr/>'
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>'
    '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
    '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>'
    '<p:spPr><a:xfrm><a:off x="1143000" y="685800"/><a:ext cx="4572000" cy="3429000"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>'
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>'
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>'
    '</p:sp></p:spTree></p:cSld>'
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
    'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" '
    'folHlink="folHlink"/><p:notesStyle/></p:notesMaster>' % _NS_DECL)


def notes_body(root):
    """The notes placeholder inside a notesSlide, or None."""
    for sp in root.iter(q("p:sp")):
        nv = sp.find(q("p:nvSpPr"))
        if nv is None:
            continue
        nvPr = nv.find(q("p:nvPr"))
        ph = nvPr.find(q("p:ph")) if nvPr is not None else None
        if ph is not None and ph.get("type") == "body":
            return sp.find(q("p:txBody"))
    return None


def ensure_notes_master(pkg):
    """Return the notesMaster part name, creating a plain one when the template has none.

    A notesMaster is scaffolding, not design — it never shows on a slide — so synthesising
    one does not put the engine in the business of inventing a look.
    """
    existing = sorted(n for n in pkg.parts if n.startswith("ppt/notesMasters/notesMaster"))
    if existing:
        return existing[0], False
    part = "ppt/notesMasters/notesMaster1.xml"
    pkg.parts[part] = BLANK_NOTESMASTER.encode("utf-8")
    themes = sorted(n for n in pkg.parts if n.startswith("ppt/theme/theme"))
    pkg.parts[rels_name(part)] = ET.tostring(
        _rels_root([("rId1", REL_THEME, "../" + themes[0].split("ppt/")[1])] if themes else []),
        encoding="UTF-8", xml_declaration=True)

    pres = pkg.xml("ppt/presentation.xml")
    prels = pkg.xml(rels_name("ppt/presentation.xml"))
    used = {int(re.sub(r"\D", "", r.get("Id")) or 0) for r in prels}
    rid = "rId%d" % ((max(used) if used else 0) + 1)
    rel = ET.SubElement(prels, q("pr:Relationship"))
    rel.set("Id", rid)
    rel.set("Type", REL_NOTESMASTER)
    rel.set("Target", "notesMasters/notesMaster1.xml")
    lst = ET.Element(q("p:notesMasterIdLst"))
    nid = ET.SubElement(lst, q("p:notesMasterId"))
    nid.set(q("r:id"), rid)
    anchor = pres.find(q("p:sldMasterIdLst"))
    pres.insert(list(pres).index(anchor) + 1 if anchor is not None else 0, lst)
    pkg.set_xml("ppt/presentation.xml", pres)
    pkg.set_xml(rels_name("ppt/presentation.xml"), prels)
    return part, True


def _rels_root(items):
    root = ET.Element(q("pr:Relationships"))
    for rid, rtype, target in items:
        el = ET.SubElement(root, q("pr:Relationship"))
        el.set("Id", rid)
        el.set("Type", rtype)
        el.set("Target", target)
    return root


REL_THEME = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"


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


THEME_SLOTS = ("dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
               "accent4", "accent5", "accent6")


def template_palette(pkg, slide_parts):
    """The template's own colors — theme slots, plus what the slides actually use.

    Generated art has to be written in the reference's colors, not in colors that
    merely look similar, so the catalog hands them over explicitly.
    """
    theme = []
    for name in sorted(n for n in pkg.parts if n.startswith("ppt/theme/theme")):
        scheme = ET.fromstring(pkg.parts[name]).find(
            ".//" + q("a:clrScheme"))
        if scheme is None:
            continue
        for slot in THEME_SLOTS:
            el = scheme.find(q("a:" + slot))
            if el is None:
                continue
            srgb = el.find(q("a:srgbClr"))
            sys_ = el.find(q("a:sysClr"))
            val = (srgb.get("val") if srgb is not None
                   else sys_.get("lastClr") if sys_ is not None else None)
            if val:
                theme.append((slot, val.upper()))
        break
    counts = {}
    for part in slide_parts:
        for hexv in re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', pkg.parts[part].decode()):
            counts[hexv.upper()] = counts.get(hexv.upper(), 0) + 1
    used = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    return theme, used


def template_signature(pkg, slide_parts, slide_cy=None):
    """A hash of what deck.mdx actually depends on: the archetypes and their slots.

    Editing the template's own words must not trip this, or nobody will trust it;
    inserting, deleting or reordering a slide must, because then `@s3` silently means
    a different slide and the deck rots without a single error.
    """
    sig = []
    for n, part in enumerate(slide_parts, 1):
        slots = analyze_slide(ET.fromstring(pkg.parts[part]), slide_cy)
        sig.append("s%d:%s" % (n, ",".join("%s=%s" % (s.id, s.type) for s in slots)))
    blob = "|".join(sig).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:12]


def verify_signature(front, pkg, slide_parts, slide_cy, errs):
    declared = front.get("template_hash")
    if not declared:
        return
    actual = template_signature(pkg, slide_parts, slide_cy)
    if declared == actual:
        return
    errs.append(
        "the template no longer matches this deck: front matter says template_hash %s, "
        "the template is %s. Slides were added, removed or reordered, so `@sN` now points "
        "somewhere else. Re-run catalog, check every archetype this deck uses, then update "
        "template_hash." % (declared, actual))


def template_typography(pkg, slide_parts):
    """The template's type: theme fonts, and the sizes the slides actually set.

    Art generated for a picture slot has to sit in the same type system as the text
    beside it, so the catalog hands over the families and the real pt sizes rather
    than leaving a model to guess at "looks about right".
    """
    theme = {}
    for name in sorted(n for n in pkg.parts if n.startswith("ppt/theme/theme")):
        scheme = ET.fromstring(pkg.parts[name]).find(".//" + q("a:fontScheme"))
        if scheme is None:
            continue
        for role, tag in (("major", "a:majorFont"), ("minor", "a:minorFont")):
            font = scheme.find(q(tag))
            if font is None:
                continue
            latin = font.find(q("a:latin"))
            ea = font.find(q("a:ea"))
            theme[role] = (latin.get("typeface") if latin is not None else "",
                           ea.get("typeface") if ea is not None else "")
        break

    sizes, faces = {}, {}
    for part in slide_parts:
        root = ET.fromstring(pkg.parts[part])
        for sp in root.iter(q("p:sp")):
            txBody = sp.find(q("p:txBody"))
            if txBody is None or _is_autofield(txBody):
                continue
            text = "".join(para_text(x) for x in txBody.findall(q("a:p"))).strip()
            if not text:
                continue
            size = first_font_size(txBody)
            if size:
                sizes[size] = sizes.get(size, 0) + 1
            for latin in txBody.iter(q("a:latin")):
                if latin.get("typeface"):
                    faces[latin.get("typeface")] = faces.get(latin.get("typeface"), 0) + 1
                break
    return theme, sorted(sizes.items(), key=lambda kv: -kv[0]), \
        sorted(faces.items(), key=lambda kv: -kv[1])


def pt(emu):
    return emu / EMU_PER_PT


def slot_budget(slot):
    """(서체, 예산) cells for the catalog: what the slot is set in and how much fits.
    Measured when the font file was found; otherwise the em model, and it says 추정."""
    size = "%gpt" % round(slot.eff_size, 1)
    face = slot.font.label if slot.font else (slot.face or "상속")
    if slot.estimated:
        face += " (추정)"
    face = "%s %s" % (face, size)
    if not slot.max_em:
        return face, "프레임 상속 — 폭을 알 수 없음"
    n = slot.max_chars
    if slot.wrap == "none":
        text = "1줄 %d자 (줄바꿈 없음 — 넘치면 프레임 밖으로)" % n
    else:
        usable = (slot.box[3] / EMU_PER_PT - slot.insets[1] - slot.insets[3]) if slot.box else 0
        rows = max(1, int(usable / (slot.line_h / EMU_PER_PT))) if usable else None
        if rows is None:
            text = "한 줄 %d자 (높이는 상속)" % n
        elif rows == 1:
            text = "한 줄 %d자, 1줄 (넘치면 겹침)" % n
        else:
            text = "한 줄 %d자 × 최대 %d줄" % (n, rows)
    if slot.estimated:
        text = "추정 · " + text
    return face, text


_FOOT = re.compile(r"^\s*(\*+|※|[†‡]|\[\d+\]|\(\d+\)|\d+[.)])\s*\S")


def slide_sentences(pkg, slide_parts):
    """Paragraphs of 10+ chars on the slides (text boxes and table cells); shorter
    ones are labels and headers, not sentences."""
    out = []
    for part in slide_parts:
        for p in ET.fromstring(pkg.parts[part]).iter(q("a:p")):
            t = para_text(p).strip()
            if len(t) >= 10:
                out.append(t)
    return out


def sentence_ending(s):
    s = re.sub(r"[\s.!?)\]…]+$", "", s)
    if s.endswith("했습니다"):
        return "했습니다"
    if s.endswith("다"):
        return "other -다"
    if s.endswith("요"):
        return "-요"
    return "noun-final"


def voice_fingerprint(sentences):
    """Measured, never declared: how the reference's own sentences read."""
    n = len(sentences)
    if not n:
        return None
    ends = {}
    for s in sentences:
        k = sentence_ending(s)
        ends[k] = ends.get(k, 0) + 1
    lens = sorted(len(s) for s in sentences)
    quant = [lens[min(n - 1, int(n * f))] for f in (0.25, 0.5, 0.75)]

    def pct(c):
        return 100.0 * c / n

    marks = {}
    for s in sentences:
        m = _FOOT.match(s)
        if m:
            k = "digit" if m.group(1)[0].isdigit() or m.group(1)[0] in "[(" else m.group(1)
            marks[k] = marks.get(k, 0) + 1
    return {
        "n": n,
        "endings": sorted(((k, pct(v)) for k, v in ends.items()), key=lambda kv: -kv[1]),
        "length": quant,
        "english": pct(sum(1 for s in sentences if re.search(r"[A-Za-z]{3,}", s))),
        "digits": pct(sum(1 for s in sentences if re.search(r"\d", s))),
        "footnote": sorted(marks.items(), key=lambda kv: -kv[1]),
    }


def voice_lines(v):
    lines = ["## Voice", "",
             "Measured from the reference's own %d sentences. Write new text in this voice: "
             "same endings, same length, same share of English terms and figures." % v["n"],
             "",
             "- Endings: " + " · ".join("%s %.0f%%" % kv for kv in v["endings"]),
             "- Length (chars) p25 / p50 / p75: %d / %d / %d" % tuple(v["length"]),
             "- Sentences with an English term: %.0f%%" % v["english"],
             "- Sentences with a digit: %.0f%%" % v["digits"]]
    if v["footnote"]:
        lines.append("- Footnotes: " + ", ".join("`%s` (%d)" % kv for kv in v["footnote"]))
    else:
        lines.append("- Footnotes: none in the template")
    return lines + [""]


def cmd_catalog(args):
    require_template(args.template)
    pkg = Package(args.template)
    parts = slide_order(pkg)
    slide_cy = slide_size(pkg)[1]
    lines = [
        "# Deck catalog — %s" % Path(args.template).name,
        "",
        "%d archetypes. In `deck.mdx`, start a slide with `## @<archetype>` and set slots by id."
        % len(parts),
        "Slots you leave out keep the template's own content. `slot: !drop` removes the shape.",
        "`notes:` works on any slide and becomes that slide's speaker notes.",
        "",
        "Save the source as `deck%s` beside the template and start it with:" % DECK_EXT,
        "",
        "```",
        "---",
        "template: %s" % args.template,
        "template_hash: %s" % template_signature(pkg, parts, slide_cy),
        "---",
        "```",
        "",
        "Everything the build produces lands in `%s/` next to it — pptx, pdf, page "
        "previews and the cache. That directory is regenerated in full, so delete it "
        "freely and never edit anything inside it. `output:` in the front matter "
        "overrides the location if you need it somewhere else." % BUILD_DIR,
        "",
    ]
    theme, used = template_palette(pkg, parts)
    if theme or used:
        lines += ["## Palette", "",
                  "Art you generate for a picture slot must be written in these colors — "
                  "the reference supplies the design, the generated source supplies only "
                  "the content.", ""]
        if theme:
            lines.append("| theme slot | hex |")
            lines.append("|---|---|")
            lines += ["| `%s` | `#%s` |" % (k, v) for k, v in theme]
            lines.append("")
        if used:
            lines.append("Most used in the slides themselves: "
                         + ", ".join("`#%s` (%d)" % (k, n) for k, n in used))
            lines.append("")

    theme_fonts, sizes, faces = template_typography(pkg, parts)
    if theme_fonts or sizes or faces:
        cx, cy = slide_size(pkg)
        lines += ["## Type", "",
                  "The slide canvas is **%.0f × %.0f pt**. Author SVG art at its frame's pt "
                  "size (given per picture slot below) and `font-size` in the SVG is the same "
                  "number as a pt size here — the art then sits in the deck's own type scale "
                  "instead of near it." % (pt(cx), pt(cy)), ""]
        if theme_fonts:
            lines.append("| theme font | latin | east asian |")
            lines.append("|---|---|---|")
            for role, (latin, ea) in theme_fonts.items():
                lines.append("| `%s` | %s | %s |" % (role, latin or "—", ea or "—"))
            lines.append("")
        if faces:
            lines.append("Typefaces set on the slides: "
                         + ", ".join("%s (%d)" % (k, n) for k, n in faces))
        if sizes:
            lines.append("Sizes in use, largest first: "
                         + ", ".join("**%gpt** (%d)" % (k, n) for k, n in sizes))
        lines.append("")
    voice = voice_fingerprint(slide_sentences(pkg, parts))
    if voice:
        lines += voice_lines(voice)
    zones = template_zones(pkg, parts, slide_cy)
    for idx, part in enumerate(parts, 1):
        slots = analyze_slide(ET.fromstring(pkg.parts[part]), slide_cy)
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
                if s.size_pt:
                    cap = "%gpt · %s" % (s.size_pt, cap)
            elif s.type == "list":
                shows = "%d items · %s" % (s.max_items, truncate(s.sample[0] if s.sample else "", 28))
                cap = "~%d chars/line" % s.max_chars if s.max_chars else "inherited"
                if s.size_pt:
                    cap = "%gpt · %s" % (s.size_pt, cap)
                if s.fits:
                    cap += ", %d lines before the slide edge" % s.fits
            elif s.type == "table":
                shows = "%d rows × %d cols" % (s.max_items, s.cols or 0)
                cap = ("%d rows before the slide edge" % s.fits) if s.fits \
                    else "header row kept"
            elif s.type == "picture":
                shows = s.label or "picture"
                cap = ratio_label(s.ratio)
                if s.frame_pt:
                    cap += " · author at %.0f×%.0f pt" % s.frame_pt
            else:
                shows = s.label or "chart"
                cap = "not writable"
            lines.append("| `%s` | %s | %s | %s |" % (s.id, s.type, shows, cap))
        texty = [s for s in slots if s.type in ("text", "list")]
        if texty:
            lines += ["", "| slot | 서체 | 예산 |", "|---|---|---|"]
            for s in texty:
                face, budget = slot_budget(s)
                lines.append("| `%s` | %s | %s |" % (s.id, face, budget))
            styled = [s for s in texty if s.has_br or any(len(f) > 1 for _, f in s.para_formats)]
            if styled:
                lines += ["", "문단 안 서식 — `[텍스트]{n}`으로 n번 서식, `<br>`로 줄바꿈:"]
                for s in styled:
                    for k, (_, fmts) in enumerate(s.para_formats, 1):
                        if len(fmts) > 1:
                            lines.append("- `%s` 문단 %d: 서식: %s" % (s.id, k, " · ".join(
                                "%d = %s" % (n, f) for n, f in enumerate(fmts, 1))))
                    if s.has_br:
                        lines.append("- `%s`: 템플릿이 문단 안에서 `<br>`로 줄을 바꿉니다" % s.id)
        if zones.get("s%d" % idx):
            lines += ["", "| 도형 쌍 | 템플릿 간격(pt) | 반복 횟수 | 임계 |", "|---|---|---|---|"]
            for r in zones["s%d" % idx]:
                lines.append("| %s | %.1f | %d | %s |"
                             % (r["label"], r["gap"], r["count"], zone_cell(r)))
        lines += ["", "```markdown", stub_for("s%d" % idx, slots, title), "```", ""]
    text = "\n".join(lines) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print("catalog -> %s  (%d archetypes)" % (args.output, len(parts)))
    else:
        sys.stdout.write(text)
    return 0


# ── Extract: a template's own content as deck.mdx ────────────────────────────

def _escape_chars(text):
    for ch in "*`[]":
        text = text.replace(ch, "\\" + ch)
    return text


def _escape(text):
    text = _escape_chars(text)
    if not text.strip(" "):
        return "\\ " * len(text)
    lead = len(text) - len(text.lstrip(" "))
    trail = len(text) - len(text.rstrip(" ")) if text.strip() else 0
    core = text.strip(" ") if text.strip() else text
    return "\\ " * lead + core + "\\ " * trail


def para_markup(p):
    """One paragraph as mdx: runs grouped by format (`[..]{n}`), `<br>`, escapes."""
    looks = [run_look(r) for r in run_formats(p)]
    groups = []
    for el in p:
        if el.tag == q("a:r"):
            n = looks.index(run_look(el)) + 1
            t = el.find(q("a:t"))
            t = t.text or "" if t is not None else ""
            if groups and groups[-1][0] == n:
                groups[-1] = (n, groups[-1][1] + t)
            else:
                groups.append((n, t))
        elif el.tag == q("a:br"):
            groups.append((0, None))
    out = []
    for i, (n, t) in enumerate(groups):
        if n == 0:
            out.append("<br>")
            continue
        # Spaces only matter at the value's edges, where the parser trims them.
        edge = i == 0 or i == len(groups) - 1
        body = _escape(t) if edge else _escape_chars(t)
        out.append(body if n == 1 or not t else "[%s]{%d}" % (body, n))
    return "".join(out)


def extract_lines(pkg, parts, slide_cy):
    out = []
    for idx, part in enumerate(parts, 1):
        root = ET.fromstring(pkg.parts[part])
        spTree = root.find(q("p:cSld") + "/" + q("p:spTree"))
        out.append("## @s%d" % idx)
        for s in analyze_slide(root, slide_cy):
            el = resolve_path(spTree, s.path)
            if s.type in ("text", "list"):
                paras = el.find(q("p:txBody")).findall(q("a:p"))
                if not any(para_text(p).strip() for p in paras):
                    continue
                if len(paras) == 1:
                    out.append("%s: %s" % (s.id, para_markup(paras[0])))
                else:
                    out.append("%s:" % s.id)
                    out += ["  " + "  " * para_level(p) + "- " + para_markup(p) for p in paras]
            elif s.type == "table":
                out.append("%s:" % s.id)
                for tr in el.iter(q("a:tr")):
                    cells = [" ".join(para_markup(p) for p in tc.iter(q("a:p"))).replace("|", "/")
                             for tc in tr.findall(q("a:tc"))]
                    out.append("  | %s |" % " | ".join(c or " " for c in cells))
        out.append("")
    return out


def cmd_extract(args):
    require_template(args.template)
    pkg = Package(args.template)
    parts = slide_order(pkg)
    slide_cy = slide_size(pkg)[1]
    text = "\n".join(["---", "template: %s" % args.template,
                      "template_hash: %s" % template_signature(pkg, parts, slide_cy), "---", ""]
                     + extract_lines(pkg, parts, slide_cy))
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print("extract -> %s  (%d slides, the template's own content)" % (args.output, len(parts)))
    else:
        sys.stdout.write(text)
    return 0


def template_values(pkg, parts, slide_cy):
    """{(archetype, slot id): (kind, value)} — the template's own content, parsed the way a
    deck value is, so a deck slot can be compared with it."""
    _, specs, _ = parse_deck("\n".join(extract_lines(pkg, parts, slide_cy)))
    return {(s.archetype, sid): (kind, value) for s in specs for sid, kind, value, _ in s.values}


# ── Applying values ──────────────────────────────────────────────────────────

def as_items(kind, value):
    if kind == "list":
        return value
    if kind == "table":
        return [(0, " ".join(r)) for r in value]
    text = value or ""
    return [(0, line) for line in text.split("\n")]


def seen_items(kind, value):
    """as_items as a reader sees them, for measuring: markup gone, each `<br>` a new line."""
    return [(lvl, piece) for lvl, t in as_items(kind, value)
            for piece in plain_text(t).split("\n")]


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


# ── Sibling cloning ──────────────────────────────────────────────────────────
#
# `textN_plusK` asks for the K-th shape past the last of a row (or column) of
# same-format siblings. The position is the interval the template already uses —
# never a free placement. Anything that is not a clean series is refused with the reason.

CLONE_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*?)_plus([1-9]\d*)")
SIBLING_MIN = 3        # two shapes prove no interval
SIBLING_TOL = 0.03     # spacing may wobble this much of the interval
ALIGN_TOL = 2000       # EMU: siblings share the cross coordinate within this
GROUP_TOL = 0.10       # row groups: every gap within this of the last one


def _sibling_format(el, slot):
    rpr = next(iter(el.find(q("p:txBody")).iter(q("a:rPr"))), None)
    latin = rpr.find(q("a:latin")) if rpr is not None else None
    return (slot.type, slot.max_items, slot.size_pt, slot.color_ref,
            latin.get("typeface") if latin is not None else None,
            rpr.get("b") if rpr is not None else None, slot.box[3])


def _plan_shape_clone(spTree, slots, key, slide_dims):
    """Clone the shape `key` names ('textN_plusK') into spTree and register its Slot.

    Returns (slot, None) or (None, reason)."""
    m = CLONE_RE.fullmatch(key)
    if not m:
        return None, None
    base_id, k = m.group(1), int(m.group(2))
    base = slots.get(base_id)
    if base is None or base.type not in ("text", "list") or not base.box:
        return None, "'%s' is not a text shape with a position, so it cannot be cloned" % base_id
    parent_path = base.path[:-1]
    parent = resolve_path(spTree, parent_path)
    peers = [s for s in slots.values() if s.type in ("text", "list") and s.box
             and s.path[:-1] == parent_path and not CLONE_RE.fullmatch(s.id)]
    sigs = {s.id: _sibling_format(resolve_path(spTree, s.path), s) for s in peers}
    best = None
    for axis, cross in ((1, 0), (0, 1)):          # stacked down, then side by side
        line = sorted((s for s in peers if abs(s.box[cross] - base.box[cross]) <= ALIGN_TOL),
                      key=lambda s: s.box[axis])
        if len(line) >= 2 and (best is None or len(line) > len(best[1])):
            best = (axis, line)
    if best is None:
        return None, ("'%s' has no sibling aligned with it, so there is no interval to extend "
                      "(shapes inside different groups are not siblings)" % base_id)
    axis, line = best
    same = [s for s in line if sigs[s.id] == sigs[base_id]]
    if len(same) < SIBLING_MIN:
        if len(line) >= SIBLING_MIN:
            return None, ("'%s' has aligned siblings (%s) that differ in format — size, colour, "
                          "font, weight or height — so they are not a series"
                          % (base_id, ", ".join(s.id for s in line)))
        return None, ("cloning needs at least %d same-format siblings at one interval; "
                      "'%s' has %d" % (SIBLING_MIN, base_id, len(same)))
    pos = [s.box[axis] for s in same]
    gaps = [b - a for a, b in zip(pos, pos[1:])]
    interval = sum(gaps) / len(gaps)
    if min(gaps) <= 0 or max(gaps) - min(gaps) > max(ALIGN_TOL, SIBLING_TOL * interval):
        return None, ("the spacing of %s is not constant (gaps %s EMU), so a clone has no "
                      "position the template vouches for"
                      % (", ".join(s.id for s in same), ", ".join(str(g) for g in gaps)))
    last = same[-1]
    if base_id != last.id:
        return None, "'%s' is not the last of its row; clone from '%s_plus%d'" % (base_id, last.id, k)
    box = list(last.box)
    box[axis] = last.box[axis] + int(round(k * interval))
    if parent is spTree and (box[0] + box[2] > slide_dims[0] or box[1] + box[3] > slide_dims[1]):
        return None, "'%s' would fall outside the slide" % key
    el = copy.deepcopy(resolve_path(spTree, last.path))
    el.find(q("p:spPr") + "/" + q("a:xfrm") + "/" + q("a:off")).attrib.update(
        x=str(box[0]), y=str(box[1]))
    cnv = el.find(q("p:nvSpPr") + "/" + q("p:cNvPr"))
    cnv.set("id", str(1 + max(int(c.get("id", 0)) for c in spTree.iter(q("p:cNvPr")))))
    cnv.set("name", "%s clone %d" % (cnv.get("name", ""), k))
    parent.append(el)
    clone = copy.copy(last)
    clone.id, clone.path, clone.box = key, parent_path + [len(list(parent)) - 1], tuple(box)
    clone.off_y, clone.z = box[1], 1 + max(s.z for s in slots.values())
    slots[key] = clone
    return clone, None


def _group_format(g):
    sig = []
    for c in g:
        if c.tag not in (q("p:sp"), q("p:pic"), q("p:graphicFrame"), q("p:grpSp")):
            continue
        tx = c.find(q("p:txBody"))
        rpr = next(iter(tx.iter(q("a:rPr"))), None) if tx is not None else None
        sig.append((c.tag, first_font_size(tx) if tx is not None else None,
                    text_color_ref(tx) if tx is not None else None,
                    rpr.get("b") if rpr is not None else None))
    return tuple(sig)


def _group_xfrm(g):
    return g.find(q("p:grpSpPr") + "/" + q("a:xfrm"))


def _is_clone(g):
    c = g.find(q("p:nvGrpSpPr") + "/" + q("p:cNvPr"))
    return c is not None and " clone " in (c.get("name") or "")


def _plan_group_clone(spTree, slots, key, slide_dims):
    """Clone the whole row group holding `textN` (key 'textN_plusK') at the last interval."""
    base_id, k = CLONE_RE.fullmatch(key).group(1), int(CLONE_RE.fullmatch(key).group(2))
    base = slots[base_id]
    group_path = base.path[:-1]
    group = resolve_path(spTree, group_path)
    holder_path = group_path[:-1]
    holder = resolve_path(spTree, holder_path)
    if group.tag != q("p:grpSp") or _group_xfrm(group) is None:
        return None, "'%s' is not inside a row group" % base_id
    rows = [(i, c) for i, c in enumerate(list(holder))
            if c.tag == q("p:grpSp") and _group_xfrm(c) is not None and not _is_clone(c)]

    def at(c, part):
        a = _group_xfrm(c).find(q("a:" + part))
        return (int(a.get("x" if part == "off" else "cx", 0)),
                int(a.get("y" if part == "off" else "cy", 0)))

    gx = at(group, "off")
    best = None
    for axis, cross in ((1, 0), (0, 1)):
        line = sorted((r for r in rows if abs(at(r[1], "off")[cross] - gx[cross]) <= ALIGN_TOL),
                      key=lambda r: at(r[1], "off")[axis])
        if len(line) >= 2 and (best is None or len(line) > len(best[1])):
            best = (axis, line)
    if best is None:
        return None, "its group has no aligned sibling group, so there is no row interval to extend"
    axis, line = best
    last_i, last_g = line[-1]
    tail = [r for r in reversed(line)]
    run = []
    for r in tail:
        if _group_format(r[1]) != _group_format(last_g):
            break
        run.append(r)
    run.reverse()
    if len(run) < 2:
        return None, ("the last row group differs in format from the one before it (text size, "
                      "colour, weight or shapes), so the rows are not a series")
    pos = [at(r[1], "off")[axis] for r in run]
    gaps = [b - a for a, b in zip(pos, pos[1:])]
    step = gaps[-1]
    if step <= 0 or any(abs(g - step) > GROUP_TOL * step for g in gaps):
        return None, ("the row spacing is irregular (gaps %s EMU), so a clone has no position "
                      "the template vouches for" % ", ".join(str(g) for g in gaps))
    last_path = holder_path + [last_i]
    if group is not last_g:
        rel = base.path[len(group_path):]
        twin = next((s for s in slots.values() if s.path == last_path + rel
                     and not CLONE_RE.fullmatch(s.id)), None)
        return None, ("its row is not the last one; clone from '%s_plus%d'"
                      % (twin.id if twin else "a slot in the last row", k))
    off, ext = at(last_g, "off"), at(last_g, "ext")
    delta = k * step
    new_off = list(off)
    new_off[axis] += delta
    if holder is spTree and (new_off[0] + ext[0] > slide_dims[0]
                             or new_off[1] + ext[1] > slide_dims[1]):
        return None, "'%s' would fall outside the slide" % key
    el = copy.deepcopy(last_g)
    _group_xfrm(el).find(q("a:off")).attrib.update(x=str(new_off[0]), y=str(new_off[1]))
    nxt = max(int(c.get("id", 0)) for c in spTree.iter(q("p:cNvPr")))
    for c in el.iter(q("p:cNvPr")):
        nxt += 1
        c.set("id", str(nxt))
    el.find(q("p:nvGrpSpPr") + "/" + q("p:cNvPr")).set(
        "name", "%s clone %d" % (el.find(q("p:nvGrpSpPr") + "/" + q("p:cNvPr")).get("name", ""), k))
    holder.append(el)
    new_path = holder_path + [len(list(holder)) - 1]
    top = max(s.z for s in slots.values())
    for s in [s for s in slots.values() if s.path[:len(last_path)] == last_path
              and not CLONE_RE.fullmatch(s.id)]:
        ns = copy.copy(s)
        ns.id, ns.path, ns.z = "%s_plus%d" % (s.id, k), new_path + s.path[len(last_path):], top + 1
        if s.box:
            b = list(s.box)
            b[axis] += delta
            ns.box = tuple(b)
            ns.off_y = b[1]
        top += 1
        slots.setdefault(ns.id, ns)
    return slots.get(key), None


def plan_clone(spTree, slots, key, slide_dims):
    """Clone for `key` ('textN_plusK'): the shape itself, else the row group that holds it.

    Returns (slot, None) or (None, reason); (None, None) when `key` is not a clone key."""
    if not CLONE_RE.fullmatch(key):
        return None, None
    got, why = _plan_shape_clone(spTree, slots, key, slide_dims)
    if got is not None:
        return got, None
    base = slots.get(CLONE_RE.fullmatch(key).group(1))
    if base is not None and len(base.path) >= 2:
        got, gwhy = _plan_group_clone(spTree, slots, key, slide_dims)
        if got is not None:
            return got, None
        return None, gwhy if "no sibling aligned" in (why or "") else "%s; as a row group: %s" % (why, gwhy)
    return None, why


def slot_frame_cx(el):
    ext = extent(el)
    return ext[0] if ext else None


def effective_dpi(px, emu):
    """How many pixels the image actually has per inch of slide."""
    if not px or not emu:
        return None
    return px / (emu / 914400)


def _swap_picture(el, raw_value, imgctx, problems, where, slot):
    path, mode, anchor, flags = parse_picture_value(raw_value)
    if mode is None:
        problems.append("%s: slot '%s' — unknown picture option %r. Use one of %s, "
                        "optionally with %s." % (where, slot.id, anchor,
                                                 "/".join(FIT_MODES), "/".join(ANCHORS)))
        return
    src = (imgctx["base"] / path).resolve() if not Path(path).is_absolute() else Path(path)
    if not src.is_file():
        problems.append("%s: image not found: %s" % (where, src))
        return
    if src.suffix.lower() in RASTERIZABLE:
        r = imgctx["renderer"]
        if not r.available:
            problems.append("%s: slot '%s' points at an SVG (%s) but there is no renderer to "
                            "turn it into a picture — install LibreOffice (soffice on PATH) "
                            "or set DECK_RENDER_DOCKER=<image>" % (where, slot.id, src.name))
            return
        src, fresh = rasterize_svg(src, slot_frame_cx(el), imgctx["cache"], r)
        if fresh:
            imgctx["rasterized"] += 1
        if src.read_bytes()[:8] != PNG_MAGIC:
            problems.append("%s: the renderer did not return a PNG for %s"
                            % (where, slot.id))
            return
    if "transparent" in flags:
        if src.suffix.lower() != ".png":
            problems.append("%s: slot '%s' — `transparent` needs a PNG; %s cannot be "
                            "decoded here. Convert it first."
                            % (where, slot.id, src.name))
            return
        knocked, why = make_transparent(src, imgctx["cache"])
        if knocked is None:
            problems.append("%s: slot '%s' — %s" % (where, slot.id, why))
        else:
            src = knocked
            imgctx["knocked"] += 1
    ext = src.suffix.lower()
    if ext in VECTOR_EXT:
        problems.append("%s: %s is a vector file, and a deck has to look the same in "
                        "PowerPoint, Keynote and a PDF export. Only .svg can be converted "
                        "on the way in — export this to PNG first." % (where, src.name))
        return
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
    if fill is None:
        return
    for old in fill.findall(q("a:srcRect")):
        fill.remove(old)
    size = image_size(src)
    src_ratio = size[0] / size[1] if size and size[1] else None
    ext, off = extent(el), offset(el)
    frame_ratio = (ext[0] / ext[1]) if ext and ext[1] else slot.ratio

    if mode == "stretch" or src_ratio is None:
        return
    if mode == "fit":
        fitted = fit_frame(off, ext, src_ratio)
        if fitted is None:
            problems.append("%s: slot '%s' inherits its position from the layout, so `fit` "
                            "has no box to fit inside — falling back to fill"
                            % (where, slot.id))
        else:
            set_frame(el, *fitted)
            return
    rect, lost = crop_rect(src_ratio, frame_ratio, anchor)
    if rect:
        el_rect = ET.Element(q("a:srcRect"))
        for k, v in rect.items():
            el_rect.set(k, str(v))
        fill.insert(list(fill).index(blip) + 1, el_rect)
        imgctx["cropped"].append((where, slot.id, src.name, lost, anchor))


# ── Build ────────────────────────────────────────────────────────────────────

BUILD_DIR = "build"


def build_dir(md_path):
    """Where everything the build produces goes. Deleting it loses nothing."""
    return Path(md_path).parent / BUILD_DIR


def resolve_output(front, args, md_path):
    """The pptx path: --output, then `output:`, then build/<source stem>.pptx.

    Source and artifact live in separate directories because that is what the model
    claims: deck.mdx is edited, everything under build/ is regenerated. A flat folder
    makes the two look like peers and invites someone to hand-edit the pptx.
    """
    md_path = Path(md_path)
    named = args.output if getattr(args, "output", None) else front.get("output")
    out = Path(named) if named else build_dir(md_path) / (md_path.stem + ".pptx")
    return out if out.is_absolute() else md_path.parent / out


def resolve_template(front, args, md_path):
    if args.template:
        return require_template(args.template)
    t = front.get("template")
    if not t:
        require_template(None)
    p = Path(t)
    return require_template(p if p.is_absolute() else (md_path.parent / p))


def cmd_build(args):
    md_path = require_deck(args.deck)
    front, specs, errors = parse_deck(md_path.read_text(encoding="utf-8"))
    template = resolve_template(front, args, md_path)
    out = resolve_output(front, args, md_path)
    if not specs:
        raise SystemExit("error: %s has no slides (no `## @archetype` headers)" % md_path.name)

    pkg = Package(template)
    template_media = frozenset(n for n in pkg.parts if n.startswith("ppt/media/"))
    protos = slide_order(pkg)
    drift = []
    verify_signature(front, pkg, protos, slide_size(pkg)[1], drift)
    proto_xml = {n: pkg.parts[n] for n in protos}
    proto_rels = {n: pkg.parts.get(rels_name(n)) for n in protos}

    for n in protos:
        pkg.drop(n)
        pkg.drop(rels_name(n))
    proto_notes = None
    for n in sorted(k for k in pkg.parts if k.startswith("ppt/notesSlides/notesSlide")):
        if proto_notes is None:
            proto_notes = pkg.parts[n]
        break
    for n in [k for k in list(pkg.parts) if k.startswith("ppt/notesSlides/")]:
        pkg.drop(n)

    imgctx = {"pkg": pkg, "base": md_path.parent.resolve(), "n": 0,
              "by_src": {}, "exts": set(), "add_rel": None,
              "renderer": Renderer(), "cache": build_dir(md_path) / ".cache",
              "rasterized": 0, "cropped": [], "knocked": 0}
    problems = list(errors) + drift
    new_parts = []
    notes_parts = []
    notes_master = None

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

        note_text = None
        for slot_id, kind, value, line in spec.values:
            where = "line %d" % line
            if slot_id == "notes":
                note_text = "\n".join(t for _, t in as_items(kind, value))
                continue
            if slot_id not in slots and CLONE_RE.fullmatch(slot_id):
                _, why = plan_clone(spTree, slots, slot_id, slide_size(pkg))
                if why:
                    problems.append("%s: '@%s' cannot clone '%s' — %s"
                                    % (where, spec.archetype, slot_id, why))
                    continue
            if slot_id not in slots:
                problems.append("%s: '@%s' has no slot '%s' (has: %s)"
                                % (where, spec.archetype, slot_id,
                                   ", ".join(slots) or "none"))
                continue
            apply_value(spTree, slots[slot_id], kind, value, imgctx, problems, where)

        part = "ppt/slides/slide%d.xml" % i
        if note_text is not None:
            if notes_master is None:
                notes_master, made = ensure_notes_master(pkg)
                if made:
                    problems.append("the template carries no notes master, so a plain one "
                                    "was added to hold the speaker notes")
            npart = "ppt/notesSlides/notesSlide%d.xml" % (len(notes_parts) + 1)
            nroot = ET.fromstring(proto_notes or BLANK_NOTES.encode("utf-8"))
            body = notes_body(nroot)
            if body is None:
                problems.append("%s: the template's notes layout has no notes placeholder, "
                                "so notes were dropped" % ("@" + spec.archetype))
            else:
                _write_paragraphs(body, [(0, t) for t in note_text.split("\n")])
                pkg.parts[npart] = ET.tostring(nroot, encoding="UTF-8", xml_declaration=True)
                pkg.parts[rels_name(npart)] = ET.tostring(_rels_root([
                    ("rId1", REL_NOTESMASTER,
                     "../" + notes_master.split("ppt/")[1]),
                    ("rId2", REL_SLIDE, "../slides/%s" % Path(part).name)]),
                    encoding="UTF-8", xml_declaration=True)
                add_rel(REL_NOTES, "../notesSlides/%s" % Path(npart).name)
                notes_parts.append(npart)
        pkg.parts[part] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
        pkg.parts[rels_name(part)] = ET.tostring(rels_root, encoding="UTF-8",
                                                 xml_declaration=True)
        new_parts.append(part)

    assert_raster_only(pkg, template_media)
    _rewrite_presentation(pkg, new_parts)
    _rewrite_content_types(pkg, new_parts, imgctx["exts"], notes_parts, notes_master)
    out.parent.mkdir(parents=True, exist_ok=True)
    pkg.write(out)

    fatal = [p for p in problems if "not writable" not in p]
    print("build -> %s  (%d slides from %s)" % (out, len(new_parts), template.name))
    for p in problems:
        print("  ! %s" % p)
    if notes_parts:
        print("  %d slide(s) carry speaker notes" % len(notes_parts))
    for where, slot_id, name, lost, anchor in imgctx["cropped"]:
        if lost >= 0.10:
            print("  ! %s: %s was cropped to fill %s — %.0f%% of the image is not on the "
                  "slide. `| fit` keeps all of it; `| fill top` moves what survives."
                  % (where, name, slot_id, lost * 100))
    if imgctx["knocked"]:
        print("  %d image background(s) made transparent" % imgctx["knocked"])
    if imgctx["n"]:
        print("  %d image(s) embedded%s"
              % (imgctx["n"], ", %d rasterized from SVG" % imgctx["rasterized"]
                 if imgctx["rasterized"] else ""))
    return 1 if fatal and args.strict else 0


def assert_raster_only(pkg, preexisting=()):
    """The build may not ADD a vector. What the template already carried is its own affair.

    PowerPoint stores an SVG next to a PNG fallback of the same picture, so a real
    template legitimately ships vector media; refusing to build against one would be
    refusing the template, not enforcing anything. The invariant that matters is that
    nothing *this build* embeds is vector, because that is the part the engine controls.
    """
    bad = [n for n in pkg.parts
           if n.startswith("ppt/media/") and Path(n).suffix.lower() in VECTOR_EXT
           and n not in preexisting]
    if bad:
        raise SystemExit("error: a vector file reached the package: %s\n"
                         "  this is a bug — images are rasterized before embedding."
                         % ", ".join(bad))


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


def _rewrite_content_types(pkg, new_parts, exts, notes_parts=(), notes_master=None):
    text = pkg.parts["[Content_Types].xml"].decode("utf-8")
    text = re.sub(r'<Override[^>]*PartName="/ppt/(?:slides|notesSlides)/[^"]*"[^>]*/>', "", text)
    defaults = ""
    for ext in sorted(exts):
        bare = ext.lstrip(".")
        if 'Extension="%s"' % bare not in text:
            defaults += '<Default Extension="%s" ContentType="%s"/>' % (bare, IMAGE_CT[ext])
    overrides = "".join(
        '<Override PartName="/%s" ContentType="%s"/>' % (p, CT_SLIDE) for p in new_parts)
    overrides += "".join(
        '<Override PartName="/%s" ContentType="%s"/>' % (p, CT_NOTES) for p in notes_parts)
    if notes_master and ('/%s"' % notes_master) not in text:
        overrides += ('<Override PartName="/%s" ContentType="%s"/>'
                      % (notes_master, CT_NOTESMASTER))
    text = text.replace("</Types>", defaults + overrides + "</Types>")
    pkg.parts["[Content_Types].xml"] = text.encode("utf-8")


# ── Check ────────────────────────────────────────────────────────────────────

def _check_picture_color(path, tag, slot_id, line, warns, palette, background,
                         flags=frozenset(), full_bleed=False):
    """Two ways a picture clashes: off the template's palette, or a box on the slide."""
    if path.suffix.lower() == ".svg":
        strays = []
        for hexv in svg_colors(path):
            near, dist = nearest(hexv, palette)
            if dist > 12:
                strays.append("#%s (nearest template color #%s)" % (hexv, near))
        if strays:
            warns.append("line %d: %s.%s — %s paints with colors the template does not "
                         "use: %s. Generated art carries content; the reference carries "
                         "the design." % (line, tag, slot_id, path.name, "; ".join(strays[:4])))
        return
    if path.suffix.lower() != ".png" or not background or full_bleed:
        return                              # full bleed: there is no slide left to sit on
    got = png_edge(path)
    if not got or got[0] is None:
        return
    border, clear = got
    if clear > 0.5:
        return                              # transparent edges sit on any background

    if "transparent" in flags:
        looked = analyse_knockout(path)
        if not looked or looked[1] < 0.01:
            warns.append("line %d: %s.%s — %s was asked for `transparent` but has no "
                         "uniform border to remove; the build will say so and embed it "
                         "as it is." % (line, tag, slot_id, path.name))
            return
        _, frac, content = looked
        if content and color_distance(content, background) < 25:
            warns.append("line %d: %s.%s — removing %s's background clears %.0f%% of it, "
                         "but what is left averages #%s against a #%s slide. It will be "
                         "hard to see. A panel behind it, or a lighter version of the "
                         "image, beats transparency here."
                         % (line, tag, slot_id, path.name, frac * 100, content, background))
        return

    dist = color_distance(border, background)
    if dist > 35:
        warns.append("line %d: %s.%s — %s has a #%s border on a #%s slide, so it will read "
                     "as a pasted box. Add `| transparent` to knock the background out, or "
                     "match it." % (line, tag, slot_id, path.name, border, background))


def _check_picture_size(path, slot, tag, slot_id, line, warns, mode="fill"):
    """Two ways a picture disappoints: it loses content, or it looks soft."""
    size = image_size(path) if path.suffix.lower() in IMAGE_CT else None
    if path.suffix.lower() == ".svg":
        a = svg_aspect(path)
        size = (round(a * 1000), 1000) if a else None
    if not size or not size[1]:
        return
    src_ratio = size[0] / size[1]
    if mode == "fill" and slot.ratio:
        _, lost = crop_rect(src_ratio, slot.ratio)
        if lost >= 0.10:
            fix = ("Author it at the frame's shape instead." if path.suffix.lower() == ".svg"
                   else "`| fit` keeps all of it; `| fill top` chooses what survives.")
            warns.append("line %d: %s.%s — %s is %.2f:1 in a %.2f:1 frame, so filling it "
                         "crops %.0f%% of the image away. %s"
                         % (line, tag, slot_id, path.name, src_ratio, slot.ratio,
                            lost * 100, fix))
    if slot.frame_pt and path.suffix.lower() != ".svg":
        dpi_w = effective_dpi(size[0], slot.frame_pt[0] * EMU_PER_PT)
        if dpi_w and dpi_w < 110:
            warns.append("line %d: %s.%s — %s is %dpx across a %dpt frame (%.0f dpi). It "
                         "will look soft on a projector; %dpx or more is comfortable."
                         % (line, tag, slot_id, path.name, size[0], slot.frame_pt[0], dpi_w,
                            int(slot.frame_pt[0] / 72 * 150)))
        elif dpi_w and dpi_w > 400:
            kb = path.stat().st_size // 1024
            warns.append("line %d: %s.%s — %s is %dpx across a %dpt frame (%.0f dpi, %dKB). "
                         "Nothing above ~300 dpi reaches the screen; it is file size only."
                         % (line, tag, slot_id, path.name, size[0], slot.frame_pt[0],
                            dpi_w, kb))


def _check_picture_legibility(path, slot, slots, tag, slot_id, line, warns, errs,
                             mode, anchor, flags, background, theme):
    """Can the words on top of this picture still be read?

    `check` otherwise looks at the image alone and at the text alone. Where a template
    lays type over a picture, neither is wrong on its own and the slide is still
    unreadable, so this measures the actual pixels that land behind each text box.
    """
    pairs = [(t, f) for t, pic, f in text_over_pictures(slots) if pic is slot]
    if not pairs:
        return
    for text_slot, frac in pairs:
        if text_slot.z < slot.z and frac >= 0.5:
            errs.append("line %d: %s.%s — the picture is drawn after %s and covers %.0f%% "
                        "of it, so the words end up behind the image. Reorder them in the "
                        "template, or leave this slot to `!drop`."
                        % (line, tag, slot_id, text_slot.id, frac * 100))

    if path.suffix.lower() != ".png":
        return
    got = read_png(path)
    if not got:
        return
    w, h, rows = got
    if "transparent" in flags:
        rows, _, _ = knockout_background(rows, w, h)
    src_ratio = w / float(h) if h else None

    pic_box = slot.box
    crop = (0.0, 0.0, 0.0, 0.0)
    if mode == "fit":
        fitted = fit_frame((slot.box[0], slot.box[1]), (slot.box[2], slot.box[3]), src_ratio)
        if fitted:
            pic_box = (fitted[0][0], fitted[0][1], fitted[1][0], fitted[1][1])
    elif mode == "fill" and slot.ratio:
        rect, _ = crop_rect(src_ratio, slot.ratio, anchor)
        if rect:
            crop = tuple(rect.get(k, 0) / 100000.0 for k in ("l", "t", "r", "b"))

    for text_slot, _ in pairs:
        text_hex = resolve_color_ref(text_slot.color_ref, theme)
        if not text_hex:
            continue                      # colour is inherited; guessing would be worse
        win = source_window(text_slot.box, pic_box, crop)
        if not win:
            continue
        threshold = legibility_threshold(text_slot.size_pt)
        measured = window_contrast(rows, w, h, win, text_hex, background, threshold)
        if not measured:
            continue
        mean, bad = measured
        if bad > 0.20:
            warns.append("line %d: %s.%s — %s sits under %s (%s), and %.0f%% of the image "
                         "behind it falls below %.1f:1 against #%s text (the area averages "
                         "#%s). A scrim behind the words, a darker crop, or a quieter "
                         "part of the image under them."
                         % (line, tag, slot_id, path.name, text_slot.id,
                            ("%gpt" % text_slot.size_pt) if text_slot.size_pt else "size "
                            "inherited", bad * 100, threshold, text_hex, mean))


def cmd_check(args):
    md_path = require_deck(args.deck)
    front, specs, errors = parse_deck(md_path.read_text(encoding="utf-8"))
    template = resolve_template(front, args, md_path)
    pkg = Package(template)
    protos = slide_order(pkg)
    slide_cy = slide_size(pkg)[1]
    catalog = {"s%d" % i: analyze_slide(ET.fromstring(pkg.parts[n]), slide_cy)
               for i, n in enumerate(protos, 1)}
    zones = template_zones(pkg, protos, slide_cy)
    # A slot holding exactly the template's own content: what it warns is the template's.
    own_values, own_lines = template_values(pkg, protos, slide_cy), set()

    theme_colors, used_colors = template_palette(pkg, protos)
    theme = dict(theme_colors)
    palette = [v for _, v in theme_colors] + [c for c, _ in used_colors]
    backgrounds = {"s%d" % i: slide_background(pkg, n) for i, n in enumerate(protos, 1)}

    errs, warns = list(errors), []
    basis, no_font = {True: set(), False: set()}, set()
    verify_signature(front, pkg, protos, slide_cy, errs)
    for spec in specs:
        tag = "@%s (line %d)" % (spec.archetype, spec.line)
        slots = catalog.get(spec.archetype)
        if slots is None:
            errs.append("%s: unknown archetype — template has s1..s%d" % (tag, len(protos)))
            continue
        by_id = {s.id: s for s in slots}
        seen = set()
        for slot_id, kind, value, line in spec.values:
            if slot_id in RESERVED_KEYS:
                if not any(n.startswith("ppt/notesMasters/") for n in pkg.parts):
                    warns.append("line %d: %s has notes, and the template carries no notes "
                                 "master — a plain one will be added to hold them"
                                 % (line, tag))
                continue
            seen.add(slot_id)
            if own_values.get((spec.archetype, slot_id)) == (kind, value):
                own_lines.add(line)
            slot = by_id.get(slot_id)
            if slot is None and CLONE_RE.fullmatch(slot_id):
                probe = ET.fromstring(pkg.parts[protos[int(spec.archetype[1:]) - 1]])
                slot, why = plan_clone(probe.find(q("p:cSld") + "/" + q("p:spTree")),
                                       dict(by_id), slot_id, slide_size(pkg))
                if why:
                    errs.append("line %d: %s cannot clone '%s' — %s" % (line, tag, slot_id, why))
                    continue
            if slot is None:
                errs.append("line %d: %s has no slot '%s' — available: %s"
                            % (line, tag, slot_id, ", ".join(by_id)))
                continue
            if slot.type == "picture" and kind == "scalar" and value.strip() != "!drop":
                path, mode, anchor, flags = parse_picture_value(value)
                if mode is None:
                    errs.append("line %d: %s.%s — unknown picture option %r; use one of "
                                "%s, an anchor (%s), or %s"
                                % (line, tag, slot_id, anchor, "/".join(FIT_MODES),
                                   "/".join(ANCHORS), "/".join(FLAGS)))
                    continue
                p = Path(path)
                p = p if p.is_absolute() else md_path.parent / p
                ext = p.suffix.lower()
                if not p.is_file():
                    errs.append("line %d: %s.%s — image not found: %s"
                                % (line, tag, slot_id, p))
                else:
                    if ext == ".svg" and not Renderer().available:
                        errs.append("line %d: %s.%s — %s is an SVG and needs a renderer to "
                                    "become a picture; install LibreOffice or set "
                                    "DECK_RENDER_DOCKER" % (line, tag, slot_id, p.name))
                    elif ext not in UNIVERSAL_EXT and ext != ".svg":
                        warns.append("line %d: %s.%s — %s embeds, but older PowerPoint shows "
                                     "nothing for it. PNG or JPEG is the safe choice."
                                     % (line, tag, slot_id, ext))
                    _check_picture_size(p, slot, tag, slot_id, line, warns, mode)
                    _check_picture_color(p, tag, slot_id, line, warns, palette,
                                         backgrounds.get(spec.archetype), flags,
                                         full_bleed=covers_slide(slot, slide_size(pkg)))
                    if slot.box:
                        _check_picture_legibility(
                            p, slot, slots, tag, slot_id, line, warns, errs, mode, anchor,
                            flags, backgrounds.get(spec.archetype), theme)
            if slot.type == "table" and kind != "table":
                errs.append("line %d: %s.%s is a table — use `| a | b |` rows"
                            % (line, tag, slot_id))
            if slot.type == "chart":
                warns.append("line %d: %s.%s is a chart — not writable, template data kept"
                             % (line, tag, slot_id))
            if slot.type in ("text", "list") and slot.para_formats:
                levels = {}
                for k, (lv, _) in enumerate(slot.para_formats):
                    levels.setdefault(lv, k)
                for i, (lvl, text) in enumerate(as_items(kind, value)):
                    if i < len(slot.para_formats) and slot.para_formats[i][0] == lvl:
                        fmts = slot.para_formats[i][1]
                    else:
                        fmts = slot.para_formats[levels.get(lvl, levels[min(levels)])][1]
                    if max_span_format(text) > max(1, len(fmts)):
                        errs.append("line %d: %s.%s — `{%d}` 서식이 없습니다. 이 문단의 서식: %s"
                                    % (line, tag, slot_id, max_span_format(text),
                                       " · ".join("%d = %s" % (n, f)
                                                  for n, f in enumerate(fmts, 1)) or "1"))
            if slot.type in ("text", "list") and slot.max_em:
                # The template calibrates itself: most slots hold text that already wraps,
                # so an absolute width is noise. What matters is a slot the designer kept
                # to one line, or content far longer than the slot was drawn for.
                one_line = slot.proto_em is not None and 0 < slot.proto_em <= slot.max_em
                basis[slot.estimated].add("%s.%s" % (spec.archetype, slot.id))
                if slot.estimated and slot.face:
                    no_font.add(slot.face)
                for lvl, text in seen_items(kind, value):
                    wide = slot_em(slot, text)
                    if one_line and wide > slot.max_em * 1.05:
                        warns.append("line %d: %s.%s — the template keeps this slot to one "
                                     "line and this is %.0f%% too wide for it, so it drops "
                                     "onto a second: %r"
                                     % (line, tag, slot_id, (wide / slot.max_em - 1) * 100,
                                        truncate(text, 34)))
                    elif slot.proto_em and wide > slot.proto_em * 1.6:  # noqa: E501
                        warns.append("line %d: %s.%s — %.0f%% longer than the longest line "
                                     "the template puts here, so it takes more lines than "
                                     "the design allows for: %r"
                                     % (line, tag, slot_id, (wide / slot.proto_em - 1) * 100,
                                        truncate(text, 34)))
            if slot.type == "table" and kind == "table" and slot.fits \
                    and len(value) > slot.fits:
                lost = [r[0] if r else "" for r in value[slot.fits:]]
                errs.append("line %d: %s.%s — %d rows, but only %d clear the bottom of the "
                            "slide. These are cut off and their content is lost: %s"
                            % (line, tag, slot_id, len(value), slot.fits,
                               ", ".join(truncate(x, 14) for x in lost)))
            if slot.type in ("text", "list") and slot.fits:
                nlines = len(seen_items(kind, value))
                if slot.max_em:
                    nlines = wrapped_lines(slot, [t for _, t in seen_items(kind, value)])
                if nlines > slot.fits:
                    warns.append("line %d: %s.%s — about %d lines once wrapped, but only %d "
                                 "clear the bottom of the slide; the rest is cut off unless "
                                 "the shape shrinks text to fit"
                                 % (line, tag, slot_id, nlines, slot.fits))
            if slot.type in ("text", "list") and (slot.proto_vol or 0) >= UNDERFILL_FLOOR:
                mine = sum(slot_em(slot, t) for _, t in seen_items(kind, value))
                if mine < slot.proto_vol * UNDERFILL_RATIO:
                    warns.append("line %d: %s.%s — %.0f%% of the text the template puts "
                                 "here. The frame was drawn for that much, so the slide "
                                 "opens a hole where the rest was. Write to the frame, or "
                                 "choose an archetype shaped for less."
                                 % (line, tag, slot_id, mine / slot.proto_vol * 100))
            if slot.type in ("text", "list"):
                got = spill(slot, [t for _, t in seen_items(kind, value)])
                if got and got[0] > 0:
                    over, lines, was = got
                    into = shapes_below(slot, slots, over)
                    where = (" straight into %s" % ", ".join(o.id for o in into[:2])
                             if into else " into the space below it")
                    say = errs if into else warns
                    say.append("line %d: %s.%s — %d lines where the template has %d, so it "
                               "runs %.0fpt lower than the design puts it%s. Cut it to %d "
                               "lines, or use an archetype with room."
                               % (line, tag, slot_id, lines, was, pt(over), where, was))
                    for r in zones.get(spec.archetype, []):
                        if r["axis"] != "↓" or slot_id not in r["a"] or r["zone"] is None:
                            continue
                        left = r["gap"] - pt(over)
                        if left < r["zone"] - ZONE_TOL_PT:
                            warns.append("line %d: %s.%s — 임계 침범: %s 사이 간격이 %.1fpt로 "
                                         "줄어 템플릿 임계 %s보다 %.1fpt 들어갑니다. 줄이거나 "
                                         "여유 있는 아키타입으로 바꾸세요 (도형은 옮기지 않음)."
                                         % (line, tag, slot_id, r["label"], max(left, 0.0),
                                            zone_cell(r), r["zone"] - left))
            if slot.type == "list" and slot.max_items and kind == "list" \
                    and len(value) > slot.max_items and not slot.box:
                warns.append("line %d: %s.%s — %d items vs %d in the template; extra items "
                             "are cloned and may run past the frame"
                             % (line, tag, slot_id, len(value), slot.max_items))
        # Text the template itself leaves empty is not content a deck forgot to set.
        untouched = [s.id for s in slots if s.id not in seen and s.type != "chart"
                     and (s.type == "picture" or (spec.archetype, s.id) in own_values)]
        if untouched:
            warns.append("%s: keeps template content for %s" % (tag, ", ".join(untouched)))

    def own(w):
        m = re.match(r"line (\d+):", w)
        return bool(m) and int(m.group(1)) in own_lines
    inherited = [w for w in warns if own(w)]
    warns = [w for w in warns if not own(w)]

    print("check %s against %s" % (md_path.name, template.name))
    print("  %d slides, %d error(s), %d warning(s)" % (len(specs), len(errs), len(warns)))
    if basis[True] or basis[False]:
        say = "  글자 폭: 측정 %d슬롯 (폰트 파일 기준)" % len(basis[False])
        if basis[True]:
            say += " · 추정 %d슬롯 (em 모델)" % len(basis[True])
            if no_font:
                say += " — 폰트를 찾지 못함: %s. 설치하거나 DECK_FONT_DIRS로 알려주면 측정으로 바뀝니다" \
                       % ", ".join(sorted(no_font))
        print(say)
    for e in errs:
        print("  ERROR  %s" % e)
    for w in warns:
        print("  warn   %s" % w)
    if inherited:
        print("  템플릿 자체: %d건 — 템플릿 원본 내용 그대로인 슬롯에서도 나는 경고라 덱이 만든 "
              "문제가 아닙니다" % len(inherited))
        for w in inherited:
            print("    %s" % w)
    return 1 if errs else 0


# ── Rendering and the geometric audit ────────────────────────────────────────

XH = "{http://www.w3.org/1999/xhtml}"
_NOWRAP_BODY = re.compile(r'(<a:bodyPr\b[^>]*\bwrap="none"[^>]*(?<!/)>)(.*?)(</a:bodyPr>)', re.S)


def lo_nowrap_copy(src, dst):
    """Copy a pptx, dropping spAutoFit from every wrap="none" body (LibreOffice input only)."""
    with zipfile.ZipFile(str(src)) as zin, zipfile.ZipFile(str(dst), "w", zipfile.ZIP_DEFLATED) as zout:
        for n in zin.namelist():
            data = zin.read(n)
            if n.endswith(".xml") and n.startswith("ppt/") and b'wrap="none"' in data:
                text = _NOWRAP_BODY.sub(lambda m: m.group(1) + re.sub(
                    r"<a:spAutoFit\s*/>", "", m.group(2)) + m.group(3), data.decode("utf-8"))
                data = text.encode("utf-8")
            zout.writestr(n, data)


class Renderer:
    """LibreOffice, on PATH or in a container.

    DECK_RENDER_DOCKER=<image> uses that image instead. A container's daemon may not
    see /tmp, so in docker mode the deck has to live somewhere it can bind-mount —
    the deck's own directory, which is where the user put it.
    """

    def __init__(self):
        self.image = os.environ.get("DECK_RENDER_DOCKER")
        self.local = shutil.which("soffice") or shutil.which("libreoffice")
        self.available = bool(self.local or (self.image and shutil.which("docker")))

    def describe(self):
        return self.local if self.local else "docker %s" % self.image

    def sh(self, workdir, script):
        # The bundled fonts join what fontconfig already sees, so soffice wraps on them.
        if self.local:
            return subprocess.run(["bash", "-c", script], cwd=str(workdir), env=self._fc_env(),
                                  capture_output=True, text=True, timeout=900)
        return subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "bash", "-u", "0",
             "-v", "%s:/work" % workdir,
             "-v", "%s:/usr/share/fonts/deck-builder:ro" % BUNDLED_FONT_DIR,
             "-w", "/work", self.image, "-c", script],
            capture_output=True, text=True, timeout=1800)

    def _fc_env(self):
        env = dict(os.environ)
        if BUNDLED_FONT_DIR.is_dir():
            if not getattr(self, "_fc_conf", None):
                fd, self._fc_conf = tempfile.mkstemp(suffix=".conf", prefix="deck-fonts-")
                with os.fdopen(fd, "w") as f:
                    f.write('<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n'
                            '<fontconfig><include ignore_missing="yes">%s</include>'
                            '<dir>%s</dir></fontconfig>\n'
                            % (env.get("FONTCONFIG_FILE", "/etc/fonts/fonts.conf"),
                               BUNDLED_FONT_DIR))
            env["FONTCONFIG_FILE"] = self._fc_conf
        return env

    def to_pdf(self, workdir, name):
        # LibreOffice wraps a wrap="none" body at the box width when it also has spAutoFit;
        # PowerPoint keeps the line and grows the box. Convert a copy without spAutoFit there,
        # so the PDF matches PowerPoint; the pptx itself is left as built.
        src = Path(workdir) / name
        tmp = src.with_name(".lo-" + name)
        lo_nowrap_copy(src, tmp)
        r = self.sh(workdir, "export HOME=/tmp/lohome; mkdir -p $HOME; "
                             "soffice --headless -env:UserInstallation=file:///tmp/loprof "
                             "--convert-to pdf %s 2>&1 | tail -2" % tmp.name)
        tmp.unlink()
        made = tmp.with_suffix(".pdf")
        if made.is_file():
            os.replace(str(made), str(src.with_suffix(".pdf")))
        return (r.stdout + r.stderr).strip()

    def bbox(self, workdir, pdf):
        out = Path(pdf).with_suffix(".bbox.html").name
        self.sh(workdir, "command -v pdftotext >/dev/null || exit 0; "
                         "pdftotext -bbox-layout %s %s && chmod a+rw %s" % (pdf, out, out))
        f = workdir / out
        return f.read_text(encoding="utf-8") if f.is_file() else None

    def fonts(self, workdir):
        """Font families the renderer can actually see, lowercased. None if unknown."""
        r = self.sh(workdir, "command -v fc-list >/dev/null || exit 9; fc-list --format "
                             "'%{family}\\n'")
        if r.returncode == 9 or not r.stdout.strip():
            return None
        out = set()
        for line in r.stdout.splitlines():
            for alias in line.split(","):
                if alias.strip():
                    out.add(alias.strip().lower())
        return out

    def previews(self, workdir, pdf, dpi=72):
        self.sh(workdir, "command -v pdftoppm >/dev/null || exit 0; mkdir -p pages && "
                         "pdftoppm -r %d -png %s pages/p && chmod -R a+rwX pages"
                % (dpi, pdf))
        d = workdir / "pages"
        return sorted(d.glob("p*.png")) if d.is_dir() else []


def _bbox_pages(xml_text):
    root = ET.fromstring(xml_text)
    out = []
    for page in root.iter(XH + "page"):
        pw, ph = float(page.get("width")), float(page.get("height"))
        blocks = []
        for block in page.iter(XH + "block"):
            lines = []
            for line in block.iter(XH + "line"):
                ws = [w for w in line.iter(XH + "word") if (w.text or "").strip()]
                if not ws:
                    continue
                lines.append(((min(float(w.get("xMin")) for w in ws),
                               min(float(w.get("yMin")) for w in ws),
                               max(float(w.get("xMax")) for w in ws),
                               max(float(w.get("yMax")) for w in ws)),
                              " ".join(w.text for w in ws)))
            if lines:
                blocks.append(lines)
        out.append((pw, ph, blocks))
    return out


def collisions(xml_text, cross_tol=0.05, bunch_tol=0.70):
    """What physically clashes on the page.

    Plain box intersection does not work for CJK: Noto's em box is taller than a 100%
    line, so stacked lines always overlap without a glyph ever touching. So compare
    only ACROSS text blocks, and within a block look for bunching against the block's
    own median line pitch. Anything outside the page box is clipped, not merely tight.
    """
    def area(b):
        return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])

    def inter(a, b):
        return area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))

    found = []
    for pi, (pw, ph, blocks) in enumerate(_bbox_pages(xml_text), 1):
        for lines in blocks:
            for box, text in lines:
                if box[0] < -1 or box[1] < -1 or box[2] > pw + 1 or box[3] > ph + 1:
                    found.append((pi, "off-slide", "%r sits outside the %.0fx%.0f page"
                                  % (text[:34], pw, ph)))
        for i in range(len(blocks)):
            for j in range(i + 1, len(blocks)):
                for b1, t1 in blocks[i]:
                    for b2, t2 in blocks[j]:
                        ov = inter(b1, b2)
                        if ov <= 0:
                            continue
                        frac = ov / max(1e-6, min(area(b1), area(b2)))
                        if frac > cross_tol:
                            found.append((pi, "overlap", "%r overlaps %r by %.0f%%"
                                          % (t1[:26], t2[:26], frac * 100)))
        for lines in blocks:
            if len(lines) < 3:
                continue
            tops = [b[1] for b, _ in lines]
            pitches = [b - a for a, b in zip(tops, tops[1:])]
            med = statistics.median(pitches)
            for k, pitch in enumerate(pitches):
                if med > 0 and pitch < med * bunch_tol:
                    found.append((pi, "bunched", "%r sits %.1fpt below the previous line, "
                                  "against a %.1fpt norm" % (lines[k + 1][1][:26], pitch, med)))
    return found


def zone_audit(xml_text, archetypes, zones, slide_w_pt):
    """Rendered text against the template's critical zones.

    `zone`: a unit's rendered lines run past its frame and into the zone before its
    neighbour. `drift`: pages on one archetype whose rendered gap for one pair (content
    to content, frame where a unit has no text) spreads wider than the template's own
    cluster does (at least ZONE_TOL_PT) — the same layout no longer looks the same."""
    found, seen = [], {}
    for pi, (pw, ph, blocks) in enumerate(_bbox_pages(xml_text), 1):
        if pi > len(archetypes):
            break
        arch = archetypes[pi - 1]
        k = pw / slide_w_pt if slide_w_pt else 1.0
        content = {}
        boxes = {r[s + "_box"] for r in zones.get(arch, []) for s in ("a", "b")}
        for lines in blocks:
            # A block belongs to the frame holding its first line (text overruns downward),
            # else its last line (overruns upward), else the frame it overlaps most.
            def holding(box):
                cx, cy = (box[0] + box[2]) / 2 / k, (box[1] + box[3]) / 2 / k
                return next((u for u in boxes if u[0] <= cx <= u[0] + u[2]
                             and u[1] <= cy <= u[1] + u[3]), None)
            bx = (min(b[0] for b, _ in lines) / k, min(b[1] for b, _ in lines) / k)
            bx += (max(b[2] for b, _ in lines) / k - bx[0], max(b[3] for b, _ in lines) / k - bx[1])
            own = holding(lines[0][0]) or holding(lines[-1][0]) or max(
                boxes, key=lambda u: (box_intersection(bx, u) or (0, 0, 0, 0))[2]
                * (box_intersection(bx, u) or (0, 0, 0, 0))[3], default=None)
            if own is None or not box_intersection(bx, own):
                continue
            got = content.setdefault(own, [1e9, 1e9, -1e9, -1e9])
            for box, _ in lines:
                got[0], got[1] = min(got[0], box[0] / k), min(got[1], box[1] / k)
                got[2], got[3] = max(got[2], box[2] / k), max(got[3], box[3] / k)
        for r in zones.get(arch, []):
            a, b = r["a_box"], r["b_box"]
            ca = content.get(a)
            cb = content.get(b, [b[0], b[1], b[0] + b[2], b[1] + b[3]])
            if r["axis"] == "↓":
                frame_end, end = a[1] + a[3], (ca[3] if ca else None)
                start = b[1]
                seen_gap = cb[1] - (ca[3] if ca else a[1] + a[3])
            else:
                frame_end, end = a[0] + a[2], (ca[2] if ca else None)
                start = b[0]
                seen_gap = cb[0] - (ca[2] if ca else a[0] + a[2])
            if end is not None and r["zone"] is not None and end > frame_end + ZONE_TOL_PT \
                    and start - end < r["zone"] - ZONE_TOL_PT:
                found.append((pi, "zone", "%s — 글이 프레임을 %.1fpt 넘어 임계 %s 안으로 "
                              "%.1fpt 들어감" % (r["label"], end - frame_end, zone_cell(r),
                                                r["zone"] - (start - end))))
            # The later shape's text can overrun backwards too (bottom- or centre-anchored).
            back = cb[1] if r["axis"] == "↓" else cb[0]
            if content.get(b) and r["zone"] is not None and back < start - ZONE_TOL_PT \
                    and back - frame_end < r["zone"] - ZONE_TOL_PT:
                found.append((pi, "zone", "%s — 뒤 도형의 글이 프레임을 %.1fpt 거슬러 임계 %s "
                              "안으로 %.1fpt 들어감" % (r["label"], start - back, zone_cell(r),
                                                       r["zone"] - (back - frame_end))))
            seen.setdefault((arch, r["label"]), []).append((pi, seen_gap, r["spread"]))
    for (arch, label), obs in sorted(seen.items(), key=lambda kv: kv[1][0][0]):
        if len(obs) < 2:
            continue
        gaps = [g for _, g, _ in obs]
        if max(gaps) - min(gaps) > max(obs[0][2], ZONE_TOL_PT):
            found.append((obs[0][0], "drift", "@%s 슬라이드 %s: %s %s pt"
                          % (arch, "·".join(str(p) for p, _, _ in obs), label,
                             "/".join("%.0f" % g for g in gaps))))
    return found


def missing_fonts(pkg, slide_parts, available):
    """Typefaces the template asks for that the renderer does not have.

    Substitution is silent and it changes line breaks, so every wrap in the preview
    becomes untrustworthy — a title that fits in PowerPoint looks broken here, and
    the fix is to install the font, not to shorten the words.
    """
    if available is None:
        return None
    theme, _, faces = template_typography(pkg, slide_parts)
    # What the slides actually set is what the reader sees. The theme fonts are only a
    # fallback, and naming a missing one no slide uses is noise — Calibri on every deck.
    want = {name for name, _ in faces}
    if not want:
        for latin, ea in theme.values():
            want.update(x for x in (latin, ea) if x)
    missing = []
    for name in sorted(want):
        base = name.lower()
        stem = base.split(" light")[0].split(" bold")[0].split(" extrabold")[0].strip()
        if not any(base == a or stem == a or a.startswith(stem + " ") for a in available):
            missing.append(name)
    return missing


def cmd_render(args):
    r = Renderer()
    if not r.available:
        raise SystemExit(
            "error: no renderer.\n"
            "  a deck is read by people, so this step looks at the page rather than the file.\n"
            "  install LibreOffice (soffice on PATH), or set DECK_RENDER_DOCKER=<image>.")
    rc = cmd_build(args)
    md_path = Path(args.deck)
    front, _, _ = parse_deck(md_path.read_text(encoding="utf-8"))
    out = resolve_output(front, args, md_path)
    work = out.parent.resolve()   # docker reads a relative `-v build:/work` as a named volume

    print("render via %s" % r.describe())
    built = Package(out)
    gone = missing_fonts(built, slide_order(built), r.fonts(work))
    if gone:
        print("  ! the renderer has no %s — it will substitute, and a substitute font "
              "wraps lines differently." % ", ".join(gone[:4]))
        print("    Judge layout from this render only after installing them; the pptx "
              "itself names the right faces.")
    log = r.to_pdf(work, out.name)
    pdf = out.with_suffix(".pdf")
    if not pdf.is_file():
        raise SystemExit("error: the renderer did not produce a PDF\n  %s" % log)
    print("  pdf -> %s" % pdf)
    pages = r.previews(work, pdf.name)
    if pages:
        print("  %d page preview(s) -> %s/" % (len(pages), pages[0].parent))

    box = r.bbox(work, pdf.name)
    if box is None:
        print("  ! no pdftotext in the renderer — skipping the collision audit")
        return rc
    hits = collisions(box)
    _, specs, _ = parse_deck(md_path.read_text(encoding="utf-8"))
    tpl = Package(resolve_template(front, args, md_path))
    tparts = slide_order(tpl)
    zones = template_zones(tpl, tparts, slide_size(tpl)[1])
    archs = [s.archetype for s in specs]
    hits += zone_audit(box, archs, zones, pt(slide_size(tpl)[0]))

    # The template rendered the same way is the baseline: what its own page of that
    # archetype already shows is the template's, not something this deck did.
    ref = work / "template-ref.pptx"
    shutil.copyfile(str(resolve_template(front, args, md_path)), str(ref))
    r.to_pdf(work, ref.name)
    rbox = r.bbox(work, ref.with_suffix(".pdf").name) if ref.with_suffix(".pdf").is_file() else None
    seen = set()
    if rbox:
        own = collisions(rbox) + zone_audit(rbox, ["s%d" % i for i in range(1, len(tparts) + 1)],
                                            zones, pt(slide_size(tpl)[0]))
        seen = {(p, k, d) for p, k, d in own}
    inherited = [h for h in hits if h[0] <= len(archs)
                 and (int(archs[h[0] - 1][1:]), h[1], h[2]) in seen]
    hits = [h for h in hits if h not in inherited]

    if not hits:
        print("  layout: clean — nothing overlaps or runs off a slide")
    else:
        print("  layout: %d problem(s) — look at these pages before you present" % len(hits))
        for page, kind, detail in hits:
            print("    page %d  %-9s %s" % (page, kind, detail))
    if inherited:
        print("  템플릿 자체: %d건 — 템플릿 원본을 같은 렌더러로 그려도 같은 페이지에 나옵니다"
              % len(inherited))
        for page, kind, detail in inherited:
            print("    page %d  %-9s %s" % (page, kind, detail))
    if rbox is None:
        print("  ! 템플릿 원본을 렌더하지 못해 템플릿 자체 문제와 구분하지 못했습니다")
    return 1 if (hits and args.strict) else rc


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("catalog", help="template.pptx -> catalog markdown")
    c.add_argument("--template", required=True, help="reference .pptx (mandatory)")
    c.add_argument("--output")
    c.set_defaults(func=cmd_catalog)

    x = sub.add_parser("extract", help="template.pptx -> deck.mdx holding its own content")
    x.add_argument("--template", required=True, help="reference .pptx (mandatory)")
    x.add_argument("--output")
    x.set_defaults(func=cmd_extract)

    k = sub.add_parser("check", help="validate deck.mdx against the reference template")
    k.add_argument("--deck", required=True, metavar="deck" + DECK_EXT)
    k.add_argument("--template", help="overrides the front matter; one is always required")
    k.set_defaults(func=cmd_check)

    b = sub.add_parser("build", help="deck.mdx -> deck.pptx")
    b.add_argument("--deck", required=True, metavar="deck" + DECK_EXT)
    b.add_argument("--template", help="overrides the front matter; one is always required")
    b.add_argument("--output")
    b.add_argument("--strict", action="store_true", help="exit nonzero on any problem")
    b.set_defaults(func=cmd_build)

    d = sub.add_parser("render", help="build, then render and look for collisions")
    d.add_argument("--deck", required=True, metavar="deck" + DECK_EXT)
    d.add_argument("--template", help="overrides the front matter; one is always required")
    d.add_argument("--output")
    d.add_argument("--strict", action="store_true", help="exit nonzero on any problem")
    d.set_defaults(func=cmd_render)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
