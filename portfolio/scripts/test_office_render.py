#!/usr/bin/env python3
"""Tests for office_render.py. Every fixture is fictional and built in a temp dir.

    python3 test_office_render.py      (the render part runs when a renderer is available;
                                         DECK_RENDER_DOCKER=<image> also proves the staging from /tmp)
"""
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import office_render as o  # noqa: E402

FAILED = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILED.append(label)


A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
APP = '<Properties><Application>%s</Application></Properties>'


def pptx(path, descr, visible="가상 발표", app="Microsoft Office PowerPoint"):
    slide = ('<p:sld %s><p:cSld><p:spTree>'
             '<p:pic><p:nvPicPr><p:cNvPr id="4" name="그림 3" descr="%s"/></p:nvPicPr></p:pic>'
             '<p:sp><p:txBody><a:p><a:r><a:t>%s</a:t></a:r></a:p></p:txBody></p:sp>'
             '</p:spTree></p:cSld></p:sld>' % (A, descr, visible))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/slides/slide1.xml", slide)
        z.writestr("docProps/app.xml", APP % app)
        z.writestr("ppt/media/image1.png", b"\x89PNG not xml AI-generated content may be incorrect.")


def docx(path, descr, visible="가상 이력서", app="Microsoft Office Word"):
    doc = ('<w:document %s xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>'
           '<w:p><w:r><w:drawing><wp:anchor><wp:docPr id="1" name="사진" title="%s"/></wp:anchor></w:drawing></w:r></w:p>'
           '<w:p><w:r><w:t>%s</w:t></w:r></w:p></w:body></w:document>' % (W, descr, visible))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                   'Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", doc)
        z.writestr("docProps/app.xml", APP % app)


def read(path, name):
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode("utf-8")


CORE = ('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>%s</dc:title><dc:creator>%s</dc:creator>'
        '<cp:lastModifiedBy>%s</cp:lastModifiedBy></cp:coreProperties>')


def add_core(path, title="가상 문서", creator="홍길동", last="홍길동"):
    with zipfile.ZipFile(path) as z:
        parts = [(i, z.read(i.filename)) for i in z.infolist() if i.filename != "docProps/core.xml"]
    with zipfile.ZipFile(path, "w") as z:
        for i, d in parts:
            z.writestr(i, d)
        z.writestr("docProps/core.xml", CORE % (title, creator, last))


def pdf(path, text="가상 이력서", producer="LibreOffice 7.6", creator="Writer", title="가상 이력서"):
    body = b"BT /F1 12 Tf 72 700 Td (" + text.encode("ascii", "ignore") + b") Tj ET"
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            b"/Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Producer (%s) /Creator (%s) /Title <FEFF%s> >>"
            % (producer.encode(), creator.encode(), title.encode("utf-16-be").hex().upper().encode())]
    out = b"%PDF-1.4\n"
    for n, o in enumerate(objs, 1):
        out += b"%d 0 obj\n" % n + o + b"\nendobj\n"
    out += b"trailer\n<< /Root 1 0 R /Info 6 0 R /Size 7 >>\n%%EOF\n"
    Path(path).write_bytes(out)


