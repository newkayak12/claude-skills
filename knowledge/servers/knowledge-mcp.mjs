#!/usr/bin/env node
import { resolve } from 'node:path';
import { serveMcp } from '../scripts/sqlite-knowledge.mjs';

function rootFromArgs(argv) {
  const index = argv.indexOf('--root');
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function dbFromArgs(argv) {
  const index = argv.indexOf('--db');
  return index >= 0 ? argv[index + 1] : null;
}

await serveMcp({
  root: rootFromArgs(process.argv.slice(2)),
  db: dbFromArgs(process.argv.slice(2)),
});
