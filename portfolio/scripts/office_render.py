#!/usr/bin/env python3
"""Shared by deck-builder (pptx) and resume-builder (docx): the renderer and the final checks.

  Renderer      LibreOffice on PATH, or in a container (DECK_RENDER_DOCKER=<image>)
  bbox_pages    pdftotext -bbox-layout output -> pages of text lines with their boxes
  margin_crossers   lines whose box leaves a page margin (the safe area)
  ai_traces     the last check of a built pptx/docx: AI disclaimers left in alt text, AI tools named
                in the document properties, AI phrases in the visible text

Command line (one JSON object each):
  office_render.py ai-traces <file.pptx|file.docx> [--report-only]
  office_render.py margins <file.pdf> [--margin 28]

Python stdlib only.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import uuid
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path

XH = "{http://www.w3.org/1999/xhtml}"
BUNDLED_FONT_DIR = Path(__file__).resolve().parent.parent / "skills" / "deck-builder" / "assets" / "fonts"
STAGE_ROOT = Path.home() / ".cache" / "portfolio-render"

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


# Run by the renderer's own python (one that imports uno): open the pptx in a private headless
# soffice, turn ParaIsCharacterDistance off on every paragraph — groups and table cells included —
# and export the PDF next to it. Prints one `spacing:` line the render reports.
UNO_CONVERT = r'''
import os, subprocess, sys, time
import uno
from com.sun.star.beans import PropertyValue


def pv(n, v):
    p = PropertyValue()
    p.Name, p.Value = n, v
    return p


def main(src):
    pipe = "deckuno%d" % os.getpid()
    proc = subprocess.Popen(["soffice", "--headless", "--norestore", "--nologo",
                             "-env:UserInstallation=file:///tmp/loprof-uno",
                             "--accept=pipe,name=%s;urp;" % pipe],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local)
    ctx = None
    for _ in range(120):
        try:
            ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % pipe)
            break
        except Exception:
            time.sleep(0.5)
    if ctx is None:
        proc.kill()
        print("spacing: soffice did not answer over uno")
        return 1
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    url = uno.systemPathToFileUrl(os.path.abspath(src))
    doc = desktop.loadComponentFromURL(url, "_blank", 0, (pv("Hidden", True),))
    n = {"paragraphs": 0, "cells": 0, "failed": 0}

    def paras(text):
        try:
            e = text.createEnumeration()
        except Exception:
            return
        while e.hasMoreElements():
            p = e.nextElement()
            try:
                p.ParaIsCharacterDistance = False
                n["paragraphs"] += 1
            except Exception:
                n["failed"] += 1

    def walk(sh):
        kind = sh.ShapeType
        if kind.endswith("GroupShape"):
            for i in range(sh.Count):
                walk(sh.getByIndex(i))
        elif kind.endswith("TableShape"):
            m = sh.Model
            for r in range(m.Rows.Count):
                for c in range(m.Columns.Count):
                    try:
                        cur = m.getCellByPosition(c, r).createTextCursor()
                        cur.gotoStart(False)
                        cur.gotoEnd(True)
                        cur.setPropertyValue("ParaIsCharacterDistance", False)
                        n["cells"] += 1
                    except Exception:
                        n["failed"] += 1
        else:
            paras(sh)

    pages = doc.DrawPages
    for i in range(pages.Count):
        page = pages.getByIndex(i)
        for j in range(page.Count):
            walk(page.getByIndex(j))
    out = os.path.splitext(os.path.abspath(src))[0] + ".pdf"
    doc.storeToURL(uno.systemPathToFileUrl(out), (pv("FilterName", "impress_pdf_Export"),))
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=30)
    except Exception:
        proc.kill()
    print("spacing: East Asian / Latin spacing off on %d paragraphs and %d table cells%s"
          % (n["paragraphs"], n["cells"], ", %d could not be set" % n["failed"] if n["failed"] else ""))
    return 0 if os.path.exists(out) else 1


sys.exit(main(sys.argv[1]))
'''


def _under_home(p):
    try:
        Path(p).resolve().relative_to(Path.home().resolve())
        return True
    except ValueError:
        return False


def _snapshot(root):
    return {str(p.relative_to(root)): (p.stat().st_size, p.stat().st_mtime_ns)
            for p in root.rglob("*") if p.is_file()}


class Renderer:
    """LibreOffice, on PATH or in a container.

    DECK_RENDER_DOCKER=<image> uses that image instead. A container's daemon (a snap one, for
    instance) may bind-mount only paths under $HOME, so a work dir elsewhere is staged into a
    fresh dir under ~/.cache/portfolio-render/, rendered there, the changed files copied back and
    the stage deleted. Files the container writes end up owned by the host user.
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
        workdir = Path(workdir).resolve()
        if _under_home(workdir) and _under_home(BUNDLED_FONT_DIR):
            return self._docker(workdir, BUNDLED_FONT_DIR, script)
        return self._staged(workdir, script)

    def _docker(self, work, fonts, script):
        owner = "%d:%d" % (os.getuid(), os.getgid())
        tail = "; rc=$?; chown -R %s /work 2>/dev/null; chmod -R a+rwX /work 2>/dev/null; exit $rc" % owner
        return subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "bash", "-u", "0",
             "-v", "%s:/work" % work,
             "-v", "%s:/usr/share/fonts/deck-builder:ro" % fonts,
             "-w", "/work", self.image, "-c", "{ " + script + "\n}" + tail],
            capture_output=True, text=True, timeout=1800)

    def _staged(self, workdir, script):
        stage = STAGE_ROOT / uuid.uuid4().hex
        try:
            work = stage / "work"
            shutil.copytree(str(workdir), str(work), symlinks=True)
            fonts = stage / "fonts"
            if BUNDLED_FONT_DIR.is_dir():
                shutil.copytree(str(BUNDLED_FONT_DIR), str(fonts))
            else:
                fonts.mkdir()
            before = _snapshot(work)
            r = self._docker(work, fonts, script)
            after = _snapshot(work)
            for rel in before:
                if rel not in after and (workdir / rel).exists():
                    (workdir / rel).unlink()
            for rel, sig in after.items():
                if before.get(rel) != sig:
                    dst = workdir / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(str(work / rel), str(dst))
            return r
        finally:
            shutil.rmtree(str(stage), ignore_errors=True)
            try:
                STAGE_ROOT.rmdir()
            except OSError:
                pass

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
        # LibreOffice also puts its own East Asian / Latin spacing into every paragraph
        # (ParaIsCharacterDistance): the PDF then has a real gap before a comma after Hangul and
        # between Hangul and Latin or digits, which PowerPoint does not draw. No pptx attribute
        # turns it off, so the copy is converted through UNO with it off on every paragraph and
        # table cell. With no python that imports uno (and for any file that is not a pptx), the
        # plain conversion runs and says so.
        src = Path(workdir) / name
        tmp = src.with_name(".lo-" + name)
        is_pptx = src.suffix.lower() == ".pptx"
        if is_pptx:
            lo_nowrap_copy(src, tmp)
        else:
            shutil.copyfile(str(src), str(tmp))
        script = Path(workdir) / ".lo-convert.py"
        script.write_text(UNO_CONVERT, encoding="utf-8")
        plain = ("soffice --headless -env:UserInstallation=file:///tmp/loprof "
                 "--convert-to pdf %s 2>&1 | tail -2" % tmp.name)
        if is_pptx:
            body = ("PY=; for p in python3 /usr/lib/libreoffice/program/python "
                    "/opt/libreoffice*/program/python "
                    "/Applications/LibreOffice.app/Contents/Resources/python; do "
                    "if command -v \"$p\" >/dev/null 2>&1 && \"$p\" -c 'import uno' "
                    ">/dev/null 2>&1; then PY=$p; break; fi; done; "
                    "if [ -n \"$PY\" ]; then \"$PY\" %s %s 2>&1 | tail -3; else "
                    "echo 'spacing: no python with uno, East Asian / Latin spacing "
                    "left on'; %s; fi" % (script.name, tmp.name, plain))
        else:
            body = plain
        try:
            r = self.sh(workdir, "export HOME=/tmp/lohome; mkdir -p $HOME; " + body)
        finally:
            for f in (tmp, script):
                if f.exists():
                    f.unlink()
        made = tmp.with_suffix(".pdf")
        if made.is_file():
            os.replace(str(made), str(src.with_suffix(".pdf")))
        return (r.stdout + r.stderr).strip()

    def bbox(self, workdir, pdf):
        out = Path(pdf).with_suffix(".bbox.html").name
        self.sh(workdir, "command -v pdftotext >/dev/null || exit 0; "
                         "pdftotext -bbox-layout %s %s && chmod a+rw %s" % (pdf, out, out))
        f = Path(workdir) / out
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

    def previews(self, workdir, pdf, dpi=72, prefix="p"):
        """Page PNGs in <workdir>/pages/<prefix>-N.png; the old ones with that prefix go first, so a
        shorter document never keeps the previews of a longer one."""
        self.sh(workdir, "command -v pdftoppm >/dev/null || exit 0; mkdir -p pages && "
                         "rm -f pages/%s*.png && "
                         "pdftoppm -r %d -png %s pages/%s && chmod -R a+rwX pages"
                % (prefix, dpi, pdf, prefix))
        d = Path(workdir) / "pages"
        return sorted(d.glob(prefix + "*.png")) if d.is_dir() else []

    def text(self, workdir, pdf):
        """The PDF's text (pdftotext), or None when pdftotext is not there."""
        out = Path(pdf).with_suffix(".final.txt").name
        self.sh(workdir, "command -v pdftotext >/dev/null || exit 0; "
                         "pdftotext %s %s && chmod a+rw %s" % (pdf, out, out))
        f = Path(workdir) / out
        try:
            return f.read_text(encoding="utf-8") if f.is_file() else None
        finally:
            if f.is_file():
                f.unlink()


