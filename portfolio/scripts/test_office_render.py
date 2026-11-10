#!/usr/bin/env python3
"""Tests for office_render.py. Every fixture is fictional and built in a temp dir.

    python3 test_office_render.py      (the render part runs when a renderer is available;
                                         DECK_RENDER_DOCKER=<image> also proves the staging from /tmp)
"""
import os
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


def main():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        print("alt text")
        f = t / "a.pptx"
        pptx(f, "가상 로고. AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        s = read(f, "ppt/slides/slide1.xml")
        check(r == {"removed": 1, "reported": []} and 'descr="가상 로고."' in s and "AI-generated" not in s,
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
        f = t / "e.docx"
        docx(f, "가상 사진 AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        check(r == {"removed": 1, "reported": []} and 'title="가상 사진"' in read(f, "word/document.xml"),
              "docx: a title attribute on docPr is cleaned too — %s" % r)
        check(o.ai_traces(f) == {"removed": 0, "reported": []}, "a clean file stays clean, nothing reported")
        f = t / "g.pptx"
        pptx(f, "AI-generated content may be incorrect.")
        before = f.read_bytes()
        r = o.ai_traces(f, fix=False)
        check(f.read_bytes() == before and r["removed"] == 0 and len(r["reported"]) == 1, "fix=False reports and leaves the file as it is")

        print("reported, never deleted")
        f = t / "h.docx"
        docx(f, "가상 사진", visible="이 문서는 생성형 AI로 작성했습니다", app="ChatGPT")
        before = read(f, "word/document.xml")
        r = o.ai_traces(f)
        check(r["removed"] == 0 and len(r["reported"]) == 2, "an AI tool in app.xml and an AI phrase in the text are reported — %s" % r["reported"])
        check(read(f, "word/document.xml") == before, "visible text is never deleted")
        f = t / "i.pptx"
        pptx(f, "가상 로고", visible="As an AI language model, I", app="Microsoft Copilot")
        check(len(o.ai_traces(f)["reported"]) == 2, "pptx: the same two kinds are reported")
        f = t / "j.pptx"
        pptx(f, "가상 로고", visible="AI-generated content may be incorrect.")
        r = o.ai_traces(f)
        check(len(r["reported"]) == 1 and "AI-generated" in read(f, "ppt/slides/slide1.xml"), "a disclaimer typed into visible text is reported, kept")

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
