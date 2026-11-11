#!/usr/bin/env python3
"""portfolio:resume-builder — resume-deck.mdx written into the user's own Word template, then PDF.

The source is resume-deck.mdx (designed in resume-skeleton.md); a workspace older than 2.14 calls
it resume.md, read when resume-deck.mdx is absent. Its format is the "resume.md" block below.

Stdlib only. Run from the workspace root; every subcommand prints one JSON object.

    resume.py catalog [--template template/resume.docx]
        the template's paragraph styles: id, name, how many paragraphs use it, a sample,
        and a suggested role (name | section | entry | bullet | body)
    resume.py build [--source resume-deck.mdx] [--out build/resume.docx]
        copies the template, drops its sample body, writes each resume.md line with the style
        its front matter maps to that role, copying the template's own paragraph and run format
        for that style (numbering included); `글감:` lines are dropped
    resume.py render [--docx build/resume.docx]
        LibreOffice (portfolio/scripts/office_render.py: soffice on PATH or DECK_RENDER_DOCKER) to PDF;
        reports the page count against the front matter's `pages:`; rewrites the page previews
        build/pages/resume-p-N.png (the old ones deleted first) and prints the final-check verdicts.
        Before calling anything submittable: `office_render.py final-check [--dir build]
        [--allow "Claude Code,Codex"] [--author NAME]`

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
    {meta} 기술: Kotlin, Spring   -> meta (any role, named outright)
    글감: <id>                    -> dropped (cited for `manage claims`)

    A template that tells its lines apart by run format only (every paragraph Normal, as most hand-made
    resumes) is mapped with `samples:` instead of `styles:` — role: the opening text of the template
    paragraph whose look it takes (font, size, colour, spacing, list numbering, all copied):
    samples:
      name: 홍길동
      contact: Email
      section: 핵심역량
      company: 달빛상점
      meta: 기술
    `catalog` lists each distinct look once (`looks`: sample text, pt, bold, colour, list) to pick from.
    The template's photo (an anchored drawing) is kept on the first paragraph.
    Finish keys (no post-build script): `keep: section, entry` (roles kept with the next line),
    `spacing:` role: <before> <after> in pt, `title:`, `author:`, `photo_alt:`. A `라벨: 값` line takes a
    two-format sample's label and value runs; URLs and mail addresses become links.
"""
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import office_render  # noqa: E402  the renderer and the AI-trace check, shared with deck-builder

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
    """(role, text) per resume.md line; `글감:` lines and blanks are not written. `{role} text` names
    any role outright (contact, company, meta …), for lines the five markdown shapes do not tell apart."""
    out = []
    for raw in body.split("\n"):
        s = raw.strip()
        if not s or re.match(r"^(?:[-*]\s*)?글감\s*:", s):
            continue
        named = re.match(r"^\{([a-z][a-z0-9_-]*)\}\s*(.*)$", s)
        if named:
            out.append((named.group(1), named.group(2).strip()))
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
    # a template that tells its lines apart by run format only (every paragraph Normal) is mapped by
    # `samples:`: each distinct look once, with the text that picks it
    looks, seen = [], set()
    for p in PARA.findall(doc):
        t = text_of(p).strip()
        if not t:
            continue
        rpr = first_rpr(p) or ""
        size = re.search(r'<w:sz w:val="(\d+)"', rpr)
        color = re.search(r'<w:color w:val="([0-9A-Fa-f]{6})"', rpr)
        look = (size.group(1) if size else None, "<w:b/>" in rpr or "<w:b " in rpr, color.group(1) if color else None,
                bool(re.search(r"<w:numPr>", p)))
        if look in seen:
            continue
        seen.add(look)
        looks.append({"sample": t[:30], "pt": int(look[0]) / 2 if look[0] else None, "bold": look[1],
                      "color": look[2], "list": look[3]})
    return {"template": str(template), "styles": rows, "looks": looks}


def first_rpr(p):
    """The run properties of the paragraph's first run that carries text."""
    for r in re.findall(r"<w:r[ >].*?</w:r>", p, re.S):
        if "<w:t" in r:
            m = re.search(r"<w:rPr>.*?</w:rPr>", r, re.S)
            return m.group(0) if m else None
    return None