# ── Geometry from pdftotext -bbox-layout ─────────────────────────────────────

def bbox_pages(xml_text):
    """[(page_w, page_h, blocks)] where a block is a list of ((x0, y0, x1, y1), text) lines, in pt."""
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


def safe_area(workspace):
    """{top, bottom, left, right} pt from the workspace's style/레이아웃.md (`- top: 36` lines, the same
    form manage's `layout` reads), only when all four are numbers; else None."""
    for form in ("NFC", "NFD"):
        p = Path(workspace) / unicodedata.normalize(form, "style/레이아웃.md")
        if p.is_file():
            text = p.read_text(encoding="utf-8")
            v = {}
            for k in ("top", "bottom", "left", "right"):
                m = re.search(r"^\s*-\s*%s\s*:\s*(\d+(?:\.\d+)?)\s*(?:pt)?\s*$" % k, text, re.M)
                if m:
                    v[k] = float(m.group(1))
            return v if len(v) == 4 else None
    return None


def margin_crossers(xml_text, margin=28.0):
    """[(page, side, text)] for every text line whose box leaves the page inset by `margin` pt
    (one number, or {top, bottom, left, right})."""
    m = margin if isinstance(margin, dict) else dict.fromkeys(("top", "bottom", "left", "right"), margin)
    hits = []
    for n, (pw, ph, blocks) in enumerate(bbox_pages(xml_text), 1):
        for lines in blocks:
            for (x0, y0, x1, y1), text in lines:
                for side, bad in (("left", x0 < m["left"]), ("right", x1 > pw - m["right"]),
                                  ("top", y0 < m["top"]), ("bottom", y1 > ph - m["bottom"])):
                    if bad:
                        hits.append((n, side, text[:60]))
    return hits


