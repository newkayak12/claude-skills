#!/usr/bin/env python3
"""Tests for resume.py. The template is fictional and made here in a temp dir: no .docx is
ever kept in the repo (the user's real material never goes to git).

    python3 test_resume.py           (render runs only when a renderer is available)
"""
import json
import os
import re
import shutil
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
        check(b["ai_traces"] == {"removed": 0, "removed_text": [], "reported": []},"build reports ai_traces, clean here — %s" % b["ai_traces"])

        check(b["final_check"][0] == "resume.docx: 1건" and "[확인 필요" in b["final_check"][1],
              "build prints the final-check verdict: the kept [확인 필요 line is a finding — %s" % b["final_check"])

        print("the old engine path (manage/scripts/resume.py) is a shim")
        shim = HERE.parents[1] / "manage" / "scripts" / "resume.py"
        shim_out = Path(t) / "shim-out.docx"
        r = subprocess.run([sys.executable, str(shim), "build", "--out", str(shim_out)], cwd=root,
                           capture_output=True, text=True)
        check(r.returncode == 0 and json.loads(r.stdout)["paragraphs"] == 6 and shim_out.is_file(),
              "build through the shim gives the same result — %s" % (r.stdout or r.stderr)[:120])
        check("moved" in r.stderr and r.stderr.strip().count("\n") == 0, "one stderr line says the engine moved — %r" % r.stderr)
        r = subprocess.run([sys.executable, str(shim), "nothing"], cwd=root, capture_output=True, text=True)
        check(r.returncode != 0 and "usage" in r.stderr, "the shim passes the engine's refusal and exit code through")

        print("refusals")
        bad = RESUME.replace("bullet: ListBullet", "bullet: NoSuchStyle")
        (root / "resume.md").write_text(bad, encoding="utf-8")
        rc, e = run(root, "build")
        check(rc != 0 and "NoSuchStyle" in e["error"], "a style the template lacks is refused")
        (root / "resume.md").write_text(RESUME.replace("template/resume.docx", "template/none.docx"), encoding="utf-8")
        rc, e = run(root, "build")
        check(rc != 0 and "template not found" in e["error"], "a missing template is refused, no built-in look")

        print("a Normal-only template, mapped by sample text; resume-deck.mdx is the default source")
        plain = Path(t) / "plain"
        (plain / "template").mkdir(parents=True)
        make_template(plain / "template" / "template.docx")
        with zipfile.ZipFile(plain / "template" / "template.docx") as z:
            parts = {n: z.read(n) for n in z.namelist()}

        def run_fmt(text, rpr, extra=""):
            return ('<w:p><w:pPr><w:spacing w:after="40"/>%s</w:pPr><w:r><w:rPr>%s</w:rPr><w:t>%s</w:t></w:r></w:p>'
                    % (extra, rpr, text))
        photo = ('<w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
                 '<wp:docPr id="1" name="사진" descr="가상 인물 사진. AI-generated content may be incorrect."/></wp:anchor></w:drawing></w:r>')
        body = ('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>%s<w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>홍길동</w:t></w:r></w:p>' % photo
                + run_fmt("Email: a@b.invalid", '<w:sz w:val="15"/>')
                + run_fmt("핵심역량", '<w:b/><w:color w:val="1F4E79"/><w:sz w:val="22"/>')
                + run_fmt("기술: Kotlin", '<w:color w:val="7F7F7F"/><w:sz w:val="16"/>')
                + run_fmt("샘플 불릿", '<w:sz w:val="18"/>', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="12"/></w:numPr>')
                + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>')
        parts["word/document.xml"] = ('<?xml version="1.0" encoding="UTF-8"?><w:document %s><w:body>%s</w:body></w:document>'
                                      % (W, body)).encode("utf-8")
        with zipfile.ZipFile(plain / "template" / "template.docx", "w") as z:
            for n, d in parts.items():
                z.writestr(n, d)
        rc, c = run(plain, "catalog", "--template", "template/template.docx")
        check(rc == 0 and len(c["looks"]) == 5 and {"sample": "핵심역량", "pt": 11.0, "bold": True, "color": "1F4E79", "list": False} in c["looks"],
              "catalog lists each distinct look once — %s" % c.get("looks"))
        src = ("---\ntemplate: template/template.docx\npages: 1\nsamples:\n  name: 홍길동\n  contact: Email\n"
               "  section: 핵심역량\n  meta: 기술\n  bullet: 샘플\n---\n"
               "# 가상 인물\n{contact} Phone: 010-0000-0000\n## 경력\n{meta} 기술: Spring\n- 한 일\n글감: x\n")
        (plain / "resume-deck.mdx").write_text(src, encoding="utf-8")
        (plain / "resume.md").write_text("stale", encoding="utf-8")
        rc, b = run(plain, "build")
        check(rc == 0 and b["paragraphs"] == 5, "builds from resume-deck.mdx, not the stale resume.md — %s" % b)
        with zipfile.ZipFile(plain / "build" / "resume.docx") as z:
            doc = z.read("word/document.xml").decode("utf-8")
        check('<w:color w:val="1F4E79"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">경력' in doc, "a section line takes its sample's run format")
        check('<w:color w:val="7F7F7F"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">기술: Spring' in doc, "{meta} names a role outright")
        check('<w:numId w:val="12"/>' in doc and '<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">한 일' in doc,
              "a bullet keeps the sample's list numbering and size")
        check("AI-generated" not in doc and 'descr="가상 인물 사진."' in doc and b["ai_traces"]["removed"] == 1,
              "the photo's AI disclaimer is removed from its alt text, the rest kept — %s" % b["ai_traces"])
        check(doc.count("<w:drawing>") == 1 and doc.index("<w:drawing>") < doc.index("가상 인물"), "the template's photo is kept, on the first paragraph")
        check("샘플 불릿" not in doc and "Email: a@b" not in doc, "the template's sample body is gone")
        print("the template's finish without a post-build script (card 139)")
        lab = ('<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="16"/></w:rPr>'
               '<w:t xml:space="preserve">역할: </w:t></w:r><w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr>'
               '<w:t>설계</w:t></w:r></w:p>')
        with zipfile.ZipFile(plain / "template" / "template.docx") as z:
            parts2 = {n: z.read(n) for n in z.namelist()}
        parts2["word/document.xml"] = parts2["word/document.xml"].replace("<w:sectPr>".encode(), (lab + "<w:sectPr>").encode(), 1)
        parts2["docProps/core.xml"] = (b'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/'
                                       b'package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
                                       b'<dc:creator>python-docx</dc:creator></cp:coreProperties>')
        with zipfile.ZipFile(plain / "template" / "template.docx", "w") as z:
            for n, d in parts2.items():
                z.writestr(n, d)
        fin = ("---\ntemplate: template/template.docx\npages: 1\ntitle: 가상 인물 이력서\nauthor: 가상 인물\n"
               "photo_alt: 가상 인물 프로필 사진\nkeep: section, company\nsamples:\n  name: 홍길동\n  contact: Email\n"
               "  section: 핵심역량\n  company: 핵심역량\n  role: 역할\n  bullet: 샘플\nspacing:\n  company: 12 3\n---\n"
               "# 가상 인물\n{contact} 메일: a@b.invalid · https://example.invalid/me\n## 경력\n{company} 가상상점\n"
               "{role} 역할: 검색 개편\n- 한 일\n")
        (plain / "resume-deck.mdx").write_text(fin, encoding="utf-8")
        rc, b = run(plain, "build")
        with zipfile.ZipFile(plain / "build" / "resume.docx") as z:
            doc = z.read("word/document.xml").decode("utf-8")
            rels = z.read("word/_rels/document.xml.rels").decode("utf-8") if "word/_rels/document.xml.rels" in z.namelist() else ""
            core = z.read("docProps/core.xml").decode("utf-8")
        check(rc == 0 and '<w:color w:val="000000"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">역할:</w:t>' in doc
              and '<w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> 검색 개편</w:t>' in doc,
              "a `라벨: 값` line takes the sample's label and value formats — %s" % b)
        check(doc.count("<w:hyperlink ") == 2 and 'Target="mailto:a@b.invalid"' in rels and 'Target="https://example.invalid/me"' in rels
              and "xmlns:r=" in doc, "a mail address and a URL become links, their targets in the rels")
        company = re.search(r"<w:p><w:pPr>((?:(?!</w:pPr>).)*)</w:pPr><w:r><w:rPr>(?:(?!</w:r>).)*가상상점", doc, re.S)
        check(company and "<w:keepNext/>" in company.group(1) and 'w:before="0"' in company.group(1) and 'w:after="60"' in company.group(1),
              "a kept role holds with the next line; the first line under a section starts at 0; spacing: sets after (pt) — %s"
              % (company.group(1) if company else None))
        check("<dc:title>가상 인물 이력서</dc:title>" in core and "<dc:creator>가상 인물</dc:creator>" in core and "python-docx" not in core,
              "title and author come from the front matter — %s" % core)
        check('descr="가상 인물 프로필 사진"' in doc, "photo_alt sets the photo's alt text")
        (plain / "resume-deck.mdx").write_text(fin.replace("  company: 12 3", "  company: 12"), encoding="utf-8")
        rc, e = run(plain, "build")
        check(rc != 0 and "spacing" in e["error"], "a spacing line without two numbers is refused")
        (plain / "resume-deck.mdx").write_text(src.replace("  meta: 기술\n", "  meta: 없는문단\n"), encoding="utf-8")
        rc, e = run(plain, "build")
        check(rc != 0 and "없는문단" in e["error"], "a sample text no template paragraph starts with is refused")
        (plain / "resume-deck.mdx").write_text(src.replace("  meta: 기술\n", ""), encoding="utf-8")
        rc, e = run(plain, "build")
        check(rc != 0 and "meta" in e["error"], "a role used but mapped nowhere is refused")

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
        sys.path.insert(0, str(HERE.parents[2] / "scripts"))
        import office_render
        if office_render.Renderer().available:
            (root / "resume.md").write_text(RESUME, encoding="utf-8")
            run(root, "build")
            pages = root / "build" / "pages"
            pages.mkdir(parents=True, exist_ok=True)
            (pages / "resume-p-9.png").write_bytes(b"stale")
            (pages / "p-1.png").write_bytes(b"deck")
            rc, r = run(root, "render")
            check(rc == 0 and r["pages"] >= 1 and (root / r["pdf"]).is_file(), "render writes a PDF and counts its pages — %s" % r)
            shots = sorted(x.name for x in pages.glob("resume-p*.png"))
            if shutil.which("pdftoppm") or os.environ.get("DECK_RENDER_DOCKER"):
                check(len(shots) == r["pages"] and "resume-p-9.png" not in shots and (pages / "resume-p-1.png").stat().st_size > 5,
                      "render regenerates the page previews and deletes the stale ones — %s" % shots)
                check((pages / "p-1.png").read_bytes() == b"deck", "another document's previews are left alone")
            check(any(x.startswith("resume.pdf:") for x in r["final_check"]), "render prints the final-check verdict for the PDF — %s" % r["final_check"])
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
