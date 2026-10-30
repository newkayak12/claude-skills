#!/usr/bin/env python3
"""Tests for resume.py. The template is fictional and made here in a temp dir: no .docx is
ever kept in the repo (the user's real material never goes to git).

    python3 test_resume.py           (render runs only when a renderer is available)
"""
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "resume.py"
FAILED = []


def check(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILED.append(label)


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def make_template(path):
    def p(style, text, extra=""):
        return ('<w:p><w:pPr><w:pStyle w:val="%s"/>%s</w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr>'
                '<w:t>%s</w:t></w:r></w:p>' % (style, extra, text))
    body = (p("Title", "가상 이름") + p("Normal", "가상 연락처")
            + p("Heading1", "경력") + p("Heading2", "가상 회사 · 2020–2022")
            + p("ListBullet", "샘플 불릿", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>')
            + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>')
    doc = '<?xml version="1.0" encoding="UTF-8"?><w:document %s><w:body>%s</w:body></w:document>' % (W, body)
    st = "".join('<w:style w:type="paragraph" w:styleId="%s"><w:name w:val="%s"/></w:style>' % (i, n)
                 for i, n in (("Title", "Title"), ("Normal", "Normal"), ("Heading1", "heading 1"),
                              ("Heading2", "heading 2"), ("ListBullet", "List Bullet")))
    styles = '<?xml version="1.0" encoding="UTF-8"?><w:styles %s>%s</w:styles>' % (W, st)
    ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="%s/officeDocument" Target="word/document.xml"/></Relationships>' % rel)
    drels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="%s/styles" Target="styles.xml"/></Relationships>' % rel)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/_rels/document.xml.rels", drels)
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", styles)


RESUME = """---
template: template/resume.docx
pages: 2
styles:
  name: Title
  section: Heading1
  entry: Heading2
  bullet: ListBullet
  body: Normal
---
# 가상 인물
backend@example.invalid
## 경력
### 가상 회사 · 2021–2024 · 백엔드
- 검색 응답 **820ms → 210ms** & 캐시 도입
글감: retro--검색-지연
- 원인은 [확인 필요: 측정 기준]
"""


def run(cwd, *args):
    r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd, capture_output=True, text=True)
    out = (r.stdout or r.stderr).strip().splitlines()[-1]
    return r.returncode, json.loads(out)


def workspace(root):
    (root / "template").mkdir(parents=True)
    make_template(root / "template" / "resume.docx")
    (root / "resume.md").write_text(RESUME, encoding="utf-8")


def main():
    with tempfile.TemporaryDirectory() as t:
        root = Path(t) / "ws"
        workspace(root)

        print("catalog")
        rc, c = run(root, "catalog")
        roles = {s["id"]: s["role"] for s in c["styles"]}
        check(rc == 0 and roles == {"Title": "name", "Normal": "body", "Heading1": "section",
                                    "Heading2": "entry", "ListBullet": "bullet"}, "catalog lists styles with a suggested role")

        print("build")
        rc, b = run(root, "build")
        check(rc == 0 and b["paragraphs"] == 6, "build writes one paragraph per line, 글감 dropped — got %s" % b)
        with zipfile.ZipFile(root / "build" / "resume.docx") as z:
            doc = z.read("word/document.xml").decode("utf-8")
            names = z.namelist()
        check("샘플 불릿" not in doc and "가상 연락처" not in doc, "the template's sample body is gone")
        check("글감" not in doc, "no citation line reaches the resume")
        check(doc.count('<w:pStyle w:val="ListBullet"/>') == 2 and '<w:numId w:val="7"/>' in doc,
              "bullets take the template's own style and numbering")
        check('<w:b/></w:rPr><w:t xml:space="preserve">820ms → 210ms</w:t>' in doc, "**bold** becomes a bold run")
        check("&amp; 캐시" in doc, "text is XML-escaped")
        check('<w:sz w:val="22"/>' in doc, "runs keep the template's run format")
        check(doc.rstrip().endswith('</w:sectPr></w:body></w:document>'), "page setup (sectPr) is kept last")
        check(set(names) >= {"word/styles.xml", "[Content_Types].xml"}, "the rest of the package is copied")
        check(len(b["warnings"]) == 1 and "확인 필요" in b["warnings"][0], "an unconfirmed line is warned")

        print("refusals")
        bad = RESUME.replace("bullet: ListBullet", "bullet: NoSuchStyle")
        (root / "resume.md").write_text(bad, encoding="utf-8")
        rc, e = run(root, "build")
        check(rc != 0 and "NoSuchStyle" in e["error"], "a style the template lacks is refused")
        (root / "resume.md").write_text(RESUME.replace("template/resume.docx", "template/none.docx"), encoding="utf-8")
        rc, e = run(root, "build")
        check(rc != 0 and "template not found" in e["error"], "a missing template is refused, no built-in look")

        print("never to git")
        repo = Path(t) / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        workspace(repo / "ws")
        rc, e = run(repo / "ws", "build")
        check(rc != 0 and "never goes to git" in e["error"], "material inside a git repo, not ignored, is refused")
        rc, e = run(repo / "ws", "catalog")
        check(rc != 0, "catalog refuses the same template")
        (repo / ".gitignore").write_text("ws/\n", encoding="utf-8")
        rc, b = run(repo / "ws", "build")
        check(rc == 0, "the same workspace, ignored, builds")

        print("render")
        sys.path.insert(0, str(HERE.parents[1] / "deck-builder" / "scripts"))
        import deck
        if deck.Renderer().available:
            (root / "resume.md").write_text(RESUME, encoding="utf-8")
            run(root, "build")
            rc, r = run(root, "render")
            check(rc == 0 and r["pages"] >= 1 and (root / r["pdf"]).is_file(), "render writes a PDF and counts its pages — %s" % r)
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