# ── The last check: traces of AI in a built pptx / docx ──────────────────────

DISCLAIMERS = [
    r"AI-generated content may be incorrect\.?",
    # Korean builds word it several ways: AI 생성 / AI가 생성한 / AI에서 생성된 / AI로 생성된 …
    r"AI\s?(?:가|에서|로|에 의해)?\s?생성(?:한|된|)\s?(?:콘텐츠|내용|컨텐츠)(?:는|은)\s?(?:정확하지 않을|부정확할|틀릴)\s?수\s?있습니다\.?",
    # …written (작성) as well as generated, by 인공지능 too, "…이므로 오류가 있을 수 있습니다"
    r"(?:AI|인공지능)\s?(?:가|이|에서|로|에 의해)?\s?(?:생성|작성)(?:한|된|하였|했)?\s?(?:콘텐츠|내용|컨텐츠|문서|결과)"
    r"(?:는|은|이므로|이라서?|이기 때문에)?\s?(?:정확하지 않을|부정확할|틀릴|오류가 있을)\s?수\s?있습니다\.?",
]
_DISCLAIMER = re.compile("|".join(DISCLAIMERS), re.I)
_TOOLS = re.compile(r"\b(Copilot|ChatGPT|GPT-?\d*|OpenAI|Gemini|Claude|Anthropic)\b", re.I)
_PHRASES = re.compile(r"As an AI\b|AI가 생성|AI로 생성|생성형 ?AI로 (?:작성|생성)|AI로 작성|AI가 작성|"
                      r"AI의 도움을 받아\s?(?:작성|생성)|(?:AI|인공지능)를? (?:사용|이용|활용)해서? (?:작성|생성)|"
                      r"인공지능(?:이|으로)\s?(?:작성|생성)|"
                      r"(?:ChatGPT|Copilot|Gemini|Claude|GPT-?\d*)\s?(?:로|으로|를 (?:사용|이용|활용)해서?|의 도움으로)\s?(?:작성|생성)|"
                      r"(?:generated|written|created) (?:by|with) (?:an? )?(?:AI|ChatGPT|Copilot|Gemini|Claude)\b|"
                      r"Generated with\b|Co-Authored-By\b|"
                      r"(?:작성자|저자|글쓴이|author|writer|written by|created by)\s*[:：]?\s*"
                      r"(?:Claude|Opus|Sonnet|Haiku|ChatGPT|GPT-?\d*|Gemini|Copilot)\b", re.I)