def final_check_tests(t):
    print("final-check")
    d = t / "fc"
    d.mkdir()
    f = {n: d / n for n in o.FINAL_FILES}

    def run(**kw):
        return o.final_check(list(f.values()), **kw)

    def of(res, name):
        return res[str(f[name])]["findings"]

    pptx(f["deck.pptx"], "가상 로고. AI-generated content may be incorrect.", visible="가상 발표")
    add_core(f["deck.pptx"])
    docx(f["resume.docx"], "가상 사진", visible="가상 이력서")
    add_core(f["resume.docx"])
    pdf(f["resume.pdf"])
    res = run()
    check(set(res) == {str(f["deck.pptx"]), str(f["resume.docx"]), str(f["resume.pdf"])},
          "only the files that exist are checked (deck.pdf is absent)")
    check(of(res, "deck.pptx") == [] and res[str(f["deck.pptx"])]["fixed"], "pptx: the alt-text disclaimer is removed, no finding left")
    check(of(res, "resume.docx") == [], "a clean docx has no finding")
    check(not any("PDF" in x and ("Producer" in x or "Creator" in x or "Title" in x) for x in of(res, "resume.pdf")),
          "a LibreOffice PDF Producer/Creator and a Hangul Title are fine — %s" % of(res, "resume.pdf"))
    lines = o.final_lines({k: v for k, v in res.items() if k.endswith(".docx")})
    check(lines == ["resume.docx: 깨끗함"], "one verdict line per file — %s" % lines)

    print("  document properties")
    add_core(f["resume.docx"], title="이력서 (ChatGPT)", creator="python-docx", last="python-docx")
    pptx(f["deck.pptx"], "가상 로고", app="python-pptx")
    add_core(f["deck.pptx"], creator="Steve Canny")
    res = run()
    core = read(f["resume.docx"], "docProps/core.xml")
    check(of(res, "resume.docx") == [] and "<dc:title>이력서</dc:title>" in core and "python-docx" not in core,
          "docx: the AI tool leaves the title and the library leaves creator and last editor — %s" % core)
    check(of(res, "deck.pptx") == [] and "python-pptx" not in read(f["deck.pptx"], "docProps/app.xml")
          and "Steve Canny" not in read(f["deck.pptx"], "docProps/core.xml"), "pptx: python-pptx as Application and the library author go")
    check(any("python-docx" in x for x in res[str(f["resume.docx"])]["fixed"]), "the verdict lists what was taken out")
    add_core(f["resume.docx"], title="이력서", creator="python-docx", last="python-docx")
    res = run(author="홍길동")
    check("<dc:creator>홍길동</dc:creator>" in read(f["resume.docx"], "docProps/core.xml")
          and "<cp:lastModifiedBy>홍길동</cp:lastModifiedBy>" in read(f["resume.docx"], "docProps/core.xml"),
          "--author sets dc:creator and lastModifiedBy")

    print("  work annotations")
    docx(f["resume.docx"], "가상 사진",
         visible="원인은 [확인 필요: 측정 기준] / TODO 수치 / (본인 확인 2026-11-01) / Generated with X")
    add_core(f["resume.docx"])
    got = of(run(), "resume.docx")
    doc = read(f["resume.docx"], "word/document.xml")
    check(len(got) == 3, "[확인 필요, TODO, (본인 확인 are each reported — %s" % got)
    check("[확인 필요: 측정 기준]" in doc and "TODO 수치" in doc and "Generated with" not in doc,
          "annotations stay for the user; the 'Generated with' line goes — %s" % doc[-140:])
    pptx(f["deck.pptx"], "가상 로고", visible="Co-Authored-By: someone", app="Microsoft Office PowerPoint")
    add_core(f["deck.pptx"])
    with zipfile.ZipFile(f["deck.pptx"]) as z:
        parts = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(f["deck.pptx"], "w") as z:
        for i, dat in parts:
            z.writestr(i, dat)
        z.writestr("ppt/notesSlides/notesSlide1.xml",
                   '<p:notes %s><a:p><a:r><a:t>FIXME 가상 노트</a:t></a:r></a:p></p:notes>' % A)
    got = of(run(), "deck.pptx")
    check(len(got) == 1 and "notesSlide" in got[0] and "Co-Authored-By" not in read(f["deck.pptx"], "ppt/slides/slide1.xml"),
          "speaker notes are scanned (FIXME kept, reported); the Co-Authored-By line on the slide goes — %s" % got)
    docx(f["resume.docx"], "가상 사진", visible="작성자: Claude Opus")
    add_core(f["resume.docx"])
    check(of(run(), "resume.docx") == [] and "Claude" not in read(f["resume.docx"], "word/document.xml"), "a model named as the writer goes")

    print("  --allow")
    docx(f["resume.docx"], "가상 사진", visible="Claude Code로 작성 · Codex를 사용해 작성")
    add_core(f["resume.docx"], title="Claude Code 활용기")
    run(allow=["Claude Code", "Codex"])
    check("Claude Code로 작성" in read(f["resume.docx"], "word/document.xml") and "Claude Code 활용기" in read(f["resume.docx"], "docProps/core.xml"),
          "names the user lists as their own skills are left in place")
    docx(f["resume.docx"], "가상 사진", visible="Claude Code 플러그인을 만들었다. 이 문서는 ChatGPT로 작성되었습니다.")
    add_core(f["resume.docx"])
    run(allow=["Claude Code", "Codex"])
    doc = read(f["resume.docx"], "word/document.xml")
    check("ChatGPT" not in doc and "Claude Code 플러그인을 만들었다." in doc, "--allow does not keep another tool as the writer")

    print("  pdf")
    pdf(f["resume.pdf"], producer="python-docx 1.1", creator="Claude Code", title="가상")
    got = of(run(), "resume.pdf")
    check(sum("Producer" in x for x in got) == 1 and sum("Creator" in x for x in got) == 1, "PDF Producer (library) and Creator (AI tool) are reported — %s" % got)
    check(not [x for x in of(run(allow=["Claude Code"]), "resume.pdf") if "Creator" in x], "--allow applies to the PDF Creator")
    pdf(f["resume.pdf"], text="TODO fix this. Generated with Claude")
    r = o.Renderer()
    got = of(run(), "resume.pdf")
    # pdftotext is the host's (poppler) or the container image's; else the cached PyMuPDF reads it
    if (r.available and not r.local) or shutil.which("pdftotext") or o.mupdf_module():
        check(any("TODO" in x for x in got) and any("Generated with" in x for x in got), "PDF text is scanned for annotations — %s" % got)
    else:
        check(any("not checked" in x for x in got), "with no pdftotext the PDF text is said to be unchecked — %s" % got)

    print("  pdf: rendered again from the cleaned docx")
    docx(f["resume.docx"], "가상 사진", visible="이 문서는 ChatGPT로 작성되었습니다")
    add_core(f["resume.docx"])
    pdf(f["resume.pdf"], text="old render")
    stale = f["resume.pdf"].read_bytes()
    res = run()
    if r.available:
        check(f["resume.pdf"].read_bytes() != stale and any("다시 렌더" in x for x in res[str(f["resume.pdf"])]["fixed"]),
              "the PDF is rendered again from the docx that was cleaned — %s" % res[str(f["resume.pdf"])])
    else:
        check(any("no renderer" in x for x in of(res, "resume.pdf")), "with no renderer the stale PDF is a finding — %s" % of(res, "resume.pdf"))
    check(not [x for x in res if x.endswith(".docx") and of(res, "resume.docx")], "the docx itself is clean after the check")

    print("  pdf: compressed Info and XMP")
    import zlib
    pdf(f["resume.pdf"], producer="LibreOffice 7.6", creator="Writer")
    raw = f["resume.pdf"].read_bytes()
    info = zlib.compress(b"7 0 << /Producer (python-docx 1.1) >>")
    xmp = zlib.compress(b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description>'
                        b'<xmp:CreatorTool>ChatGPT</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta>')
    extra = (b"8 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length %d >>\nstream\n" % len(info) + info
             + b"\nendstream\nendobj\n9 0 obj\n<< /Type /Metadata /Subtype /XML /Filter /FlateDecode /Length %d >>\nstream\n"
             % len(xmp) + xmp + b"\nendstream\nendobj\n")
    f["resume.pdf"].write_bytes(raw.replace(b"trailer\n", extra + b"trailer\n"))
    got = [x for x in of(run(), "resume.pdf") if "names a tool or library" in x]
    check(any("Producer" in x and "python-docx" in x for x in got), "an Info dict inside a compressed object stream is read — %s" % got)
    check(any("XMP xmp:CreatorTool" in x and "ChatGPT" in x for x in got), "a compressed XMP packet is read — %s" % got)
    check(len(got) == len(set(got)), "no finding is reported twice — %s" % got)

    print("  cli")
    import subprocess
    cli = [sys.executable, str(Path(o.__file__)), "final-check", "--dir", str(d)]
    for n in ("deck.pptx", "deck.pdf"):
        if f[n].exists():
            f[n].unlink()
    f["resume.pdf"].unlink()
    docx(f["resume.docx"], "가상 사진", visible="가상 이력서")
    add_core(f["resume.docx"])
    p = subprocess.run(cli, capture_output=True, text=True)
    check(p.returncode == 0 and p.stdout.strip() == "resume.docx: 깨끗함", "clean: exit 0, one verdict — %r" % p.stdout)
    docx(f["resume.docx"], "가상 사진", visible="TODO")
    add_core(f["resume.docx"])
    p = subprocess.run(cli, capture_output=True, text=True)
    check(p.returncode == 1 and "resume.docx: 1건" in p.stdout, "a finding: non-zero exit, listed — %r" % p.stdout)
    p = subprocess.run(cli + ["--author", "홍길동"], capture_output=True, text=True)
    check("홍길동" in read(f["resume.docx"], "docProps/core.xml"), "the cli passes --author through")
    empty = t / "fc-empty"
    empty.mkdir()
    p = subprocess.run([sys.executable, str(Path(o.__file__)), "final-check", "--dir", str(empty)], capture_output=True, text=True)
    check(p.returncode == 1, "no deliverable in the dir is not a pass")


