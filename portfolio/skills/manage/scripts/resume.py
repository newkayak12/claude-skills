#!/usr/bin/env python3
"""Shim: the resume engine moved to portfolio/skills/resume-builder/scripts/resume.py (2.14.0).

A workspace that pinned this path keeps working: same argv, same output. Use the new path.
"""
import runpy
import sys
from pathlib import Path

engine = Path(__file__).resolve().parents[2] / "resume-builder" / "scripts" / "resume.py"
sys.stderr.write("note: the resume engine moved to %s; this path is a shim, update the pinned path\n" % engine)
sys.argv[0] = str(engine)
runpy.run_path(str(engine), run_name="__main__")