_ALT_TAG = re.compile(r"<(?:\w+:)?(?:cNvPr|docPr)\b[^>]*>")
_ALT_ATTR = re.compile(r'\b(descr|title)="([^"]*)"')
_PROP_ELEM = re.compile(r"<([\w:]+)[^>]*>([^<]+)</\1>")
_PARA = re.compile(r"<(a|w):p[ >/].*?</\1:p>", re.S)
_RUN_TEXT = re.compile(r"<(?:a|w):t\b[^>]*>([^<]*)</(?:a|w):t>")


def _strip(s, allow):
    """`s` without the names the user listed as their own skills (--allow "Claude Code,Codex")."""
    for a in allow:
        s = re.sub(re.escape(a), " ", s, flags=re.I)
    return s


_SENTENCE = re.compile(r".*?(?:[.!?。](?=\s|$)|\s[/|]\s|$)\s*", re.S)


def _sentences(s):
    """[(start, end)] of the sentences of `s`, each with the space after it: ends at . ! ? 。 before a
    space or the end, or at a ` / ` or ` | ` separator (one line holding several claims)."""
    out, i = [], 0
    while i < len(s):
        m = _SENTENCE.match(s, i)
        end = m.end() if m and m.end() > i else len(s)
        out.append((i, end))
        i = end
    return out


def _trace_spans(joined, allow):
    """[(start, end)] of every sentence of `joined` carrying an AI disclaimer or an AI-writing phrase,
    with the space after it (or the space and separator before it, for the last one)."""
    spans = []
    for a, b in _sentences(joined):
        sent = joined[a:b]
        if _DISCLAIMER.search(sent) or _PHRASES.search(_strip(sent, allow)):
            if b >= len(joined):   # the last sentence: take the separator before it instead
                while a > 0 and (joined[a - 1].isspace() or joined[a - 1] in "/|"):
                    a -= 1
            spans.append((a, b))
    return spans