class env:
    """Set (or, with None, remove) environment variables for a block."""

    def __init__(self, **kv):
        self.kv, self.old = kv, {}

    def __enter__(self):
        for k, v in self.kv.items():
            self.old[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def __exit__(self, *a):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def stub(path, body="#!/bin/sh\necho stub\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(0o755)


def fake_tarball(path):
    """A LibreOffice_x.tar.gz holding one deb whose data.tar.xz has opt/libreoffice9/program/soffice."""
    import io
    import lzma
    import tarfile
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as tf:
        body = b"#!/bin/sh\necho fake soffice\n"
        for name in ("./opt/", "./opt/libreoffice9/", "./opt/libreoffice9/program/"):
            ti = tarfile.TarInfo(name)
            ti.type = tarfile.DIRTYPE
            ti.mode = 0o755
            tf.addfile(ti)
        ti = tarfile.TarInfo("./opt/libreoffice9/program/soffice")
        ti.size, ti.mode = len(body), 0o755
        tf.addfile(ti, io.BytesIO(body))
        ti = tarfile.TarInfo("./usr/share/skipped.txt")
        ti.size = 1
        tf.addfile(ti, io.BytesIO(b"x"))
    members = [("debian-binary", b"2.0\n"), ("control.tar.gz", b"\x1f\x8b"), ("data.tar.xz", lzma.compress(data.getvalue()))]
    ar = b"!<arch>\n"
    for n, b in members:
        ar += ("%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (n + "/", 0, 0, 0, "100644", len(b))).encode() + b + (b"\n" if len(b) % 2 else b"")
    deb = Path(str(path) + ".deb")
    deb.write_bytes(ar)
    with tarfile.open(str(path), "w:gz") as tf:
        tf.add(str(deb), arcname="LibreOffice_9/DEBS/libreoffice9_9.0_amd64.deb")
    deb.unlink()


def sha(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def install_tests(t):
    print("install-renderer and the renderer's resolution order")
    t = t / "inst"
    t.mkdir()
    tgz = t / "fake.tar.gz"
    fake_tarball(tgz)
    url = tgz.as_uri()
    cache = t / "cache"
    msgs = []
    with env(XDG_CACHE_HOME=str(cache)):
        d = o.cache_dir()
        check(d == cache / "claude-portfolio" / "libreoffice" / o.LO_VERSION, "the cache is under XDG_CACHE_HOME — %s" % d)
        check(len(o.LO_SHA256) == 64 and o.LO_URL.startswith("https://") and o.LO_VERSION in o.LO_URL, "the pinned URL, version and SHA-256 are set")

        rc, msg = o.install_renderer(url=url, sha256=sha(tgz), size=5 << 20, log=msgs.append)
        check(rc == 1 and "--yes" in msg and "5 MB" in msg and url in msg and str(d) in msg, "without --yes it says size, source and target, and exits 1")
        check(not d.exists(), "without --yes nothing is created")
        check(not msgs, "without --yes nothing is downloaded")

        rc, msg = o.install_renderer(yes=True, url=url, sha256="0" * 64, log=msgs.append)
        check(rc == 1 and "sha256 mismatch" in msg and "nothing was installed" in msg, "a wrong SHA-256 is refused — %s" % msg[:50])
        check(not (d / ".installed").exists() and not (d / "download.tar.gz").exists() and not (d / "root").exists(),
              "a refused download leaves no marker, no file, no unpack")
        check(o.cached_soffice() is None, "so there is no cached renderer")

        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(buf):
            rc_cli = o.cmd_install_renderer([])
        check(rc_cli == 1 and "--yes" in buf.getvalue(), "the command line refuses without --yes too")

        saved = sys.platform
        try:
            sys.platform = "darwin"
            rc, msg = o.install_renderer(yes=True, url=url, sha256=sha(tgz))
        finally:
            sys.platform = saved
        check(rc == 1 and "macOS" in msg and "libreoffice.org" in msg and "DECK_RENDER_DOCKER" in msg and not (d / "download.tar.gz").exists(),
              "macOS: a message pointing at libreoffice.org, nothing downloaded")

        bins = t / "bin"
        bins.mkdir()
        (bins / "bash").symlink_to(shutil.which("bash"))   # the only thing on the stubbed PATH
        with env(PATH=str(bins), DECK_RENDER_DOCKER=None):
            r = o.Renderer()
            check(not r.available and r.local is None, "no soffice, no cache, no docker: no renderer")
            check("install-renderer" in o.NO_RENDERER and "DECK_RENDER_DOCKER" in o.NO_RENDERER,
                  "the no-renderer hint names install-renderer and DECK_RENDER_DOCKER")
            pdf = t / "x.pdf"
            pdf.write_bytes(b"%PDF-1.4\n")
            res = o.main(["margins", str(pdf)])
            check("install-renderer" in res.get("error", ""), "margins without a renderer names install-renderer — %s" % res.get("error", "")[:60])

        with env(PATH=str(bins), DECK_RENDER_DOCKER=None):
            rc, msg = o.install_renderer(yes=True, url=url, sha256=sha(tgz), log=msgs.append)
            check(rc == 0 and "installed" in msg, "a matching SHA-256 installs (fake deb, unpacked without root) — %s" % msg[-50:])
            so = o.cached_soffice()
            check(so is not None and so.name == "soffice" and so.parent.name == "program" and os.access(so, os.X_OK), "the cached soffice is found and executable")
            check(not (d / "root" / "usr").exists() and not (d / "download.tar.gz").exists() and not (d / "debs").exists(),
                  "only /opt is unpacked and the download and debs are removed")
            rc, msg = o.install_renderer(url=url, sha256="0" * 64)
            check(rc == 0 and "already installed" in msg, "a second run (even without --yes) finds it installed")

            r = o.Renderer()
            check(r.available and r.local == str(so) and r.cached == so, "no soffice on PATH: the cached install is used")
            check("install-renderer" in r.describe() and str(so) in r.describe(), "describe says it is the cached install — %s" % r.describe()[-45:])
            e = r._fc_env()
            check(e["PATH"].split(os.pathsep)[0] == str(so.parent) and e["LO_PROGRAM"] == str(so.parent), "the cached program dir is first on PATH for the render script")
            check("deck-fonts-" in e["FONTCONFIG_FILE"] and str(o.BUNDLED_FONT_DIR) in Path(e["FONTCONFIG_FILE"]).read_text(),
                  "the bundled Nanum fonts reach the cached soffice through a fontconfig file")
            out = r.sh(t, "soffice").stdout.strip()
            check(out == "fake soffice", "a script run by the renderer finds `soffice` on that PATH — %r" % out)

            stub(bins / "soffice")
            stub(bins / "docker")
            with env(DECK_RENDER_DOCKER="some-image"):
                r = o.Renderer()
                check(r.local == str(bins / "soffice") and r.cached is None and r.describe() == str(bins / "soffice"),
                      "soffice on PATH wins over the cache and over docker")
            (bins / "soffice").unlink()
            with env(DECK_RENDER_DOCKER="some-image"):
                r = o.Renderer()
                check(r.cached == so, "the cache wins over docker")
                shutil.rmtree(str(d))
                r = o.Renderer()
                check(r.local is None and r.available and r.describe() == "docker some-image", "with neither, DECK_RENDER_DOCKER is used")
            shutil.rmtree(str(d), ignore_errors=True)


FAKE_MUPDF = '''
from pathlib import Path
PAGES = [{"width": 595.0, "height": 842.0, "blocks": [
    {"type": 0, "lines": [{"bbox": (10.5, 20.0, 100.0, 34.0), "spans": [{"text": "안녕 "}]},
                          {"bbox": (110.0, 21.0, 200.25, 34.0), "spans": [{"text": "세상  AB"}]},
                          {"bbox": (10.5, 40.0, 90.0, 54.0), "spans": [{"text": "  "}]}]},
    {"type": 1, "bbox": (0, 0, 1, 1)},
    {"type": 0, "lines": [{"bbox": (300.0, 700.0, 400.0, 720.0), "spans": [{"text": "foot"}]}]}]}] * 10


class _Pix:
    def __init__(self, dpi):
        self.dpi = dpi

    def save(self, p):
        Path(p).write_bytes(b"png dpi=%d" % self.dpi)


class _Page:
    def __init__(self, d):
        self.d = d

    def get_text(self, kind="text"):
        return self.d if kind == "dict" else "page text"

    def get_pixmap(self, dpi=72):
        return _Pix(dpi)


class _Doc:
    page_count = len(PAGES)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        return iter(_Page(d) for d in PAGES)


def open(path):
    return _Doc()
'''


def mupdf_tests(t):
    print("PyMuPDF fallback")
    t = t / "mu"
    t.mkdir()
    tgz = t / "fake.tar.gz"
    fake_tarball(tgz)
    whl = t / "fake-1-py3-none-any.whl"
    with zipfile.ZipFile(whl, "w") as z:
        z.writestr("pymupdf.py", FAKE_MUPDF)
    cache = t / "cache"
    bins = t / "bin"
    bins.mkdir()
    (bins / "bash").symlink_to(shutil.which("bash"))
    msgs = []
    with env(XDG_CACHE_HOME=str(cache), PATH=str(bins), DECK_RENDER_DOCKER=None):
        lib = o.pylib_dir()
        check(lib == o.cache_dir() / "pylib" and len(o.MUPDF_SHA256) == 64 and o.MUPDF_URL.startswith("https://"), "the PyMuPDF wheel is pinned, unpacked into <cache>/pylib")
        rc, msg = o.install_pymupdf(url=whl.as_uri(), sha256=sha(whl), size=3 << 20, log=msgs.append)
        check(rc == 1 and "--yes" in msg and "3 MB" in msg and not msgs, "PyMuPDF: without --yes it says what it would do and downloads nothing")
        rc, msg = o.install_pymupdf(yes=True, url=whl.as_uri(), sha256="0" * 64, log=msgs.append)
        check(rc == 1 and "sha256 mismatch" in msg and not (lib / ".installed").exists() and not lib.exists(),
              "PyMuPDF: a wrong SHA-256 is refused and nothing is unpacked — %s" % msg[:50])
        check(not list((o.cache_dir() / "wheels").glob("*.whl")), "the refused wheel is not kept")
        check(o.mupdf_module() is None, "without pylib there is no fallback")

        o.install_renderer(yes=True, url=tgz.as_uri(), sha256=sha(tgz), log=msgs.append)
        r = o.Renderer()
        check(r.available and r.local and r._mupdf("pdftoppm") is None, "no pylib: no fallback, previews and bbox give nothing")
        work = t / "work"
        work.mkdir()
        (work / "d.pdf").write_bytes(b"%PDF")
        check(r.previews(work, "d.pdf") == [] and r.bbox(work, "d.pdf") is None and r.text(work, "d.pdf") is None, "…and say so (empty, None, None)")

        rc, msg = o.install_pymupdf(yes=True, url=whl.as_uri(), sha256=sha(whl), log=msgs.append)
        check(rc == 0 and (lib / ".installed").is_file() and (lib / "pymupdf.py").is_file(), "PyMuPDF: a matching SHA-256 unpacks the wheel — %s" % msg[-40:])
        check(not list((o.cache_dir() / "wheels").glob("*.whl")) and str(lib) not in sys.path, "the wheel is deleted and pylib is not left on sys.path")
        rc, msg = o.install_pymupdf(url=whl.as_uri(), sha256="0" * 64)
        check(rc == 0 and "already" in msg, "a second run finds it installed")

        try:
            check(r._mupdf("pdftoppm") is not None, "no poppler on PATH and pylib there: the fallback is chosen")
            pages = o.mupdf_pages(r._mupdf("pdftotext").open("x"))
            line = ((10.5, 20.0, 200.25, 34.0), "안녕 세상 AB")
            check(len(pages) == 10 and pages[0] == (595.0, 842.0, [[line], [((300.0, 700.0, 400.0, 720.0), "foot")]]),
                  "the adapter maps the dict to bbox_pages' shape (spaces collapsed, same-baseline pieces joined, blank lines and images dropped) — %s" % (pages[0],))
            box = r.bbox(work, "d.pdf")
            check(o.bbox_pages(box) == pages, "bbox() is XML that bbox_pages reads back to exactly that")
            hits = o.margin_crossers(box, 30)
            check(len(hits) == 20 and hits[0] == (1, "left", "안녕 세상 AB") and hits[1][1] == "top", "margin_crossers reads it — %d hits" % len(hits))
            check(r.text(work, "d.pdf") == "\f".join(["page text"] * 10), "text() joins the pages with form feeds, as pdftotext does")
            (work / "pages").mkdir()
            (work / "pages" / "p-1.png").write_bytes(b"stale")
            (work / "pages" / "keep-1.png").write_bytes(b"other prefix")
            shots = r.previews(work, "d.pdf", dpi=50)
            names = [p.name for p in shots]
            check(names == ["p-%02d.png" % i for i in range(1, 11)], "previews are pages/p-NN.png, numbers padded as pdftoppm pads them — %s" % names[:3])
            check((work / "pages" / "p-01.png").read_bytes() == b"png dpi=50" and not (work / "pages" / "p-1.png").exists()
                  and (work / "pages" / "keep-1.png").exists(), "at the asked dpi; the old previews of that prefix go, other prefixes stay")

            stub(bins / "pdftotext", '#!/bin/sh\nfor a; do last=$a; done; echo POPPLER > "$last"\n')
            check(r._mupdf("pdftotext") is None and r.text(work, "d.pdf") == "POPPLER\n", "with poppler on PATH it is used first, PyMuPDF is not")
            (bins / "pdftotext").unlink()
            with env(DECK_RENDER_DOCKER="img"):
                (cache / "claude-portfolio" / "libreoffice" / o.LO_VERSION / ".installed").unlink()
                stub(bins / "docker")
                rd = o.Renderer()
                check(rd.local is None and rd._mupdf("pdftotext") is None, "the docker path never takes the fallback")
        finally:
            sys.modules.pop("pymupdf", None)


def main():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        print("alt text")
        f = t / "a.pptx"
        pptx(f, "가상 로고. AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        s = read(f, "ppt/slides/slide1.xml")
        check(r["removed"] == 1 and not r["reported"] and 'descr="가상 로고."' in s and "AI-generated" not in s,
              "pptx: the disclaimer sentence goes, the rest of the alt text stays — %s" % r)
        check(zipfile.ZipFile(f).read("ppt/media/image1.png").startswith(b"\x89PNG"), "binary parts are copied untouched")
        f = t / "b.pptx"
        pptx(f, "AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        check(r["removed"] == 1 and 'descr=""' in read(f, "ppt/slides/slide1.xml"), "an alt text that was only the disclaimer comes out empty")
        f = t / "c.pptx"
        pptx(f, "AI 생성 콘텐츠는 정확하지 않을 수 있습니다.")
        check(o.ai_traces(f)["removed"] == 1 and "생성 콘텐츠" not in read(f, "ppt/slides/slide1.xml"), "the Korean Office wording goes too")
        f = t / "d.pptx"
        pptx(f, "AI에서 생성된 콘텐츠는 부정확할 수 있습니다. 가상 도표")
        check(o.ai_traces(f)["removed"] == 1 and 'descr="가상 도표"' in read(f, "ppt/slides/slide1.xml"), "the second Korean wording goes")
        f = t / "d2.pptx"
        pptx(f, "가상 그림. AI가 생성한 콘텐츠는 부정확할 수 있습니다.")
        check(o.ai_traces(f)["removed"] == 1 and 'descr="가상 그림."' in read(f, "ppt/slides/slide1.xml"), "another Korean wording (AI가 생성한) goes")
        f = t / "d3.pptx"
        pptx(f, "가상 그림. AI가 작성한 내용이므로 오류가 있을 수 있습니다.")
        check(o.ai_traces(f)["removed"] == 1 and 'descr="가상 그림."' in read(f, "ppt/slides/slide1.xml"), "작성한 … 오류가 있을 수 있습니다 goes too")
        for s in ("이 문서는 AI의 도움을 받아 작성했습니다", "본 내용은 인공지능이 작성하였습니다", "AI를 활용해 작성",
                  "AI로 작성해서 틀릴 수 있습니다", "ChatGPT로 작성되었습니다"):
            check(o._PHRASES.search(s) or o._DISCLAIMER.search(s), "an AI phrase is caught: %s" % s)
        for s in ("AI 추천 시스템을 설계했다", "인공지능 팀과 협업해 API를 작성했다", "LLM 기반 요약 기능을 만들었다"):
            check(not (o._PHRASES.search(s) or o._DISCLAIMER.search(s)), "work about AI is not a trace: %s" % s)
        f = t / "e.docx"
        docx(f, "가상 사진 AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        check(r["removed"] == 1 and not r["reported"] and 'title="가상 사진"' in read(f, "word/document.xml"),
              "docx: a title attribute on docPr is cleaned too — %s" % r)
        check(o.ai_traces(f) == {"removed": 0, "removed_text": [], "reported": []}, "a clean file stays clean, nothing reported")
        f = t / "g.pptx"
        pptx(f, "AI-generated content may be incorrect.")
        before = f.read_bytes()
        r = o.ai_traces(f, fix=False)
        check(f.read_bytes() == before and r["removed"] == 0 and len(r["reported"]) == 1, "fix=False reports and leaves the file as it is")

        print("visible text and properties: every trace goes")
        f = t / "h.docx"
        docx(f, "가상 사진", visible="이 문서는 생성형 AI로 작성했습니다", app="ChatGPT")
        r = o.ai_traces(f)
        doc = read(f, "word/document.xml")
        check(r["removed"] == 2 and not r["reported"], "an AI tool in app.xml and an AI sentence in the text are removed — %s" % r)
        check("생성형 AI" not in doc and doc.count("<w:p>") == 1, "a Word paragraph that was only the trace goes; the photo paragraph stays")
        check("<Application></Application>" in read(f, "docProps/app.xml"), "the AI tool in app.xml is emptied")
        check(any("생성형 AI로 작성했습니다" in x for x in r["removed_text"]), "what was removed is listed word for word — %s" % r["removed_text"])
        f = t / "h2.docx"
        docx(f, "가상 사진", visible="검색 응답을 820ms에서 310ms로 줄였다. 이 문서는 ChatGPT로 작성되었습니다. 캐시를 먼저 넣었다.")
        o.ai_traces(f)
        doc = read(f, "word/document.xml")
        check("<w:t>검색 응답을 820ms에서 310ms로 줄였다. 캐시를 먼저 넣었다.</w:t>" in doc,
              "only the trace sentence goes; the sentences around it stay — %s" % doc[-160:])
        f = t / "h3.docx"
        docx(f, "가상 사진", visible="AI로 작성해서 틀릴 수 있습니다 / [확인 필요: 기간]")
        o.ai_traces(f)
        check("<w:t>[확인 필요: 기간]</w:t>" in read(f, "word/document.xml"), "a ` / ` separates claims: the work annotation next to a trace stays")
        f = t / "i.pptx"
        pptx(f, "가상 로고", visible="As an AI language model, I", app="Microsoft Copilot")
        r = o.ai_traces(f)
        s = read(f, "ppt/slides/slide1.xml")
        check(r["removed"] == 2 and "As an AI" not in s and "<a:p><a:r><a:t></a:t></a:r></a:p>" in s,
              "pptx: both go; the slide paragraph stays, blank (a text box needs one) — %s" % r)
        f = t / "i2.pptx"
        pptx(f, "가상 로고", visible="이 문서는 ChatGPT로 작성되었습니다")
        check(o.ai_traces(f)["removed"] == 1 and "ChatGPT" not in read(f, "ppt/slides/slide1.xml"), "a tool named as the writer ('ChatGPT로 작성') goes")
        f = t / "i3.pptx"
        pptx(f, "가상 로고", visible="ChatGPT API 연동 상담 봇을 Claude Code로 개발")
        check(o.ai_traces(f) == {"removed": 0, "removed_text": [], "reported": []}, "a tool named as project work is not an AI trace")
        f = t / "j.pptx"
        pptx(f, "가상 로고", visible="AI-generated content may be incorrect.")
        check(o.ai_traces(f)["removed"] == 1 and "AI-generated" not in read(f, "ppt/slides/slide1.xml"), "a disclaimer typed into visible text goes")
        f = t / "k.pptx"
        pptx(f, "가상 로고", visible="이 문서는 ChatGPT로 작성되었습니다", app="python-pptx")
        add_core(f, title="발표 (Gemini)", creator="python-pptx")
        before = f.read_bytes()
        r = o.ai_traces(f, fix=False)
        check(f.read_bytes() == before and r["removed"] == 0 and len(r["reported"]) == 4, "fix=False reports all and changes nothing — %s" % r["reported"])
        o.ai_traces(f)
        core = read(f, "docProps/core.xml")
        check("<dc:title>발표</dc:title>" in core and "<dc:creator></dc:creator>" in core and "<Application></Application>" in read(f, "docProps/app.xml"),
              "properties: the tool goes from the title, a library author and Application are emptied — %s" % core)

        final_check_tests(t)

        print("margins")
        box = ('<html xmlns="http://www.w3.org/1999/xhtml"><body><doc>'
               '<page width="600" height="800"><flow><block>'
               '<line xMin="40" yMin="50" xMax="300" yMax="62"><word xMin="40" yMin="50" xMax="300" yMax="62">안쪽</word></line>'
               '<line xMin="10" yMin="100" xMax="200" yMax="112"><word xMin="10" yMin="100" xMax="200" yMax="112">왼쪽넘음</word></line>'
               '</block></flow></page>'
               '<page width="600" height="800"><flow><block>'
               '<line xMin="40" yMin="780" xMax="590" yMax="795"><word xMin="40" yMin="780" xMax="590" yMax="795">아래</word></line>'
               '</block></flow></page></doc></body></html>')
        hits = o.margin_crossers(box, 28)
        check([(h[0], h[1]) for h in hits] == [(1, "left"), (2, "right"), (2, "bottom")], "lines past a margin are listed by page and side — %s" % hits)
        ws = t / "ws"
        (ws / "style").mkdir(parents=True)
        check(o.safe_area(ws) is None, "no style/레이아웃.md, no safe area")
        (ws / "style" / "레이아웃.md").write_text("# 레이아웃\n- top: 60\n- bottom: 4\n- left: 5\n- right: 15\n", encoding="utf-8")
        area = o.safe_area(ws)
        check(area == {"top": 60.0, "bottom": 4.0, "left": 5.0, "right": 15.0},"the four sides are read from style/레이아웃.md — %s" % area)
        hits = o.margin_crossers(box, area)
        check([(h[0], h[1]) for h in hits] == [(1, "top"), (2, "right")], "each side uses its own margin — %s" % hits)

        install_tests(t)
        mupdf_tests(t)

        print("render")
        r = o.Renderer()
        if r.available:
            work = t / "work"
            work.mkdir()
            docx(work / "r.docx", "가상 사진")
            # a hand-made package has no styles part; LibreOffice still opens it as a blank page
            r.to_pdf(work, "r.docx")
            check((work / "r.pdf").is_file() and (work / "r.pdf").stat().st_size > 0, "a docx from %s renders to a PDF (%s)" % (work, r.describe()))
            check(os.access(work / "r.pdf", os.W_OK) and (work / "r.pdf").stat().st_uid == os.getuid(), "the PDF belongs to the user")
            check(not (Path.home() / ".cache" / "portfolio-render").exists(), "no stage dir is left behind")
            check(not [p for p in work.iterdir() if p.name.startswith(".lo-")], "no conversion scratch is left in the work dir")
        else:
            print("  skip render: no soffice and no DECK_RENDER_DOCKER")

    print()
    if FAILED:
        print("%d FAILED" % len(FAILED))
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
