import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetInstant, capacityWait, parkCapacity } from '../mcp/capacity-reset.mjs';

// The host zone is pinned in-process: Asia/Seoul is UTC+9 all year, so every expectation below is
// written as an explicit UTC instant, independent of the code under test.
const hadTZ = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
const prevTZ = process.env.TZ;
before(() => { process.env.TZ = 'Asia/Seoul'; });
after(() => { if (hadTZ) process.env.TZ = prevTZ; else delete process.env.TZ; });

const MIN = 60 * 1000;
const utc = (...a) => Date.UTC(...a);

test('a date and time with no zone is read in the host local zone', () => {
  const since = utc(2026, 10, 1);
  assert.equal(resetInstant('You\'ve hit your session limit · resets Nov 10 at 6pm', since), utc(2026, 10, 10, 9, 0));
});

test('a named zone wins over the host zone for a dated message', () => {
  assert.equal(resetInstant('resets Oct 1, 9am (UTC)', utc(2026, 8, 1)), utc(2026, 9, 1, 9, 0));
});

test('a named zone with daylight saving is resolved at the target date', () => {
  assert.equal(resetInstant('resets Nov 20, 9am (America/New_York)', utc(2026, 10, 1)), utc(2026, 10, 20, 14, 0));
  assert.equal(resetInstant('resets Jul 4 9am (America/New_York)', utc(2026, 5, 1)), utc(2026, 6, 4, 13, 0));
});

test('a past month/day rolls to the next year', () => {
  assert.equal(resetInstant('resets Nov 10 at 6pm', utc(2026, 10, 16)), utc(2027, 10, 10, 9, 0));
});

test('a month/day later than since stays in since\'s year; the minutes are optional or given', () => {
  assert.equal(resetInstant('resets Dec 3 at 6:30pm', utc(2026, 10, 16)), utc(2026, 11, 3, 9, 30));
  assert.equal(resetInstant('resets December 3rd, 12am', utc(2026, 10, 16)), utc(2026, 11, 2, 15, 0));
});

test('a time with no zone is read in the host local zone', () => {
  // 2026-11-01 09:00 Seoul; 5:40pm Seoul is later the same day.
  assert.equal(resetInstant('resets 5:40pm', utc(2026, 10, 1, 0, 0)), utc(2026, 10, 1, 8, 40));
});

test('a time already past today in the host zone rolls to the next day', () => {
  // 2026-11-01 20:00 Seoul has passed 5:40pm Seoul.
  assert.equal(resetInstant('resets 5:40pm', utc(2026, 10, 1, 11, 0)), utc(2026, 10, 2, 8, 40));
});

test('a time with a named zone keeps parsing: minutes optional, zone wins', () => {
  assert.equal(resetInstant('resets 5:40pm (UTC)', utc(2026, 10, 1, 0, 0)), utc(2026, 10, 1, 17, 40));
  assert.equal(resetInstant('resets 3pm (UTC)', utc(2026, 10, 1, 0, 0)), utc(2026, 10, 1, 15, 0));
  assert.equal(resetInstant('resets 11:50pm (Asia/Seoul)', utc(2026, 10, 1, 0, 0)), utc(2026, 10, 1, 14, 50));
  assert.equal(resetInstant('resets 5:40pm (UTC)', utc(2026, 10, 1, 18, 0)), utc(2026, 10, 2, 17, 40));
});

test('the Codex "try again at" date reads in the host local zone', () => {
  assert.equal(resetInstant('try again at Sep 27th, 2026 12:00 AM', utc(2026, 8, 1)), utc(2026, 8, 26, 15, 0));
});

test('resetInstant returns null when no time parses', () => {
  for (const r of ['', null, undefined, 'rate limited, try later', 'resets Nov 10', 'resets 9am (Not/AZone)']) {
    assert.equal(resetInstant(r, utc(2026, 10, 1)), null, String(r));
  }
});

test('unparseable text waits 30, 60, 120, 240 and 240 minutes over five identical parks', () => {
  const since = utc(2026, 10, 1);
  const waits = [1, 2, 3, 4, 5].map(parks => (capacityWait({ reason: 'no time here', since, firstSince: since, parks }) - since) / MIN);
  assert.deepEqual(waits, [30, 60, 120, 240, 240]);
});

test('the doubling counts from since, and parks defaults to the first park', () => {
  const since = utc(2026, 10, 2);
  assert.equal(capacityWait({ reason: 'x', since }), since + 30 * MIN);
  assert.equal(capacityWait({ reason: 'x', since, firstSince: utc(2026, 10, 1), parks: 3 }), since + 120 * MIN);
});

test('a dated message resolves against firstSince: a fresh since resolves to the same instant', () => {
  const firstSince = utc(2026, 10, 1);
  const first = capacityWait({ reason: 'resets Nov 10 at 6pm', since: firstSince, firstSince, parks: 1 });
  const again = capacityWait({ reason: 'resets Nov 10 at 6pm', since: utc(2026, 10, 3, 5, 0), firstSince, parks: 2 });
  assert.equal(first, utc(2026, 10, 10, 9, 0));
  assert.equal(again, first);
});