def _cut_runs(para, spans):
    """`para` (one <a:p>/<w:p>) with the characters in `spans` (indices into its joined run text)
    taken out of the runs that hold them; markup and the other text untouched."""
    drop = set()
    for a, b in spans:
        drop.update(range(a, b))
    pos = 0

    def cut(m):
        nonlocal pos
        val = html.unescape(m.group(2))
        keep = "".join(c for k, c in enumerate(val, pos) if k not in drop)
        pos += len(val)
        return m.group(1) + html.escape(keep, quote=False) + m.group(3)
    return re.sub(r"(<(?:a|w):t\b[^>]*>)([^<]*)(</(?:a|w):t>)", cut, para)


def _scrub_prop(val):
    """A property value without AI tool or library names (and the brackets around them)."""
    for pat in (_TOOLS, _LIBS):
        val = re.sub(r"[\s(\[]*(?:%s)(?:[\s\d.]*)[)\]]*" % pat.pattern, " ", val, flags=re.I)
    return re.sub(r"\s{2,}", " ", val).strip(" -·,;:")


def ai_traces(path, fix=True, allow=()):
    """Scan every XML part of a pptx/docx and, when `fix`, take every AI trace out: an AI disclaimer in
    alt text (the rest of the alt text stays), an AI tool or library named in the document properties,
    and each sentence of visible text (slides, notes, body, headers) that says AI wrote it or may be
    wrong — a paragraph left empty goes with it. Names in `allow` are not counted as a tool or a writer.
    Returns {"removed": n, "removed_text": [str], "reported": [str]}; with fix=False nothing changes
    and everything found is in `reported`."""
    path = Path(path)
    removed, reported, changed, removed_text = 0, [], {}, []
    with zipfile.ZipFile(str(path)) as z:
        infos = z.infolist()
        data = {i.filename: z.read(i.filename) for i in infos}
    for name, raw in data.items():
        if not (name.endswith(".xml") or name.endswith(".rels")) or name == "[Content_Types].xml":
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        # (a) alt text
        def clean_tag(m):
            nonlocal removed
            def clean_attr(a):
                nonlocal removed
                val = html.unescape(a.group(2))
                hits = _DISCLAIMER.findall(val)
                if not hits:
                    return a.group(0)
                if not fix:
                    reported.append("%s: alt text carries an AI disclaimer: %s" % (name, val[:60]))
                    return a.group(0)
                removed += len(hits)
                left = re.sub(r"\s{2,}", " ", _DISCLAIMER.sub("", val)).strip()
                return '%s="%s"' % (a.group(1), html.escape(left, quote=True))
            return _ALT_ATTR.sub(clean_attr, m.group(0))
        new = _ALT_TAG.sub(clean_tag, text)
        # (b) properties: an AI tool or a library named in a value
        if name in ("docProps/app.xml", "docProps/core.xml"):
            def clean_prop(m):
                nonlocal removed
                val = html.unescape(m.group(2))
                if not (_TOOLS.search(_strip(val, allow)) or _LIBS.search(val)):
                    return m.group(0)
                if not fix:
                    reported.append("%s: <%s> names an AI tool or library: %s" % (name, m.group(1), val[:60]))
                    return m.group(0)
                removed += 1
                left = _scrub_prop(val)
                removed_text.append("%s <%s>: %s → %s" % (name, m.group(1), val[:60], left or "(빈 값)"))
                return m.group(0).replace(">%s<" % m.group(2), ">%s<" % html.escape(left, quote=False), 1)
            new = _PROP_ELEM.sub(clean_prop, new)
        # (c) visible text, per paragraph so a phrase split over runs is still seen
        if name.startswith(("ppt/slides/", "ppt/notesSlides/", "word/")) and "<" in new:
            def clean_para(p):
                nonlocal removed
                para = p.group(0)
                joined = html.unescape("".join(_RUN_TEXT.findall(para)))
                spans = _trace_spans(joined, allow)
                if not spans:
                    return para
                cut = "".join(joined[a:b] for a, b in spans).strip()
                if not fix:
                    reported.append("%s: visible text has an AI phrase: %r" % (name, cut[:60]))
                    return para
                removed += len(spans)
                removed_text.append("%s: %s" % (name, cut))
                para = _cut_runs(para, spans)
                rest = html.unescape("".join(_RUN_TEXT.findall(para))).strip()
                # an empty Word paragraph goes, unless it is a table cell's last one or holds a picture
                # or the section; an empty slide paragraph stays (a text box needs one) but is blank
                if not rest and para.startswith("<w:p") and not re.search(r"<w:sectPr|<w:drawing|<w:pict", para) \
                        and not new[p.end():p.end() + 7].startswith("</w:tc>"):
                    return ""
                return para
            new = _PARA.sub(clean_para, new)
        if new != text:
            changed[name] = new.encode("utf-8")
    if fix and changed:
        fd, tmp = tempfile.mkstemp(suffix=path.suffix, dir=str(path.parent))
        os.close(fd)
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for i in infos:
                zout.writestr(i, changed.get(i.filename, data[i.filename]))
        os.replace(tmp, str(path))
    return {"removed": removed, "removed_text": removed_text, "reported": reported}


