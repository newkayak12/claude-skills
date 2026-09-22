// conventions.mjs - a project's own rules, folded into node prompts.
//
// Restores a row the MCP rewrite dropped silently: the old generation read
// `.claude/conventions/**` in three prompts (plan, setgoal, implement) so a project's own
// rules reached the work at all. Losing it failed nothing - the run just produced work that
// ignored them, and every gate passed because no criterion ever mentioned them. This module
// is the read path; prompts.mjs wires it into composePrompt.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, dirname, relative, sep } from 'node:path';

const CONVENTIONS_DIR = join('.claude', 'conventions');
export const CONVENTIONS_CAP = 4000;

// Every *.md under <cwd>/.claude/conventions, recursive, sorted by path. A missing dir is
// not an error - most projects have none, and that must render nothing, not an empty section.
export function loadConventions(cwd) {
  const root = join(cwd, CONVENTIONS_DIR);
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // missing dir, or a race deleting it: either way, no conventions
    }
    for (const name of entries.sort()) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && extname(name).toLowerCase() === '.md') files.push(full);
    }
  };
  walk(root);
  files.sort();
  return files.map((full) => {
    let text = '';
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      text = '';
    }
    return { path: relative(cwd, full).split(sep).join('/'), text };
  });
}

// The first heading or, failing that, the first non-empty line - what the file list shows
// per convention so a node can tell what each file is about without opening it.
function firstLine(text) {
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^#+\s*/, '').trim() || '(empty)';
  }
  return '(empty)';
}

// Cheap-on-purpose: does this convention plausibly govern these target files? A convention
// matches when its own path or heading names a directory or extension any target file has.
// False positives just mean an implement node reads one extra file's rules; false negatives
// are the failure mode worth avoiding, so the heuristic is generous.
function matchesFiles(entry, files) {
  if (!files || !files.length) return false;
  const hay = `${entry.path} ${firstLine(entry.text)}`.toLowerCase();
  for (const f of files) {
    const ext = extname(String(f)).toLowerCase().replace(/^\./, '');
    if (ext && ext.length > 1 && hay.includes(ext)) return true;
    const dirs = dirname(String(f)).split(/[\\/]/).filter((d) => d && d !== '.' && d.length > 1);
    if (dirs.some((d) => hay.includes(d.toLowerCase()))) return true;
  }
  return false;
}

function capBlock(block) {
  if (block.length <= CONVENTIONS_CAP) return block;
  const total = block.length;
  return `${block.slice(0, CONVENTIONS_CAP)}\n… [conventions truncated at ${CONVENTIONS_CAP} of ${total} chars]`;
}

// Renders "## Conventions" for a node, or '' when there is nothing to say - no conventions
// dir, or a stage this module has no instruction for. `files` is the node's own target
// files (a subgoal's files[]), used only by implement/draft to decide which conventions'
// full text earns a place in the prompt; plan and setgoal get the list plus an instruction,
// never the full text, because they are not the ones touching files.
export function conventionsBlock(cwd, { stage, files } = {}) {
  const entries = loadConventions(cwd);
  if (!entries.length) return '';

  const list = entries.map((e) => `- ${e.path}: ${firstLine(e.text)}`).join('\n');
  const lines = ['## Conventions', list];

  if (stage === 'plan') {
    lines.push('');
    lines.push('List the rules that must constrain the work in `plan`.');
  } else if (stage === 'setgoal') {
    lines.push('');
    lines.push('Fold applicable conventions into subgoal `acceptance` and `test[]`; name the convention file in the criterion.');
  } else if (stage === 'planning' || stage === 'manager') {
    // A PRD governs the whole tree, so path matching is the wrong filter for it: a rule about
    // how this domain works matches no source path and would have shown up as a title only.
    // idol-pm-1 (2026-09-22) produced a domain-empty PRD with the mechanism sitting right there.
    // The manager's own judging stages get the same list for the same reason - shape splits the
    // work and accept judges the PRD, and neither could see a project rule at all.
    lines.push('');
    lines.push(stage === 'planning'
      ? 'These are this project\'s own rules. They are requirements on what you write, not background: a rule you do not follow is named in Out of scope with the reason, never left unmentioned.'
      : 'These are this project\'s own rules. Judge and shape against them; a result that ignores one has a gap, whatever else it did.');
    for (const e of entries) {
      lines.push('');
      lines.push(`### ${e.path}`);
      lines.push(e.text.trim());
    }
  } else if (stage === 'implement' || stage === 'draft') {
    const matched = entries.filter((e) => matchesFiles(e, files));
    if (matched.length) {
      lines.push('');
      lines.push('The following apply to the files this subgoal touches:');
      for (const e of matched) {
        lines.push('');
        lines.push(`### ${e.path}`);
        lines.push(e.text.trim());
      }
    }
  } else {
    return '';
  }

  return capBlock(lines.join('\n'));
}
