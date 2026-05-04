"""
PPT Key Color Changer v2
Raw XML engine — replaces colors by directly editing PPTX XML files.

Subcommands:
  discover   Scan PPTX for all srgbClr values + frequency table
  replace    Replace source colors with target colors

Usage:
  python ppt_keycolor_changer.py discover --input file.pptx
  python ppt_keycolor_changer.py replace --input file.pptx \\
      --mapping '{"E85E3A":"0064FF","FF8060":"4D96FF"}' \\
      [--exclude "336699,AABBCC"] \\
      [--suffix tossblue] \\
      [--output out.pptx]

No external dependencies — uses Python stdlib only (zipfile, re, colorsys).
"""

import argparse
import colorsys
import json
import re
import shutil
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path


# ── Color utilities ──────────────────────────────────────────────────────────

def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#").upper()
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"{r:02X}{g:02X}{b:02X}"


def hex_to_hls(h: str) -> tuple[float, float, float]:
    """Returns (hue 0-1, lightness 0-1, saturation 0-1)."""
    r, g, b = hex_to_rgb(h)
    return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)


def is_grayscale(hex_color: str, threshold: int = 20) -> bool:
    r, g, b = hex_to_rgb(hex_color)
    return max(r, g, b) - min(r, g, b) <= threshold


# Always-excluded colors (black, white, near-white)
DEFAULT_EXCLUDE = {"000000", "FFFFFF", "F9F9F9", "FEFEFE", "FDFDFD"}

# ── XML discovery ─────────────────────────────────────────────────────────────

# Matches val="XXXXXX" where XXXXXX is a 6-hex-digit color value in OOXML
COLOR_ATTR_PATTERN = re.compile(r'val="([0-9A-Fa-f]{6})"', re.IGNORECASE)


def scan_xml_colors(zip_path: str) -> Counter:
    """Scan all XML/RELS files in a PPTX and return Counter of hex color values."""
    counts: Counter = Counter()
    with zipfile.ZipFile(zip_path, "r") as zf:
        for name in zf.namelist():
            if not (name.endswith(".xml") or name.endswith(".rels")):
                continue
            try:
                content = zf.read(name).decode("utf-8", errors="ignore")
                for m in COLOR_ATTR_PATTERN.finditer(content):
                    counts[m.group(1).upper()] += 1
            except Exception:
                pass
    return counts


def discover(input_path: str) -> None:
    counts = scan_xml_colors(input_path)
    if not counts:
        print("No srgbClr color values found in the PPTX.")
        return

    total_unique = len(counts)
    print(f"\nDiscovered colors in: {Path(input_path).name}")
    print(f"Total unique colors: {total_unique}\n")
    print(f"{'Rank':<5} {'Hex':<9} {'Count':<8} {'Notes'}")
    print("-" * 45)

    for i, (hex_val, count) in enumerate(counts.most_common(40), 1):
        tags = []
        if hex_val in DEFAULT_EXCLUDE:
            tags.append("always-exclude")
        elif is_grayscale(hex_val):
            tags.append("grayscale")
        note = f"  [{', '.join(tags)}]" if tags else ""
        print(f"{i:<5} #{hex_val:<8} {count:<8}{note}")

    if total_unique > 40:
        print(f"  ... and {total_unique - 40} more (showing top 40)")

    print("\nTo replace, use:")
    print('  replace --input file.pptx --mapping \'{"SRC_HEX": "DST_HEX", ...}\'')


# ── XML replacement ───────────────────────────────────────────────────────────

def replace_in_content(content: str, src_upper: str, dst_upper: str) -> tuple[str, int]:
    """Case-insensitive replace of val="SRC" → val="DST" in XML content."""
    pattern = re.compile(r'val="' + re.escape(src_upper) + '"', re.IGNORECASE)
    new_content, n = pattern.subn(f'val="{dst_upper}"', content)
    return new_content, n


def safe_output_path(input_path: str, suffix: str | None, mapping: dict) -> str:
    """Generate a non-colliding output path with the target color or suffix in the name."""
    p = Path(input_path)
    if suffix:
        label = suffix
    else:
        # Use first target hex as label
        label = next(iter(mapping.values()), "recolored").lower()

    base_name = f"{p.stem}_{label}{p.suffix}"
    candidate = p.parent / base_name
    if not candidate.exists():
        return str(candidate)

    # Auto-increment _v2, _v3, ...
    for v in range(2, 100):
        versioned = p.parent / f"{p.stem}_{label}_v{v}{p.suffix}"
        if not versioned.exists():
            return str(versioned)

    return str(p.parent / f"{p.stem}_recolored{p.suffix}")