# ── One check before anything is called submittable ──────────────────────────

FINAL_FILES = ("deck.pptx", "deck.pdf", "resume.docx", "resume.pdf")
_LIBS = re.compile(r"python-?docx|python-?pptx|Steve Canny|reportlab|\bfpdf2?\b|pypdf2?\b|weasyprint|"
                   r"docx2pdf", re.I)
_PDF_TOOLS = re.compile(r"\b(Copilot|ChatGPT|GPT-?\d*|OpenAI|Gemini|Claude|Anthropic|Codex)\b", re.I)
# work annotations: questions for the user, reported and kept (the AI-writer lines are in _PHRASES)
_NOTES = re.compile(r"\[확인 필요|\bTODO\b|\bFIXME\b|\(본인 확인|본인 확인 \d{4}-\d{2}-\d{2}", re.I)
_TEXT_PARTS = ("ppt/slides/", "ppt/notesSlides/", "word/")
_PDF_INFO = re.compile(rb"/(Author|Creator|Title|Producer|Subject|Keywords)\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)")
_CORE_WHO = (("dc", "creator"), ("cp", "lastModifiedBy"))


def _pdf_string(raw):
    if raw.startswith(b"<"):
        b = bytes.fromhex(re.sub(rb"\s", b"", raw[1:-1]).decode("ascii") or "")
    else:
        body = raw[1:-1]
        b = re.sub(rb"\\(?:([0-7]{1,3})|(.))",
                   lambda m: bytes([int(m.group(1), 8) & 255]) if m.group(1)
                   else {b"n": b"\n", b"r": b"\r", b"t": b"\t"}.get(m.group(2), m.group(2)), body, flags=re.S)
    if b.startswith(b"\xfe\xff"):
        return b[2:].decode("utf-16-be", "replace")
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1")


def _set_author(path, author):
    """dc:creator and cp:lastModifiedBy of a docx/pptx set to `author`. True when the file changed."""
    path = Path(path)
    with zipfile.ZipFile(str(path)) as z:
        infos = z.infolist()
        data = {i.filename: z.read(i.filename) for i in infos}
    core = data.get("docProps/core.xml")
    if core is None:
        return False
    text = core.decode("utf-8")
    new = text
    for pre, tag in _CORE_WHO:
        val = html.escape(author, quote=False)
        pat = re.compile(r"(<%s:%s\b[^>]*>)[^<]*(</%s:%s>)" % (pre, tag, pre, tag))
        if pat.search(new):
            new = pat.sub(lambda m: m.group(1) + val + m.group(2), new)
        elif "xmlns:%s=" % pre in new:
            new = re.sub(r"</(\w+:)?coreProperties>\s*$",
                         lambda m: "<%s:%s>%s</%s:%s></%s>" % (pre, tag, val, pre, tag,
                                                               (m.group(1) or "") + "coreProperties"), new)
    if new == text:
        return False
    data["docProps/core.xml"] = new.encode("utf-8")
    fd, tmp = tempfile.mkstemp(suffix=path.suffix, dir=str(path.parent))
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for i in infos:
            zout.writestr(i, data[i.filename])
    os.replace(tmp, str(path))
    return True


