#!/usr/bin/env python3
"""portfolio:manage step 9 — resume.md written into the user's own Word template, then PDF.

Stdlib only. Run from the workspace root; every subcommand prints one JSON object.

    resume.py catalog [--template template/resume.docx]
        the template's paragraph styles: id, name, how many paragraphs use it, a sample,
        and a suggested role (name | section | entry | bullet | body)
    resume.py build [--source resume.md] [--out build/resume.docx]
        copies the template, drops its sample body, writes each resume.md line with the style
        its front matter maps to that role, copying the template's own paragraph and run format
        for that style (numbering included); `글감:` lines are dropped
    resume.py render [--docx build/resume.docx]
        LibreOffice (deck-builder's renderer: soffice on PATH or DECK_RENDER_DOCKER) to PDF;
        reports the page count against the front matter's `pages:`

resume.md:
    ---
    template: template/resume.docx
    pages: 2
    styles:
      name: Title
      section: Heading1
      entry: Heading2
      bullet: ListBullet
      body: Normal
    ---
    # 이름                       -> name
    contact line                 -> body
    ## 경력                      -> section
    ### 회사 · 기간 · 역할        -> entry
    - 한 일과 결과 **강조**       -> bullet
    글감: <id>                    -> dropped (cited for `manage claims`)
"""
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ROLES = ("name", "section", "entry", "bullet", "body")
PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
STYLE_OF = re.compile(r'<w:pStyle w:val="([^"]+)"')


def fail(msg):
    raise SystemExit(json.dumps({"error": msg}, ensure_ascii=False))


def exposed(paths):
    """The paths git would carry: inside a work tree and not ignored. The user's real material
    (their template, resume.md, the built resume) never goes to git (user, 2026-10-30)."""
    import subprocess
    out = []
    for p in paths:
        d = Path(p).resolve().parent
        while not d.exists():
            d = d.parent
        inside = subprocess.run(["git", "-C", str(d), "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True)
        if inside.returncode != 0 or inside.stdout.strip() != "true":
            continue
        ignored = subprocess.run(["git", "-C", str(d), "check-ignore", "-q", str(Path(p).resolve())])
        if ignored.returncode != 0:
            out.append(str(p))
    return out


def guard(paths):
    bad = exposed(paths)
    if bad:
        fail("inside a git repository and not ignored: %s — your material never goes to git; "
             "add these to that repository's .gitignore or work outside it" % ", ".join(bad))


def front(text):
    """The front matter's `key: value` lines and its `styles:` block; the rest is the body."""
    m = re.match(r"---\n(.*?)\n---\n?", text, re.S)
    if not m:
        return {}, text
    meta, block = {}, None
    for line in m.group(1).split("\n"):
        kv = re.match(r"^(\s*)([A-Za-z_]+):\s*(.*)$", line)
        if not kv:
            continue
        indent, key, val = kv.groups()
        if indent and block is not None:
            meta[block][key] = val.strip()
        elif not val.strip():
            block = key
            meta[key] = {}
        else:
            block = None
            meta[key] = val.strip()
    return meta, text[m.end():]


def lines(body):
    """(role, text) per resume.md line; `글감:` lines and blanks are not written."""
    out = []
    for raw in body.split("\n"):
        s = raw.strip()
        if not s or re.match(r"^(?:[-*]\s*)?글감\s*:", s):
            continue
        for prefix, role in (("### ", "entry"), ("## ", "section"), ("# ", "name"), ("- ", "bullet"), ("* ", "bullet")):
            if s.startswith(prefix):
                out.append((role, s[len(prefix):].strip()))
                break
        else:
            out.append(("body", s))
    return out


def text_of(p):
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p))


def styles(zf):
    """Paragraph styles in styles.xml: id -> name."""
    xml = zf.read("word/styles.xml").decode("utf-8")
    out = {}
    for m in re.finditer(r'<w:style\b[^>]*w:type="paragraph"[^>]*>.*?</w:style>', xml, re.S):
        sid = re.search(r'w:styleId="([^"]+)"', m.group(0))
        name = re.search(r'<w:name w:val="([^"]+)"', m.group(0))
        if sid:
            out[sid.group(1)] = name.group(1) if name else sid.group(1)
    return out


def suggest(sid, name):
    n = (sid + " " + name).lower()
    if "title" in n:
        return "name"
    if re.search(r"heading ?1|제목 ?1", n):
        return "section"
    if re.search(r"heading ?2|제목 ?2", n):
        return "entry"
    if "list" in n or "bullet" in n or "목록" in n:
        return "bullet"
    if "normal" in n or "body" in n or "본문" in n:
        return "body"
    return None


