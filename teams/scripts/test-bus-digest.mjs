import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busDigest } from './lib/bus-digest.mjs';

const sample = () => [
  { ts: 1000, from: 'E-de2a5672/P1', to: 'teamleader', topic: 'E-de2a5672/P1', body: 'probe' },
  { ts: 1001, from: 'E-de2a5672/P1', to: 'E-de2a5672/P2', topic: 'E-de2a5672/P2', body: 'note' },
];

test('deterministic: same array twice gives equal output', () => {
  const a = sample();
  assert.strictEqual(busDigest(a), busDigest(a));
});

test('empty input returns bus: 0 msg without throwing', () => {
  assert.strictEqual(busDigest([]), 'bus: 0 msg');
  assert.strictEqual(busDigest([]), 'bus: 0 msg');
});

test('worked example matches exactly', () => {
  assert.strictEqual(busDigest(sample()), 'bus: 2 msg, last E-de2a5672/P1 -> E-de2a5672/P2 @ 1001');
});

test('highest ts wins even when not last', () => {
  const a = [
    { ts: 30, from: 'a', to: 'b' },
    { ts: 10, from: 'c', to: 'd' },
  ];
  assert.strictEqual(busDigest(a), 'bus: 2 msg, last a -> b @ 30');
});

test('equal ts: later array position wins', () => {
  const a = [
    { ts: 5, from: 'a', to: 'b' },
    { ts: 5, from: 'c', to: 'd' },
  ];
  assert.strictEqual(busDigest(a), 'bus: 2 msg, last c -> d @ 5');
});

test('input is not mutated', () => {
  const a = sample();
  const before = structuredClone(a);
  busDigest(a);
  assert.deepStrictEqual(a, before);
});
