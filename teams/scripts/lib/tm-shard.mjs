// Splits test-taskmanager.mjs into shards that run as parallel node:test files.
//
// `test` only collects (name, opts, fn); `flush()` registers this shard's contiguous slice of the
// collected tests through node:test. TM_SHARD=k/N picks slice k of N (equal counts); unset is 1/N;
// `all` registers every test. File-level `after` hooks stay with node:test and run in every shard.
import { test as nodeTest } from 'node:test';

export const SHARDS = 3;

const collected = [];

export function test(name, opts, fn) {
  collected.push([name, opts, fn]);
}

export function flush() {
  const spec = process.env.TM_SHARD || `1/${SHARDS}`;
  let from = 0;
  let to = collected.length;
  if (spec !== 'all') {
    const m = /^(\d+)\/(\d+)$/.exec(spec);
    if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`TM_SHARD must be k/N or all, got ${spec}`);
    const [k, n] = [+m[1], +m[2]];
    from = Math.floor(((k - 1) * collected.length) / n);
    to = Math.floor((k * collected.length) / n);
  }
  for (const [name, opts, fn] of collected.slice(from, to)) {
    if (fn === undefined) nodeTest(name, opts);
    else nodeTest(name, opts, fn);
  }
}