def label_rpr(p):
    """A template line `라벨: 값` whose label and value are two run formats: (label rPr, value rPr), else None."""
    runs = [(("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r))), re.search(r"<w:rPr>.*?</w:rPr>", r, re.S))
            for r in re.findall(r"<w:r[ >].*?</w:r>", p, re.S) if "<w:t" in r]
    runs = [(t, m.group(0) if m else "") for t, m in runs if t]
    if len(runs) < 2:
        return None
    text = ""
    for i, (t, rpr) in enumerate(runs):
        text += t
        if re.search(r"[:：]\s*$", text) and i + 1 < len(runs) and runs[i + 1][1] != runs[0][1]:
            return runs[0][1], runs[i + 1][1]
    return None


def by_text(doc, prefix):
    """(pPr, rPr, label) of the first template paragraph whose text starts with `prefix`, or None."""
    for p in PARA.findall(doc):
        if text_of(p).strip().startswith(prefix):
            ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S)
            return (ppr.group(0) if ppr else "<w:pPr/>", first_rpr(p), label_rpr(p))
    return None


LINK = re.compile(r"(https?://[^\s·,]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)")


def text_runs(text, rpr, links):
    """Runs for `text` in `rpr`: **bold** parts bold; a URL or mail address a hyperlink (its target
    appended to `links` as (rId, url), written to the package rels by build)."""
    out = []
    for k, part in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not part:
            continue
        r = rpr or ""
        if k % 2:
            r = (r[:-len("</w:rPr>")] + "<w:b/></w:rPr>") if r else "<w:rPr><w:b/></w:rPr>"
        for j, bit in enumerate(LINK.split(part)):
            if not bit:
                continue
            run = '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
            if j % 2 and links is not None:
                rid = "rIdResumeLink%d" % (len(links) + 1)
                links.append((rid, bit if bit.startswith("http") else "mailto:" + bit))
                lr = (r[:-len("</w:rPr>")] if r else "<w:rPr>") + '<w:u w:val="single"/></w:rPr>'
                out.append('<w:hyperlink r:id="%s">%s</w:hyperlink>' % (rid, run % (lr, escape(bit))))
            else:
                out.append(run % (r, escape(bit)))
    return "".join(out)


def para(style, text, ppr, rpr, label=None, links=None):
    """One paragraph in `style`, its pPr and rPr taken from the template's own sample when it has one;
    a `라벨: 값` line takes the sample's two formats when its sample has them."""
    if ppr is None:
        ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % style
    m = re.match(r"^([^:：]{1,12}[:：])(.*)$", text, re.S) if label else None
    if m:
        return "<w:p>%s%s%s</w:p>" % (ppr, text_runs(m.group(1), label[0], links), text_runs(m.group(2), label[1], links))
    return "<w:p>%s%s</w:p>" % (ppr, text_runs(text, rpr, links))


def tune(ppr, keep=False, before=None, after=None):
    """pPr with keepNext (a heading never ends a page) and spacing before/after (twips) set."""
    ppr = ppr if ppr and ppr != "<w:pPr/>" else "<w:pPr></w:pPr>"
    if keep and "<w:keepNext/>" not in ppr:
        st = re.search(r"<w:pStyle [^>]*/>", ppr)
        at = st.end() if st else len("<w:pPr>")
        ppr = ppr[:at] + "<w:keepNext/>" + ppr[at:]
    if before is None and after is None:
        return ppr
    sp = re.search(r"<w:spacing\b[^>]*/>", ppr)
    tag = sp.group(0) if sp else "<w:spacing/>"
    for k, v in (("before", before), ("after", after)):
        if v is None:
            continue
        tag = re.sub(r'\sw:%s="\d+"' % k, "", tag)
        tag = tag.replace("<w:spacing", '<w:spacing w:%s="%d"' % (k, v), 1)
    if sp:
        return ppr.replace(sp.group(0), tag, 1)
    # spacing sits after numPr/pBdr and before ind/jc in the schema order
    nxt = re.search(r"<w:(ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|"
                    r"textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b", ppr)
    at = nxt.start() if nxt else len(ppr) - len("</w:pPr>")
    return ppr[:at] + tag + ppr[at:]


def build(source, out):
    meta, body = front(source.read_text(encoding="utf-8"))
    template = Path(meta.get("template", "template/resume.docx"))
    if not template.is_file():
        fail("template not found: %s (the user's own .docx; no built-in look)" % template)
    guard([source, template, out])
    mapping = meta.get("styles") or {}
    by_sample = meta.get("samples") or {}
    with zipfile.ZipFile(template) as zf:
        known = styles(zf)
        doc = zf.read("word/document.xml").decode("utf-8")
        parts = {n: zf.read(n) for n in zf.namelist()}
    todo = lines(body)
    used_roles = {r for r, _ in todo}
    missing = sorted(r for r in used_roles if r not in mapping and r not in by_sample)
    unknown = ["%s: %s" % (r, s) for r, s in mapping.items() if r not in by_sample and s not in known]
    # samples: a role takes the exact look of a template paragraph picked by its opening text, so a
    # template whose lines differ by run format only (all Normal) is used as it is, not re-styled by hand
    from_text = {}
    for r, prefix in by_sample.items():
        got = by_text(doc, prefix)
        if got is None:
            unknown.append("%s: no template paragraph starts with %r (resume.py catalog lists the looks)" % (r, prefix))
        else:
            from_text[r] = got
    if missing or unknown:
        fail("map every role the resume uses to a template style (styles:) or sample paragraph (samples:) — "
             "missing %s, unknown %s" % (missing, unknown))
    # the template's own format per style: first paragraph using it gives pPr and its first run's rPr
    sample = {}
    for p in PARA.findall(doc):
        m = STYLE_OF.search(p)
        if m and m.group(1) not in sample:
            ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S)
            sample[m.group(1)] = (ppr.group(0) if ppr else None, first_rpr(p))
    b = re.search(r"(<w:body>)(.*)(</w:body>)", doc, re.S)
    sect = re.search(r"<w:sectPr\b.*?</w:sectPr>\s*$", b.group(2), re.S)
    # spacing: `role: <before> <after>` in pt overrides the template's; a heading (section, entry) is
    # kept with the line after it; the first line under a section starts with no space of its own
    spacing = {}
    for r, v in (meta.get("spacing") or {}).items():
        nums = re.findall(r"\d+(?:\.\d+)?", v)
        if len(nums) != 2:
            fail("spacing: %s: give two numbers in pt, before and after — got %r" % (r, v))
        spacing[r] = [round(float(n) * 20) for n in nums]
    keep = {k.strip() for k in meta.get("keep", "section, entry").split(",") if k.strip()}
    links, out_paras = [], []
    for i, (r, t) in enumerate(todo):
        ppr, rpr, label = from_text[r] if r in from_text else (*sample.get(mapping[r], (None, None)), None)
        if ppr is None:
            ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % mapping[r]
        before, after = spacing.get(r, (None, None))
        if i and todo[i - 1][0] == "section":
            before = 0
        ppr = tune(ppr, keep=r in keep, before=before, after=after)
        out_paras.append(para(None, t, ppr, rpr, label, links))
    new = "".join(out_paras)
    # the template's photo (an anchored <w:drawing> run) rides along on the first paragraph —
    # the user's resume carries a photo and the template is the only place its frame lives (user, 2026-11-09)
    pic = re.search(r"<w:r[ >](?:(?!</w:r>).)*?<w:drawing>.*?</w:drawing>.*?</w:r>", doc, re.S)
    if pic and new.startswith("<w:p>"):
        first = re.match(r"<w:p>(<w:pPr>.*?</w:pPr>)?", new, re.S)
        cut = first.end()
        new = new[:cut] + pic.group(0) + new[cut:]
    head = doc[:b.start(2)]
    if links and "xmlns:r=" not in head:
        head = head.replace("<w:document ", '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
    if meta.get("photo_alt"):
        new = re.sub(r'(<wp:docPr\b[^>]*?)\sdescr="[^"]*"', r"\1", new)
        new = re.sub(r"(<wp:docPr\b)", r'\1 descr="%s"' % escape(meta["photo_alt"], {'"': "&quot;"}), new)
    parts["word/document.xml"] = (head + new + (sect.group(0) if sect else "") + doc[b.end(2):]).encode("utf-8")
    rels_name = "word/_rels/document.xml.rels"
    if links:
        rels = parts.get(rels_name, b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                         b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>').decode("utf-8")
        rels = re.sub(r'<Relationship Id="rIdResumeLink\d+"[^>]*/>', "", rels)
        add = "".join('<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
                      'Target="%s" TargetMode="External"/>' % (rid, escape(u, {'"': "&quot;"})) for rid, u in links)
        parts[rels_name] = rels.replace("</Relationships>", add + "</Relationships>").encode("utf-8")
    # document properties: the title and author the front matter names (never a tool's name)
    if "docProps/core.xml" in parts and (meta.get("title") or meta.get("author")):
        core = parts["docProps/core.xml"].decode("utf-8")
        for tag, val in (("dc:title", meta.get("title")), ("dc:creator", meta.get("author")), ("cp:lastModifiedBy", meta.get("author"))):
            if not val:
                continue
            el = "<%s>%s</%s>" % (tag, escape(val), tag)
            if re.search(r"<%s\b" % tag, core):
                core = re.sub(r"<%s\b[^>]*/>|<%s\b[^>]*>.*?</%s>" % (tag, tag, tag), el, core, count=1, flags=re.S)
            else:
                core = core.replace("</cp:coreProperties>", el + "</cp:coreProperties>")
        parts["docProps/core.xml"] = core.encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in parts.items():
            z.writestr(n, data)
    held = [t for _, t in todo if "[확인 필요" in t]
    traces = office_render.ai_traces(out)   # the last check: every AI trace goes (alt text, properties, sentences)
    final = office_render.final_check([out])
    return {"docx": str(out), "paragraphs": len(todo), "template": str(template),
            "ai_traces": traces,
            "final_check": office_render.final_lines(final),
            # AI traces are in ai_traces.reported and final_check already; warnings holds the rest
            "warnings": ["unconfirmed line kept: %s" % t[:60] for t in held]}


def render(docx, pages=None):
    guard([docx, docx.with_suffix(".pdf")])
    r = office_render.Renderer()
    if not r.available:
        fail("no renderer: install LibreOffice (soffice) or set DECK_RENDER_DOCKER=<image>")
    log = r.to_pdf(docx.parent.resolve(), docx.name)
    pdf = docx.with_suffix(".pdf")
    if not pdf.is_file():
        fail("the renderer did not produce a PDF: %s" % log)
    count = len(re.findall(rb"/Type\s*/Page\b", pdf.read_bytes()))
    out = {"pdf": str(pdf), "pages": count, "renderer": r.describe()}
    # previews are always regenerated, so a page PNG never outlives the PDF it came from
    shots = r.previews(docx.parent.resolve(), pdf.name, dpi=80, prefix="resume-p")
    out["previews"] = [str(s) for s in shots]
    if not shots:
        out["previews_note"] = "no page previews: pdftoppm is not available"
    out["final_check"] = office_render.final_lines(office_render.final_check([docx, pdf]))
    if pages and count > int(pages):
        out["warnings"] = ["%d pages, over the budget of %s" % (count, pages)]
        over = overflow_lines(pdf, int(pages))
        if over is not None:
            # how much to cut, so the cut is sized before anything is shortened (text first, never the type)
            out["over_lines"] = over
            out["warnings"].append("%d text lines past page %s: shorten the text by that much, never the type size"
                                   % (over, pages))
    return out


def overflow_lines(pdf, budget):
    """Non-empty text lines on the pages past the budget (pdftotext), or None when it is not installed."""
    import subprocess
    if not shutil.which("pdftotext"):
        return None
    r = subprocess.run(["pdftotext", "-f", str(budget + 1), "-layout", str(pdf), "-"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return sum(1 for line in r.stdout.split("\n") if line.strip())


def default_source():
    """resume-deck.mdx (the build source beside resume-skeleton.md); resume.md in a workspace older than 2.14."""
    new = Path("resume-deck.mdx")
    return new if new.is_file() or not Path("resume.md").is_file() else Path("resume.md")


def main(argv):
    args = {argv[i][2:]: argv[i + 1] for i in range(1, len(argv) - 1, 2) if argv[i].startswith("--")}
    cmd = argv[0] if argv else ""
    if cmd == "catalog":
        t = Path(args.get("template", "template/resume.docx"))
        guard([t])
        return catalog(t)
    if cmd == "build":
        return build(Path(args["source"]) if "source" in args else default_source(), Path(args.get("out", "build/resume.docx")))
    if cmd == "render":
        src = Path(args["source"]) if "source" in args else default_source()
        meta = front(src.read_text(encoding="utf-8"))[0] if src.is_file() else {}
        return render(Path(args.get("docx", "build/resume.docx")), meta.get("pages"))
    fail("usage: resume.py catalog | build | render")


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
