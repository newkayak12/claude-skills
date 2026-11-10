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
import uuid
import xml.etree.ElementTree as ET
import zipfile
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

    def previews(self, workdir, pdf, dpi=72):
        self.sh(workdir, "command -v pdftoppm >/dev/null || exit 0; mkdir -p pages && "
                         "pdftoppm -r %d -png %s pages/p && chmod -R a+rwX pages"
                % (dpi, pdf))
        d = Path(workdir) / "pages"
        return sorted(d.glob("p*.png")) if d.is_dir() else []


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


def margin_crossers(xml_text, margin=28.0):
    """[(page, side, text)] for every text line whose box leaves the page inset by `margin` pt."""
    hits = []
    for n, (pw, ph, blocks) in enumerate(bbox_pages(xml_text), 1):
        for lines in blocks:
            for (x0, y0, x1, y1), text in lines:
                for side, bad in (("left", x0 < margin), ("right", x1 > pw - margin),
                                  ("top", y0 < margin), ("bottom", y1 > ph - margin)):
                    if bad:
                        hits.append((n, side, text[:60]))
    return hits


# ── The last check: traces of AI in a built pptx / docx ──────────────────────

DISCLAIMERS = [
    r"AI-generated content may be incorrect\.?",
    # Korean builds word it several ways: AI 생성 / AI가 생성한 / AI에서 생성된 / AI로 생성된 …
    r"AI\s?(?:가|에서|로|에 의해)?\s?생성(?:한|된|)\s?(?:콘텐츠|내용|컨텐츠)(?:는|은)\s?(?:정확하지 않을|부정확할|틀릴)\s?수\s?있습니다\.?",
]
_DISCLAIMER = re.compile("|".join(DISCLAIMERS), re.I)
_TOOLS = re.compile(r"\b(Copilot|ChatGPT|GPT-?\d*|OpenAI|Gemini|Claude|Anthropic)\b", re.I)
_PHRASES = re.compile(r"As an AI\b|AI가 생성|AI로 생성|생성형 ?AI로 (?:작성|생성)|AI로 작성|"
                      r"(?:ChatGPT|Copilot|Gemini|Claude|GPT-?\d*)\s?(?:로|으로|를 (?:사용|이용|활용)해서?|의 도움으로)\s?(?:작성|생성)|"
                      r"(?:generated|written|created) (?:by|with) (?:an? )?(?:AI|ChatGPT|Copilot|Gemini|Claude)\b", re.I)
_ALT_TAG = re.compile(r"<(?:\w+:)?(?:cNvPr|docPr)\b[^>]*>")
_ALT_ATTR = re.compile(r'\b(descr|title)="([^"]*)"')
_PROP_ELEM = re.compile(r"<([\w:]+)[^>]*>([^<]+)</\1>")
_PARA = re.compile(r"<(a|w):p[ >/].*?</\1:p>", re.S)
_RUN_TEXT = re.compile(r"<(?:a|w):t\b[^>]*>([^<]*)</(?:a|w):t>")


def ai_traces(path, fix=True):
    """Scan every XML part of a pptx/docx. Alt text carrying an AI disclaimer is cleaned (the rest of
    the alt text stays) when `fix`; a tool named in the document properties and an AI phrase in visible
    text are only reported, never deleted. Returns {"removed": n, "reported": [str]}."""
    path = Path(path)
    removed, reported, changed = 0, [], {}
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
        if new != text:
            changed[name] = new.encode("utf-8")
        # (b) properties
        if name in ("docProps/app.xml", "docProps/core.xml"):
            for tag, val in _PROP_ELEM.findall(text):
                if _TOOLS.search(val):
                    reported.append("%s: <%s> names an AI tool: %s" % (name, tag, html.unescape(val)[:60]))
        # (c) visible text, per paragraph so a phrase split over runs is still seen
        if name.startswith(("ppt/slides/", "ppt/notesSlides/", "word/")) and "<" in new:
            for p in _PARA.finditer(new):
                joined = html.unescape("".join(_RUN_TEXT.findall(p.group(0))))
                m = _DISCLAIMER.search(joined) or _PHRASES.search(joined)
                if m:
                    reported.append("%s: visible text has an AI phrase: %r" % (name, joined[:60]))
    if fix and changed:
        fd, tmp = tempfile.mkstemp(suffix=path.suffix, dir=str(path.parent))
        os.close(fd)
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for i in infos:
                zout.writestr(i, changed.get(i.filename, data[i.filename]))
        os.replace(tmp, str(path))
    return {"removed": removed, "reported": reported}


def main(argv):
    if len(argv) >= 2 and argv[0] == "ai-traces":
        return ai_traces(argv[1], fix="--report-only" not in argv)
    if len(argv) >= 2 and argv[0] == "margins":
        margin = float(argv[argv.index("--margin") + 1]) if "--margin" in argv else 28.0
        pdf = Path(argv[1]).resolve()
        r = Renderer()
        if not r.available:
            return {"error": "no renderer (pdftotext runs through it): install LibreOffice or set DECK_RENDER_DOCKER"}
        box = r.bbox(pdf.parent, pdf.name)
        if box is None:
            return {"error": "no pdftotext"}
        hits = margin_crossers(box, margin)
        return {"margin_pt": margin, "pages": sorted({h[0] for h in hits}),
                "hits": [{"page": p, "side": s, "text": t} for p, s, t in hits]}
    return {"error": "usage: office_render.py ai-traces <file> [--report-only] | margins <pdf> [--margin pt]"}


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