def catalog(template):
    with zipfile.ZipFile(template) as zf:
        names = styles(zf)
        doc = zf.read("word/document.xml").decode("utf-8")
    used = {}
    for p in PARA.findall(doc):
        m = STYLE_OF.search(p)
        sid = m.group(1) if m else "Normal"
        u = used.setdefault(sid, {"count": 0, "sample": ""})
        u["count"] += 1
        if not u["sample"]:
            u["sample"] = text_of(p)[:40]
    rows = [{"id": sid, "name": names.get(sid, sid), **u, "role": suggest(sid, names.get(sid, sid))}
            for sid, u in used.items()]
    return {"template": str(template), "styles": rows}


def para(style, text, ppr, rpr):
    """One paragraph in `style`, its pPr and rPr taken from the template's own sample when it has one."""
    if ppr is None:
        ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % style
    runs = []
    for k, part in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not part:
            continue
        r = rpr or ""
        if k % 2:
            r = (r[:-len("</w:rPr>")] + "<w:b/></w:rPr>") if r else "<w:rPr><w:b/></w:rPr>"
        runs.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (r, escape(part)))
    return "<w:p>%s%s</w:p>" % (ppr, "".join(runs))


def build(source, out):
    meta, body = front(source.read_text(encoding="utf-8"))
    template = Path(meta.get("template", "template/resume.docx"))
    if not template.is_file():
        fail("template not found: %s (the user's own .docx; no built-in look)" % template)
    guard([source, template, out])
    mapping = meta.get("styles") or {}
    missing = [r for r in ROLES if r not in mapping]
    with zipfile.ZipFile(template) as zf:
        known = styles(zf)
        doc = zf.read("word/document.xml").decode("utf-8")
        parts = {n: zf.read(n) for n in zf.namelist()}
    unknown = ["%s: %s" % (r, s) for r, s in mapping.items() if r in ROLES and s not in known]
    todo = lines(body)
    used_roles = {r for r, _ in todo}
    if [r for r in missing if r in used_roles] or unknown:
        fail("styles: map every role resume.md uses to a template style — missing %s, unknown %s"
             % ([r for r in missing if r in used_roles], unknown))
    # the template's own format per style: first paragraph using it gives pPr and its first run's rPr
    sample = {}
    for p in PARA.findall(doc):
        m = STYLE_OF.search(p)
        if m and m.group(1) not in sample:
            ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S)
            rpr = re.search(r"<w:rPr>.*?</w:rPr>", p, re.S)
            sample[m.group(1)] = (ppr.group(0) if ppr else None, rpr.group(0) if rpr else None)
    b = re.search(r"(<w:body>)(.*)(</w:body>)", doc, re.S)
    sect = re.search(r"<w:sectPr\b.*?</w:sectPr>\s*$", b.group(2), re.S)
    new = "".join(para(mapping[r], t, *sample.get(mapping[r], (None, None))) for r, t in todo)
    parts["word/document.xml"] = (doc[:b.start(2)] + new + (sect.group(0) if sect else "") + doc[b.end(2):]).encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in parts.items():
            z.writestr(n, data)
    held = [t for _, t in todo if "[확인 필요" in t]
    return {"docx": str(out), "paragraphs": len(todo), "template": str(template),
            "warnings": ["unconfirmed line kept: %s" % t[:60] for t in held]}


def render(docx, pages=None):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "deck-builder" / "scripts"))
    import deck  # deck-builder's renderer: soffice on PATH or DECK_RENDER_DOCKER
    guard([docx, docx.with_suffix(".pdf")])
    r = deck.Renderer()
    if not r.available:
        fail("no renderer: install LibreOffice (soffice) or set DECK_RENDER_DOCKER=<image>")
    log = r.to_pdf(docx.parent.resolve(), docx.name)
    pdf = docx.with_suffix(".pdf")
    if not pdf.is_file():
        fail("the renderer did not produce a PDF: %s" % log)
    count = len(re.findall(rb"/Type\s*/Page\b", pdf.read_bytes()))
    out = {"pdf": str(pdf), "pages": count, "renderer": r.describe()}
    if pages and count > int(pages):
        out["warnings"] = ["%d pages, over the budget of %s" % (count, pages)]
    return out


def main(argv):
    args = {argv[i][2:]: argv[i + 1] for i in range(1, len(argv) - 1, 2) if argv[i].startswith("--")}
    cmd = argv[0] if argv else ""
    if cmd == "catalog":
        t = Path(args.get("template", "template/resume.docx"))
        guard([t])
        return catalog(t)
    if cmd == "build":
        return build(Path(args.get("source", "resume.md")), Path(args.get("out", "build/resume.docx")))
    if cmd == "render":
        src = Path("resume.md")
        meta = front(src.read_text(encoding="utf-8"))[0] if src.is_file() else {}
        return render(Path(args.get("docx", "build/resume.docx")), meta.get("pages"))
    fail("usage: resume.py catalog | build | render")


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