def _note_hits(joined):
    return [m.group(0) for m in _NOTES.finditer(joined)]


def _office_findings(path, allow, author):
    fixed = []
    if author and _set_author(path, author):
        fixed.append("작성자·마지막 수정자를 %s로 바꿈" % author)
    tr = ai_traces(path, fix=True, allow=allow)
    findings = list(tr["reported"])
    if tr["removed"]:
        fixed.append("AI 흔적 %d건 제거" % tr["removed"])
        fixed += ["  지움: %s" % t for t in tr["removed_text"]]
    with zipfile.ZipFile(str(path)) as z:
        for name in z.namelist():
            raw = z.read(name)
            if name in ("docProps/app.xml", "docProps/core.xml"):
                for tag, val in _PROP_ELEM.findall(raw.decode("utf-8", "replace")):
                    v = html.unescape(val)
                    if _LIBS.search(v):
                        findings.append("%s: <%s> names a library: %s" % (name, tag, v[:60]))
            elif name.startswith(_TEXT_PARTS) and name.endswith(".xml"):
                for p in _PARA.finditer(raw.decode("utf-8", "replace")):
                    joined = html.unescape("".join(_RUN_TEXT.findall(p.group(0))))
                    for hit in _note_hits(_strip(joined, allow)):
                        findings.append("%s: work annotation left in the text: %r in %r" % (name, hit, joined[:60]))
    return findings, fixed


_PDF_STREAM = re.compile(rb"/FlateDecode.{0,200}?stream\r?\n(.*?)endstream", re.S)
_XMP_FIELD = re.compile(r"<(dc:creator|dc:title|xmp:CreatorTool|pdf:Producer|pdf:Keywords)\b[^>]*>(.*?)</\1>", re.S)


def _pdf_bodies(data):
    """The file's bytes, then every Flate stream inflated: an Info dict inside a compressed object
    stream, and a compressed XMP packet, are only readable there."""
    out = [data]
    for m in _PDF_STREAM.finditer(data):
        try:
            out.append(zlib.decompressobj().decompress(m.group(1)))
        except zlib.error:
            pass
    return out


def _pdf_findings(path, allow):
    path = Path(path)
    findings = []
    bodies = _pdf_bodies(path.read_bytes())
    for body in bodies:
        for key, raw in _PDF_INFO.findall(body):
            val = _pdf_string(raw)
            k = key.decode()
            if _PDF_TOOLS.search(_strip(val, allow)) or _LIBS.search(val):
                findings.append("PDF %s names a tool or library: %s" % (k, val[:60]))
        if b"<x:xmpmeta" in body or b"<rdf:RDF" in body:
            for tag, val in _XMP_FIELD.findall(body.decode("utf-8", "replace")):
                v = html.unescape(re.sub(r"<[^>]+>", " ", val)).strip()
                if _PDF_TOOLS.search(_strip(v, allow)) or _LIBS.search(v):
                    findings.append("PDF XMP %s names a tool or library: %s" % (tag, re.sub(r"\s+", " ", v)[:60]))
    text = None
    if shutil.which("pdftotext"):
        r = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True)
        text = r.stdout if r.returncode == 0 else None
    else:
        rd = Renderer()
        if rd.available:
            text = rd.text(path.parent.resolve(), path.name)
    if text is None:
        findings.append("PDF text not checked: no pdftotext (install poppler or set DECK_RENDER_DOCKER)")
    else:
        flat = re.sub(r"\s+", " ", text)
        s = _strip(flat, allow)
        for m in list(_DISCLAIMER.finditer(flat)) + list(_PHRASES.finditer(s)) + list(_NOTES.finditer(s)):
            findings.append("PDF text: %r" % m.group(0)[:60])
    return list(dict.fromkeys(findings))   # the same Info value in two revisions, one phrase two patterns


