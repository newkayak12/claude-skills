#!/usr/bin/env python3
"""Shared by deck-builder (pptx) and resume-builder (docx): the renderer and the final checks.

  Renderer      LibreOffice on PATH, else a container (DECK_RENDER_DOCKER=<image>), else the copy
                install-renderer cached
  bbox_pages    pdftotext -bbox-layout output -> pages of text lines with their boxes
  margin_crossers   lines whose box leaves a page margin (the safe area)
  ai_traces     the last check of a built pptx/docx: AI disclaimers left in alt text, AI tools named
                in the document properties, AI phrases in the visible text

Command line (one JSON object each):
  office_render.py install-renderer [--yes]   unpack a pinned LibreOffice into ~/.cache, no root
                                              (without --yes: says what it would do, exits 1)
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


# ── A renderer for a machine with none: LibreOffice's own debs, unpacked without root ────────

LO_VERSION = "26.8.3"
LO_URL = ("https://download.documentfoundation.org/libreoffice/stable/%s/deb/x86_64/"
          "LibreOffice_%s_Linux_x86-64_deb.tar.gz" % (LO_VERSION, LO_VERSION))
LO_SHA256 = "e7cd3538e85818ff9dd9bb65386769fde927011242aace5a144989f4000dcabf"
LO_SIZE = 221377373
SELF = Path(__file__).resolve()
NO_RENDERER = ("install LibreOffice (soffice on PATH), run `python3 %s install-renderer` "
               "(the person is asked first), or set DECK_RENDER_DOCKER=<image>" % SELF)
_SKIP_DEBS = ("desktop-integration", "-menus", "debian-menus")


def cache_dir(version=None):
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "claude-portfolio" / "libreoffice" / (version or LO_VERSION)


def cached_soffice(version=None):
    """The soffice of a finished install-renderer, or None (a half-done unpack has no marker)."""
    d = cache_dir(version)
    if not (d / ".installed").is_file():
        return None
    hits = sorted((d / "root" / "opt").glob("libreoffice*/program/soffice"))
    return hits[0] if hits and os.access(hits[0], os.X_OK) else None


class _Slice:
    """Read-only window on an open file: one ar member, handed to tarfile as a stream."""

    def __init__(self, f, size):
        self.f, self.left = f, size

    def read(self, n=-1):
        n = self.left if n is None or n < 0 else min(n, self.left)
        b = self.f.read(n)
        self.left -= len(b)
        return b


def _unpack_deb(deb, root):
    """Extract the /opt files of a .deb (ar of control.tar + data.tar.xz|gz) under `root`."""
    import tarfile
    with open(str(deb), "rb") as f:
        if f.read(8) != b"!<arch>\n":
            raise ValueError("%s is not a deb" % Path(deb).name)
        while True:
            h = f.read(60)
            if len(h) < 60:
                raise ValueError("%s has no data.tar" % Path(deb).name)
            name, size = h[:16].decode().strip().rstrip("/"), int(h[48:58])
            if not name.startswith("data.tar"):
                f.seek(size + size % 2, 1)
                continue
            if name.endswith(".zst"):
                raise ValueError("%s: zstd debs need dpkg-deb" % Path(deb).name)
            with tarfile.open(fileobj=_Slice(f, size), mode="r|" + ("xz" if name.endswith(".xz") else "gz")) as t:
                for m in t:
                    parts = Path(m.name).parts
                    if parts and parts[0] == ".":
                        parts = parts[1:]
                    if not parts or parts[0] != "opt" or ".." in parts:
                        continue
                    m.name = "/".join(parts)
                    m.mode |= 0o200
                    try:
                        t.extract(m, str(root), filter="fully_trusted")
                    except TypeError:
                        t.extract(m, str(root))
            return


def _download(url, dest, sha256, log):
    import hashlib
    import urllib.request
    h, got = hashlib.sha256(), 0
    last = 0
    with urllib.request.urlopen(url, timeout=60) as r, open(str(dest), "wb") as out:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            out.write(b)
            h.update(b)
            got += len(b)
            if got - last >= 20 << 20:
                last = got
                log("  %d MB" % (got >> 20))
    if h.hexdigest() != sha256:
        Path(dest).unlink()
        raise ValueError("sha256 mismatch: got %s, expected %s — nothing was installed" % (h.hexdigest(), sha256))


def install_renderer(yes=False, url=None, sha256=None, version=None, size=None, log=print):
    """Download the pinned LibreOffice debs into the per-user cache, check the SHA-256, unpack them
    without root. Returns (exit code, message). Without `yes` nothing is downloaded."""
    url, sha256, version = url or LO_URL, sha256 or LO_SHA256, version or LO_VERSION
    size = LO_SIZE if size is None else size
    if sys.platform == "darwin":
        return 1, ("macOS: install LibreOffice from libreoffice.org (the dmg), or set "
                   "DECK_RENDER_DOCKER=<image>; install-renderer unpacks Linux x86_64 builds only")
    if not (sys.platform.startswith("linux") and os.uname().machine in ("x86_64", "amd64")):
        return 1, "install-renderer supports Linux x86_64 only: install LibreOffice or set DECK_RENDER_DOCKER=<image>"
    dest = cache_dir(version)
    have = cached_soffice(version)
    if have:
        return 0, "already installed: %s" % have
    if not yes:
        return 1, ("install-renderer will download LibreOffice %s (%d MB) from\n  %s\n"
                   "check its SHA-256 and unpack it, no root needed, into\n  %s (about 1 GB on disk).\n"
                   "Nothing was downloaded. Run again with --yes to do it."
                   % (version, size >> 20, url, dest))
    dest.mkdir(parents=True, exist_ok=True)
    tgz = dest / "download.tar.gz"
    log("downloading %s" % url)
    try:
        _download(url, tgz, sha256, log)
    except (ValueError, OSError) as e:
        tgz.unlink(missing_ok=True)
        return 1, "download failed: %s" % e
    import tarfile
    work = dest / "debs"
    root = dest / "root"
    shutil.rmtree(str(work), ignore_errors=True)
    shutil.rmtree(str(root), ignore_errors=True)
    root.mkdir()
    try:
        with tarfile.open(str(tgz)) as t:
            members = [m for m in t.getmembers() if m.isfile() and m.name.endswith(".deb")
                       and not any(s in m.name for s in _SKIP_DEBS)]
            for m in members:
                m.name = Path(m.name).name
                try:
                    t.extract(m, str(work), filter="data")
                except TypeError:
                    t.extract(m, str(work))
        debs = sorted(work.glob("*.deb"))
        for i, d in enumerate(debs, 1):
            log("unpacking %d/%d %s" % (i, len(debs), d.name))
            _unpack_deb(d, root)
    except (ValueError, OSError, tarfile.TarError) as e:
        return 1, "unpack failed: %s" % e
    finally:
        shutil.rmtree(str(work), ignore_errors=True)
        tgz.unlink(missing_ok=True)
    (dest / ".installed").write_text(sha256 + "\n")
    got = cached_soffice(version)
    if not got:
        return 1, "unpacked, but no executable soffice under %s" % (root / "opt")
    return 0, "installed: %s" % got


# PyMuPDF: page previews, PDF text and line boxes on a machine with no poppler. One abi3 wheel
# (CPython 3.11+, manylinux_2_28 x86_64) unpacked with zipfile — nothing goes into site-packages.
MUPDF_VERSION = "2.1"
MUPDF_URL = ("https://files.pythonhosted.org/packages/f4/dc/e244c162ab621a45bfe36e33fe432264ef7e40592f739474864df66a2dd8/"
             "pymupdf-2.1-cp311-abi3-manylinux_2_28_x86_64.whl")
MUPDF_SHA256 = "a9efa2e9e5f469d3b5749199329739cfef1ff1d1846538ced4885c544eecbcd9"
MUPDF_SIZE = 68983787


def pylib_dir():
    return cache_dir() / "pylib"


def install_pymupdf(yes=False, url=None, sha256=None, size=None, version=None, log=print):
    """Download the pinned PyMuPDF wheel into <cache>/wheels, check its SHA-256, unpack it into
    <cache>/pylib. Returns (exit code, message)."""
    url, sha256 = url or MUPDF_URL, sha256 or MUPDF_SHA256
    size = MUPDF_SIZE if size is None else size
    version = version or MUPDF_VERSION
    lib = pylib_dir()
    if (lib / ".installed").is_file():
        return 0, "PyMuPDF already installed: %s" % lib
    if sys.version_info < (3, 11):
        return 1, ("PyMuPDF: the pinned wheel is for Python 3.11+, this is %d.%d — "
                   "install poppler (pdftotext, pdftoppm) instead" % sys.version_info[:2])
    if not (sys.platform.startswith("linux") and os.uname().machine in ("x86_64", "amd64")):
        return 1, "PyMuPDF: the pinned wheel is Linux x86_64 only — install poppler instead"
    if not yes:
        return 1, ("install-renderer will also download PyMuPDF %s (%d MB) from\n  %s\n"
                   "check its SHA-256 and unpack it into\n  %s\n(page previews, PDF text and line boxes "
                   "where poppler is missing). Nothing was downloaded; run with --yes." % (version, size >> 20, url, lib))
    wheels = cache_dir() / "wheels"
    wheels.mkdir(parents=True, exist_ok=True)
    whl = wheels / Path(url).name
    log("downloading %s" % url)
    try:
        _download(url, whl, sha256, log)
        shutil.rmtree(str(lib), ignore_errors=True)
        lib.mkdir(parents=True)
        with zipfile.ZipFile(str(whl)) as z:
            for n in z.namelist():
                if n.startswith("/") or ".." in Path(n).parts:
                    raise ValueError("unsafe path in the wheel: %s" % n)
            z.extractall(str(lib))
    except (ValueError, OSError, zipfile.BadZipFile) as e:
        whl.unlink(missing_ok=True)
        return 1, "PyMuPDF install failed: %s" % e
    whl.unlink(missing_ok=True)
    (lib / ".installed").write_text(sha256 + "\n")
    return 0, "installed PyMuPDF: %s" % lib


def mupdf_module():
    """The `pymupdf` module from <cache>/pylib, or None. The directory is on sys.path only while
    it is imported."""
    lib = pylib_dir()
    if not (lib / ".installed").is_file():
        return None
    m = sys.modules.get("pymupdf")
    if m is None or not str(getattr(m, "__file__", "") or "").startswith(str(lib)):
        sys.modules.pop("pymupdf", None)
        sys.path.insert(0, str(lib))
        try:
            import pymupdf as m
        except ImportError:
            return None
        finally:
            sys.path.remove(str(lib))
    return m


def mupdf_pages(doc):
    """[(page_w, page_h, blocks)] — what bbox_pages returns — from an open PyMuPDF document:
    each text line of page.get_text("dict") is ((x0, y0, x1, y1), text), spaces collapsed."""
    out = []
    for page in doc:
        d = page.get_text("dict")
        blocks = []
        for b in d.get("blocks", []):
            if b.get("type", 0) != 0:
                continue
            lines = []
            for ln in b.get("lines", []):
                text = " ".join("".join(s.get("text", "") for s in ln.get("spans", [])).split())
                if not text:
                    continue
                box = tuple(float(v) for v in ln["bbox"])
                if lines:   # PyMuPDF cuts a visual line at each gap; pdftotext keeps it whole
                    (a0, b0, a1, b1), prev = lines[-1]
                    h1, h2 = b1 - b0, box[3] - box[1]
                    # one baseline, a word-gap apart, about the same size (a big figure beside body text is its own line)
                    if (min(b1, box[3]) - max(b0, box[1]) >= 0.5 * min(h1, h2) and min(h1, h2) >= 0.6 * max(h1, h2)
                            and box[0] - a1 <= min(h1, h2) and box[0] >= a0):
                        lines[-1] = ((min(a0, box[0]), min(b0, box[1]), max(a1, box[2]), max(b1, box[3])),
                                     prev + " " + text)
                        continue
                lines.append((box, text))
            if lines:
                blocks.append(lines)
        out.append((float(d["width"]), float(d["height"]), blocks))
    return out


def pages_to_xml(pages):
    """A pdftotext -bbox-layout document for `pages`, so every reader of bbox_pages works unchanged
    (a line's words all carry the line's box; readers take the line's min/max)."""
    from xml.sax.saxutils import escape
    parts = ['<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><doc>']
    for pw, ph, blocks in pages:
        parts.append('<page width="%r" height="%r"><flow>' % (pw, ph))
        for lines in blocks:
            parts.append("<block>")
            for (x0, y0, x1, y1), text in lines:
                parts.append('<line>')
                for w in text.split():
                    parts.append('<word xMin="%r" yMin="%r" xMax="%r" yMax="%r">%s</word>'
                                 % (x0, y0, x1, y1, escape(w)))
                parts.append("</line>")
            parts.append("</block>")
        parts.append("</flow></page>")
    parts.append("</doc></body></html>")
    return "".join(parts)


def cmd_install_renderer(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="office_render.py install-renderer")
    ap.add_argument("--yes", action="store_true", help="the person agreed: download and unpack")
    a = ap.parse_args(argv)
    rc, msg = install_renderer(yes=a.yes)
    print(msg, file=sys.stderr if rc else sys.stdout)
    rc2, msg2 = install_pymupdf(yes=a.yes)
    print(msg2, file=sys.stderr if rc2 else sys.stdout)
    return rc or rc2


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
    """LibreOffice: on PATH, else in the container DECK_RENDER_DOCKER=<image> names, else the copy
    `install-renderer` unpacked.

    A container's daemon (a snap one, for
    instance) may bind-mount only paths under $HOME, so a work dir elsewhere is staged into a
    fresh dir under ~/.cache/portfolio-render/, rendered there, the changed files copied back and
    the stage deleted. Files the container writes end up owned by the host user.
    """

    def __init__(self):
        self.image = os.environ.get("DECK_RENDER_DOCKER")
        # soffice on PATH, then a container the person named (DECK_RENDER_DOCKER is a choice, so it
        # wins over the cache), then the install-renderer cache
        self.cached = None
        self.local = shutil.which("soffice") or shutil.which("libreoffice")
        if not self.local and not (self.image and shutil.which("docker")):
            self.cached = cached_soffice()
            self.local = str(self.cached) if self.cached else None
        self.available = bool(self.local or (self.image and shutil.which("docker")))

    def describe(self):
        if self.cached:
            return "%s (LibreOffice %s from install-renderer)" % (self.local, LO_VERSION)
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
        if self.cached:   # the cached soffice is not on PATH; its own python is told where it is
            prog = str(self.cached.parent)
            env["PATH"] = prog + os.pathsep + env.get("PATH", "")
            env["LO_PROGRAM"] = prog
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
            body = ("PY=; for p in ${LO_PROGRAM:+$LO_PROGRAM/python} python3 /usr/lib/libreoffice/program/python "
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

    def _mupdf(self, tool):
        """PyMuPDF (from install-renderer's pylib) when this renderer runs on the host and poppler's
        `tool` is not on its PATH; else None. A container keeps its own poppler."""
        if not self.local or shutil.which(tool, path=self._fc_env().get("PATH")):
            return None
        return mupdf_module()

    def bbox(self, workdir, pdf):
        m = self._mupdf("pdftotext")
        if m:
            with m.open(str(Path(workdir) / pdf)) as doc:
                return pages_to_xml(mupdf_pages(doc))
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
        m = self._mupdf("pdftoppm")
        if m:
            d = Path(workdir) / "pages"
            d.mkdir(exist_ok=True)
            for old in d.glob(prefix + "*.png"):
                old.unlink()
            with m.open(str(Path(workdir) / pdf)) as doc:
                width = len(str(doc.page_count))   # pdftoppm pads the page number to the page count
                for i, page in enumerate(doc, 1):
                    page.get_pixmap(dpi=dpi).save(str(d / ("%s-%0*d.png" % (prefix, width, i))))
            return sorted(d.glob(prefix + "*.png"))
        self.sh(workdir, "command -v pdftoppm >/dev/null || exit 0; mkdir -p pages && "
                         "rm -f pages/%s*.png && "
                         "pdftoppm -r %d -png %s pages/%s && chmod -R a+rwX pages"
                % (prefix, dpi, pdf, prefix))
        d = Path(workdir) / "pages"
        return sorted(d.glob(prefix + "*.png")) if d.is_dir() else []

    def text(self, workdir, pdf):
        """The PDF's text (pdftotext, else PyMuPDF), or None when neither is there."""
        m = self._mupdf("pdftotext")
        if m:
            with m.open(str(Path(workdir) / pdf)) as doc:
                return "\f".join(p.get_text() for p in doc)
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
_CORE_NEW = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.'
             'openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
             '<dc:creator></dc:creator><cp:lastModifiedBy></cp:lastModifiedBy></cp:coreProperties>')


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
        # a file saved without document properties gets them, so the author is written all the same
        core = _CORE_NEW.encode("utf-8")
        rels = data.get("_rels/.rels", b"").decode("utf-8")
        types = data.get("[Content_Types].xml", b"").decode("utf-8")
        if "</Relationships>" not in rels or "</Types>" not in types:
            return False
        data["_rels/.rels"] = rels.replace("</Relationships>", '<Relationship Id="rIdCoreProps" Type="http://schemas.'
                                           'openxmlformats.org/package/2006/relationships/metadata/core-properties" '
                                           'Target="docProps/core.xml"/></Relationships>').encode("utf-8")
        data["[Content_Types].xml"] = types.replace("</Types>", '<Override PartName="/docProps/core.xml" ContentType='
                                                    '"application/vnd.openxmlformats-package.core-properties+xml"/>'
                                                    '</Types>').encode("utf-8")
        infos = infos + [zipfile.ZipInfo("docProps/core.xml", date_time=infos[0].date_time)]
        infos[-1].compress_type = zipfile.ZIP_DEFLATED
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
        elif mupdf_module():   # no renderer here, but the PDF can still be read
            with mupdf_module().open(str(path)) as doc:
                text = "\f".join(p.get_text() for p in doc)
    if text is None:
        findings.append("PDF text not checked: no pdftotext (install poppler, or %s)" % NO_RENDERER)
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
            return {"error": "no renderer (pdftotext runs through it): " + NO_RENDERER}
        box = r.bbox(pdf.parent, pdf.name)
        if box is None:
            return {"error": "no pdftotext and no PyMuPDF: install poppler or run install-renderer --yes"}
        hits = margin_crossers(box, margin)
        return {"margin_pt": margin, "pages": sorted({h[0] for h in hits}),
                "hits": [{"page": p, "side": s, "text": t} for p, s, t in hits]}
    return {"error": "usage: office_render.py ai-traces <file> [--report-only] | margins <pdf> [--margin pt] | final-check [--dir build] [--allow names] [--author NAME]"}


if __name__ == "__main__":
    if sys.argv[1:2] == ["final-check"]:
        sys.exit(cmd_final_check(sys.argv[2:]))
    if sys.argv[1:2] == ["install-renderer"]:
        sys.exit(cmd_install_renderer(sys.argv[2:]))
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
