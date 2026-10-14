#!/usr/bin/env python3
"""Screenshot a mod as it renders in a live Claude Code session (README images, UI checks).

  tmux new-session -d -s shot -x 190 -y 34 "claude --plugin-dir ./<plugin>"   # open the pane in it
  python3 _repo/scripts/mod-shot.py shot out.png [--rows A:B] [--cols A:B]

Captures the tmux pane with colours (`capture-pane -e`), writes it as HTML (wide CJK glyphs held
to two cells, the bundled NanumSquare for Hangul) and screenshots it with headless Chromium
(Playwright's headless_shell, or chromium/google-chrome on PATH).
"""
import argparse, glob, html, os, re, shutil, subprocess, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = os.path.join(ROOT, "portfolio/skills/deck-builder/assets/fonts/NanumSquareB.ttf")
SGR = re.compile(r"(\x1b\[[0-9;:]*m)")
BASE = ["#1e1e1e", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"]
BRIGHT = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"]


def c256(n):
    if n < 8:
        return BASE[n]
    if n < 16:
        return BRIGHT[n - 8]
    if n < 232:
        n -= 16
        v = [0, 95, 135, 175, 215, 255]
        return "#%02x%02x%02x" % (v[n // 36], v[n // 6 % 6], v[n % 6])
    g = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (g, g, g)


def cells(line):
    """[(char, style)] one entry per glyph, with the SGR state in force."""
    st = {"fg": None, "bg": None, "b": False, "dim": False, "it": False, "ul": False, "inv": False}
    out = []
    for part in SGR.split(line):
        m = re.fullmatch(r"\x1b\[([0-9;:]*)m", part)
        if not m:
            out += [(ch, dict(st)) for ch in part]
            continue
        ps = [int(x) if x.isdigit() else 0 for x in re.split("[;:]", m.group(1) or "0")]
        i = 0
        while i < len(ps):
            p = ps[i]
            if p == 0:
                st = {k: (False if isinstance(v, bool) else None) for k, v in st.items()}
            elif p in (1, 2, 3, 4, 7):
                st[{1: "b", 2: "dim", 3: "it", 4: "ul", 7: "inv"}[p]] = True
            elif p == 22:
                st["b"] = st["dim"] = False
            elif p in (23, 24, 27):
                st[{23: "it", 24: "ul", 27: "inv"}[p]] = False
            elif 30 <= p <= 37:
                st["fg"] = BASE[p - 30]
            elif p == 39:
                st["fg"] = None
            elif 40 <= p <= 47:
                st["bg"] = BASE[p - 40]
            elif p == 49:
                st["bg"] = None
            elif 90 <= p <= 97:
                st["fg"] = BRIGHT[p - 90]
            elif 100 <= p <= 107:
                st["bg"] = BRIGHT[p - 100]
            elif p in (38, 48) and i + 1 < len(ps):
                key = "fg" if p == 38 else "bg"
                if ps[i + 1] == 5 and i + 2 < len(ps):
                    st[key] = c256(ps[i + 2])
                    i += 2
                elif ps[i + 1] == 2 and i + 4 < len(ps):
                    st[key] = "#%02x%02x%02x" % tuple(ps[i + 2:i + 5])
                    i += 4
            i += 1
    return out


def slice_cols(cs, a, b):
    """Keep terminal columns a..b (a wide glyph takes two)."""
    out, col = [], 0
    for ch, st in cs:
        w = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
        if a <= col and col + w <= b:
            out.append((ch, st))
        col += w
    return out


def to_html(cs):
    out = []
    for ch, st in cs:
        fg, bg = st["fg"] or "#d4d4d4", st["bg"]
        if st["inv"]:
            fg, bg = (bg or "#1e1e1e"), fg
        css = "color:%s;" % fg + ("background:%s;" % bg if bg else "")
        css += "font-weight:bold;" * st["b"] + "opacity:.6;" * st["dim"]
        css += "font-style:italic;" * st["it"] + "text-decoration:underline;" * st["ul"]
        glyph = html.escape(ch)
        if unicodedata.east_asian_width(ch) in "WF":
            glyph = "<i class=w>%s</i>" % glyph
        out.append('<span style="%s">%s</span>' % (css, glyph))
    return "".join(out)


def pane_box(raw):
    """Rows and columns of the first rounded box (the pane), by terminal column."""
    def col_of(line, ch):
        col = 0
        for c, _ in cells(line):
            if c == ch:
                return col
            col += 2 if unicodedata.east_asian_width(c) in "WF" else 1
        return None
    for top, line in enumerate(raw):
        left = col_of(line, "╭")
        if left is None:
            continue
        right = col_of(line, "╮")
        for bottom in range(top + 1, len(raw)):
            if col_of(raw[bottom], "╰") == left:
                return top, bottom + 1, left, (right or left) + 1
    raise SystemExit("no pane box on screen")


def browser():
    found = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/*/headless_shell"))
    for name in ("chromium", "chromium-browser", "google-chrome"):
        if shutil.which(name):
            found.append(shutil.which(name))
    if not found:
        raise SystemExit("no headless Chromium (install Playwright's chromium, or chromium on PATH)")
    return sorted(found)[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session")
    ap.add_argument("out")
    ap.add_argument("--rows", default=":")
    ap.add_argument("--cols", default=":")
    ap.add_argument("--pane", action="store_true", help="crop to the first rounded box (╭…╯), i.e. the pane")
    a = ap.parse_args()
    raw = subprocess.run(["tmux", "capture-pane", "-t", a.session, "-p", "-e"],
                         capture_output=True, text=True, check=True).stdout.split("\n")
    r0, r1 = (int(x) if x else None for x in a.rows.split(":"))
    c0, c1 = (int(x) if x else None for x in a.cols.split(":"))
    if a.pane:
        r0, r1, c0, c1 = pane_box(raw)
    rows = [slice_cols(cells(l), c0 or 0, c1 or 10 ** 6) for l in raw[r0:r1]]
    while rows and not "".join(ch for ch, _ in rows[-1]).strip():
        rows.pop()
    width = max((sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch, _ in r) for r in rows),
                default=80)
    doc = ("<!doctype html><meta charset=utf-8><style>@font-face{font-family:KR;font-display:block;src:url('file://%s')}"
           "body{margin:0;background:#1e1e1e}"
           "i.w{font-style:normal;display:inline-block;width:2ch;text-align:center}"
           "pre{margin:0;padding:14px 16px;font:15px/1.25 'DejaVu Sans Mono',KR,monospace;"
           "color:#d4d4d4;white-space:pre}</style>"
           # an off-screen Hangul glyph takes the font's first-use miss (else the first visible one is tofu)
           "<div style='position:absolute;left:-999px;font-family:KR'>가</div><pre>%s</pre>"
           % (FONT, "\n".join(to_html(r) for r in rows)))
    src = os.path.splitext(os.path.abspath(a.out))[0] + ".html"
    with open(src, "w", encoding="utf-8") as f:
        f.write(doc)
    # the budget lets the Hangul web font load before the shot (else the first glyph is tofu)
    subprocess.run([browser(), "--headless", "--no-sandbox", "--hide-scrollbars", "--virtual-time-budget=3000",
                    "--screenshot=" + os.path.abspath(a.out),
                    "--window-size=%d,%d" % (int(width * 9.1) + 40, int(len(rows) * 18.75) + 30),
                    "file://" + src], capture_output=True)
    os.remove(src)
    print(a.out if os.path.exists(a.out) else "no screenshot written")


if __name__ == "__main__":
    main()