def replace_colors(
    input_path: str,
    mapping: dict,
    exclude: set[str],
    output_path: str,
) -> dict[str, int]:
    """
    Replace all val="SRC" occurrences with val="DST" across every XML/RELS
    file inside the PPTX, preserving all non-XML entries (images, etc.) unchanged.

    mapping: {SRC_HEX_UPPER: DST_HEX_UPPER}
    Returns per-source replacement counts.
    """
    # Skip any source that's in the explicit exclude list
    active_mapping: dict[str, str] = {}
    for src, dst in mapping.items():
        if src in exclude:
            print(f"  [skip] #{src} is in --exclude list, skipping.")
            continue
        active_mapping[src] = dst

    counts = {src: 0 for src in active_mapping}

    # Write to a temp file first, then move to output
    tmp = tempfile.NamedTemporaryFile(suffix=".pptx", delete=False)
    tmp.close()

    try:
        with zipfile.ZipFile(input_path, "r") as zin, \
             zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename.endswith(".xml") or item.filename.endswith(".rels"):
                    try:
                        content = data.decode("utf-8")
                        for src, dst in active_mapping.items():
                            content, n = replace_in_content(content, src, dst)
                            counts[src] += n
                        data = content.encode("utf-8")
                    except Exception:
                        pass  # Binary or undecodable — keep original
                zout.writestr(item, data)

        shutil.move(tmp.name, output_path)
    except Exception:
        Path(tmp.name).unlink(missing_ok=True)
        raise

    return counts


# ── Verification ──────────────────────────────────────────────────────────────

def verify_residuals(output_path: str, source_hexes: list[str]) -> dict[str, int]:
    """Return a dict of source hex → remaining count for any that still appear."""
    counts = scan_xml_colors(output_path)
    return {
        src.upper(): counts[src.upper()]
        for src in source_hexes
        if counts.get(src.upper(), 0) > 0
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def validate_input(path: Path) -> None:
    if not path.exists():
        print(f"ERROR: File not found: {path}")
        sys.exit(1)
    if path.suffix.lower() not in (".pptx", ".pptm"):
        print(f"ERROR: Only .pptx / .pptm files are supported. Got: {path.suffix}")
        sys.exit(1)
    # Warn if same-name PDF sits alongside
    pdf_sibling = path.with_suffix(".pdf")
    if pdf_sibling.exists():
        print(f"NOTE: Found {pdf_sibling.name} in same folder — proceeding with PPTX only.\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="PPT Key Color Changer v2 — raw XML engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd")

    # ── discover ──
    d = sub.add_parser("discover", help="Scan PPTX and show all colors + frequency")
    d.add_argument("--input", required=True, help="Path to .pptx file")

    # ── replace ──
    r = sub.add_parser("replace", help="Replace colors via raw XML substitution")
    r.add_argument("--input", required=True, help="Path to source .pptx file")
    r.add_argument(
        "--mapping", required=True,
        help='JSON map: {"SRC_HEX": "DST_HEX", ...} (uppercase, no #)',
    )
    r.add_argument(
        "--exclude", default="",
        help="Comma-separated hex colors to never replace (in addition to built-in defaults)",
    )
    r.add_argument(
        "--suffix", default=None,
        help="Label for output filename, e.g. --suffix tossblue → file_tossblue.pptx",
    )
    r.add_argument(
        "--output", default=None,
        help="Full output path (overrides auto-naming)",
    )

    args = parser.parse_args()

    if args.cmd is None:
        parser.print_help()
        sys.exit(1)

    input_path = Path(args.input)
    validate_input(input_path)

    if args.cmd == "discover":
        discover(str(input_path))
        return

    # ── replace flow ──
    try:
        raw_mapping: dict = json.loads(args.mapping)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid --mapping JSON: {e}")
        sys.exit(1)

    # Normalize: uppercase, strip #
    mapping = {
        k.lstrip("#").upper(): v.lstrip("#").upper()
        for k, v in raw_mapping.items()
    }

    # Build exclude set (defaults + user-provided)
    exclude = set(DEFAULT_EXCLUDE)
    if args.exclude:
        for ex in args.exclude.split(","):
            ex = ex.strip().lstrip("#").upper()
            if ex:
                exclude.add(ex)

    out_path = args.output or safe_output_path(str(input_path), args.suffix, mapping)

    print(f"Input : {input_path.name}")
    print(f"Output: {Path(out_path).name}")
    print(f"\nMapping ({len(mapping)} colors):")
    for src, dst in mapping.items():
        skip = " [SKIPPED — in exclude list]" if src in exclude else ""
        print(f"  #{src} → #{dst}{skip}")

    print("\nApplying raw XML replacement...")
    counts = replace_colors(str(input_path), mapping, exclude, out_path)

    print("\nReplacement results:")
    total = sum(counts.values())
    for src, n in counts.items():
        dst = mapping[src]
        status = f"{n} occurrence{'s' if n != 1 else ''}"
        print(f"  #{src} → #{dst}: {status}")
    print(f"  Total: {total} replacements")

    print("\nVerifying residuals...")
    residuals = verify_residuals(out_path, list(mapping.keys()))
    if residuals:
        print("  WARNING — residual source colors remain in the output:")
        for src, count in residuals.items():
            print(f"    #{src}: {count} occurrence(s) still present")
        print(
            "\n  Likely causes:\n"
            "  • Embedded images (PNG/JPEG) — colors inside images cannot be changed via XML.\n"
            "  • External Excel charts — some series colors may live in a linked .xlsx file.\n"
            "  These must be edited manually."
        )
    else:
        print("  OK — no residual source colors found.")

    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