test('a time-only message also resolves against firstSince', () => {
  const firstSince = utc(2026, 10, 1, 0, 0);
  const at = capacityWait({ reason: 'resets 5:40pm', since: utc(2026, 10, 1, 1, 0), firstSince, parks: 2 });
  assert.equal(at, utc(2026, 10, 1, 8, 40));
});

test('replaying "resets Nov 10 at 6pm" across daemon ticks with an advancing since gives one instant', () => {
  const firstSince = utc(2026, 10, 1, 3, 0);
  const reset = utc(2026, 10, 10, 9, 0);
  const seen = new Set();
  for (let tick = 0, since = firstSince; since < reset; tick += 1, since = firstSince + tick * 90 * MIN) {
    seen.add(capacityWait({ reason: 'You\'ve hit your session limit · resets Nov 10 at 6pm', since, firstSince, parks: tick + 1 }));
  }
  assert.deepEqual([...seen], [reset]);
});

test('a stated instant already past on a re-park takes the doubling fallback', () => {
  const firstSince = utc(2026, 10, 1);
  const since = utc(2026, 10, 11);
  assert.equal(capacityWait({ reason: 'resets Nov 10 at 6pm', since, firstSince, parks: 2 }), since + 60 * MIN);
  assert.equal(capacityWait({ reason: 'resets Nov 10 at 6pm', since, firstSince, parks: 3 }), since + 120 * MIN);
});

const R6 = "You've hit your weekly limit · resets Nov 10 at 6pm (UTC)";
const S0 = Date.parse('2026-11-09T12:00:00Z');

test('card129 U1.P1 a first park starts the wait', () => {
  assert.deepEqual(parkCapacity(null, R6, S0), { reason: R6, since: S0, first_since: S0, parks: 1 });
});

test('card129 U1.P2 a re-park of the same stated time keeps first_since and counts up', () => {
  const prev = { reason: R6, since: S0, first_since: S0, parks: 1, cleared_at: S0 + 5 * MIN };
  const now = S0 + 33 * MIN;
  assert.deepEqual(parkCapacity(prev, R6, now), { reason: R6, since: now, first_since: S0, parks: 2 });
});

test('card129 U1.P3 a different stated time restarts', () => {
  const prev = { reason: R6, since: S0, first_since: S0, parks: 1 };
  const now = S0 + 33 * MIN;
  const other = "You've hit your weekly limit · resets Nov 11 at 6pm (UTC)";
  assert.deepEqual(parkCapacity(prev, other, now), { reason: other, since: now, first_since: now, parks: 1 });
});

test('card129 U1.P4 a stated instant already passed restarts', () => {
  const prev = { reason: R6, since: S0, first_since: S0, parks: 2 };
  const now = Date.parse('2026-11-10T18:05:00Z');
  assert.deepEqual(parkCapacity(prev, R6, now), { reason: R6, since: now, first_since: now, parks: 1 });
});

test('card129 U1.P5 two unstated parks, cleared 10 minutes before, carry', () => {
  const prev = { reason: 'usage limit reached', since: S0, first_since: S0, parks: 1, cleared_at: S0 + 30 * MIN };
  const now = S0 + 40 * MIN;
  assert.deepEqual(parkCapacity(prev, 'usage limit reached', now), { reason: 'usage limit reached', since: now, first_since: S0, parks: 2 });
});

test('card129 U1.P4b a restart after the stated instant waits the 30-minute backoff, not a year', () => {
  const now = Date.parse('2026-11-10T18:05:00Z');
  const prev = { reason: R6, since: S0, first_since: S0, parks: 2 };
  const p = parkCapacity(prev, R6, now);
  assert.equal(capacityWait({ ...p, firstSince: p.first_since }), now + 30 * MIN);
  const late = parkCapacity(null, R6, now); // a late first park
  assert.equal(capacityWait({ ...late, firstSince: late.first_since }), now + 30 * MIN);
});

test('card129 U1.P4c a zone-less time reads in the host zone in capacityWait (Asia/Seoul pinned above)', () => {
  const since = Date.parse('2026-11-09T00:00:00Z'); // 09:00 Seoul
  assert.equal(capacityWait({ reason: 'resets 5:40pm', since, firstSince: since, parks: 1 }), Date.parse('2026-11-09T08:40:00Z'));
});

test('card129 U1.P4d a dated reset nine days out is still honoured; only a year roll backs off', () => {
  const first = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(capacityWait({ reason: R6, since: first, firstSince: first, parks: 1 }), Date.parse('2026-11-10T18:00:00Z'));
});

test('card129 U1.P6 an unstated re-park cleared 5 hours before restarts', () => {
  const prev = { reason: 'usage limit reached', since: S0, first_since: S0, parks: 3, cleared_at: S0 + 30 * MIN };
  const now = S0 + 30 * MIN + 5 * 60 * MIN;
  assert.deepEqual(parkCapacity(prev, 'usage limit reached', now), { reason: 'usage limit reached', since: now, first_since: now, parks: 1 });
});