def final_check(paths, allow=(), author=None):
    """The check before anything is called submittable. {path: {"findings": [str], "fixed": [str]}} for
    each existing file. Every AI trace is taken out of a docx/pptx (alt text, properties, visible
    sentences) and `author` (when given) is written into it; a PDF whose docx/pptx of the same name
    changed is rendered again from it, so its text and metadata are clean too. Work annotations
    ([확인 필요, TODO …) are questions for the user: reported, never deleted."""
    out, cleaned = {}, set()
    paths = sorted(map(Path, paths), key=lambda p: p.suffix.lower() == ".pdf")   # office files first
    for p in paths:
        if not p.is_file():
            continue
        try:
            if p.suffix.lower() == ".pdf":
                fixed = []
                src = next((s for s in cleaned if s.stem == p.stem and s.parent == p.parent), None)
                if src is not None:
                    rd = Renderer()
                    if rd.available:
                        rd.to_pdf(src.parent.resolve(), src.name)
                        fixed.append("%s에서 다시 렌더함" % src.name)
                findings = _pdf_findings(p, allow)
                if src is not None and not fixed:
                    findings.append("%s changed but no renderer: render %s again from it" % (src.name, p.name))
            else:
                findings, fixed = _office_findings(p, allow, author)
                if fixed:
                    cleaned.add(p)
        except (zipfile.BadZipFile, OSError) as e:
            findings, fixed = ["cannot be read: %s" % e], []
        out[str(p)] = {"findings": findings, "fixed": fixed}
    return out


def final_lines(result):
    """One verdict line per file, then its findings."""
    lines = []
    for p, r in result.items():
        note = " (%s)" % "; ".join(r["fixed"]) if r["fixed"] else ""
        lines.append("%s: %s%s" % (Path(p).name, "깨끗함" if not r["findings"] else "%d건" % len(r["findings"]), note))
        lines += ["  - " + f for f in r["findings"]]
    return lines


def cmd_final_check(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="office_render.py final-check")
    ap.add_argument("--dir", default="build")
    ap.add_argument("--allow", default="", help='names that are your own skills, e.g. "Claude Code,Codex"')
    ap.add_argument("--author")
    a = ap.parse_args(argv)
    allow = [x.strip() for x in a.allow.split(",") if x.strip()]
    res = final_check([Path(a.dir) / n for n in FINAL_FILES], allow, a.author)
    if not res:
        print("검사할 파일 없음: %s 에 %s 가 없습니다" % (a.dir, ", ".join(FINAL_FILES)))
        return 1
    print("\n".join(final_lines(res)))
    return 1 if any(r["findings"] for r in res.values()) else 0


def main(argv):
    if len(argv) >= 2 and argv[0] == "ai-traces":
        return ai_traces(argv[1], fix="--report-only" not in argv)
    if len(argv) >= 2 and argv[0] == "margins":
        pdf = Path(argv[1]).resolve()
        # --margin wins; else the workspace's style/레이아웃.md (the pdf sits in <workspace>/build/); else 28
        area = None if "--margin" in argv else (safe_area(pdf.parent.parent) or safe_area(pdf.parent))
        margin = float(argv[argv.index("--margin") + 1]) if "--margin" in argv else (area or 28.0)
        r = Renderer()
        if not r.available:
            return {"error": "no renderer (pdftotext runs through it): install LibreOffice or set DECK_RENDER_DOCKER"}
        box = r.bbox(pdf.parent, pdf.name)
        if box is None:
            return {"error": "no pdftotext"}
        hits = margin_crossers(box, margin)
        return {"margin_pt": margin, "pages": sorted({h[0] for h in hits}),
                "hits": [{"page": p, "side": s, "text": t} for p, s, t in hits]}
    return {"error": "usage: office_render.py ai-traces <file> [--report-only] | margins <pdf> [--margin pt] | final-check [--dir build] [--allow names] [--author NAME]"}


if __name__ == "__main__":
    if sys.argv[1:2] == ["final-check"]:
        sys.exit(cmd_final_check(sys.argv[2:]))
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
