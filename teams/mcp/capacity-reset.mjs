// When a capacity park may be resumed. Pure: no clock, no ledger. The park's own `since` moves on
// every re-park, so a stated reset time is resolved against the first park (`firstSince`) and an
// unstated one backs off (30, 60, 120, 240, 240 minutes) instead of restarting a 30-minute wait.

const MIN = 60 * 1000;
const FIRST_WAIT_MIN = 30;
const MAX_WAIT_MIN = 240;
const MAX_STATED_DAYS = 31;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// The wall clock of epoch `ms` in `tz` (a zone name, or null for the host's local zone); null when
// the zone is unknown.
function wall(ms, tz) {
  if (!tz) {
    const d = new Date(ms);
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
    const g = (t) => Number(parts.find((x) => x.type === t).value);
    return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
  } catch { return null; }
}

// Epoch ms of a wall-clock time in `tz` (day overflow rolls, as Date does); null when the zone is unknown.
function at(y, mo, d, h, mi, tz) {
  if (!tz) return new Date(y, mo - 1, d, h, mi).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms) => {
    const w = wall(ms, tz);
    return w && Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / MIN) * MIN;
  };
  const off = offsetAt(guess);
  if (off === null) return null;
  const t = guess - off;
  const off2 = offsetAt(t);
  return off2 === off ? t : guess - off2;
}

function hour12(hs, ms, ap) {
  const h = Number(hs), mi = Number(ms || 0);
  if (h < 1 || h > 12 || mi > 59) return null;
  return { h: (h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0), mi };
}

// "resets Nov 10 at 6pm" / "resets Oct 1, 9am (UTC)" / "resets 5:40pm (Asia/Seoul)" / Codex "try
// again at Sep 27th, 2026 12:00 AM" -> epoch ms. A date or time with no zone is read in the host
// local zone; a named zone wins. A time alone is its first occurrence after `since`; a date with no
// year is its first occurrence on or after `since`. null when no time parses.
export function resetInstant(reason, since) {
  const text = String(reason || '');
  const base = Number(since) || Date.now();

  const dated = /resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(text);
  const mon = dated ? MONTHS.indexOf(dated[1].slice(0, 3).toLowerCase()) : -1;
  if (dated && mon >= 0) {
    const t = hour12(dated[3], dated[4], dated[5]);
    const w = t && wall(base, dated[6] || null);
    if (!w) return null;
    const day = Number(dated[2]);
    for (let y = w.y; y < w.y + 5; y += 1) {
      const real = new Date(Date.UTC(y, mon, day));
      if (real.getUTCMonth() !== mon || real.getUTCDate() !== day) continue; // Feb 29 in a common year
      const c = at(y, mon + 1, day, t.h, t.mi, dated[6] || null);
      if (c !== null && c >= base) return c;
    }
    return null;
  }

  const timed = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(text);
  if (timed) {
    const t = hour12(timed[1], timed[2], timed[3]);
    const w = t && wall(base, timed[4] || null);
    if (!w) return null;
    const c = at(w.y, w.mo, w.d, t.h, t.mi, timed[4] || null);
    return c <= base ? at(w.y, w.mo, w.d + 1, t.h, t.mi, timed[4] || null) : c;
  }

  const codex = /try again at\s+([A-Z][a-z]{2,8})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(text);
  const t = codex ? Date.parse(`${codex[1]} ${codex[2]}, ${codex[3]} ${codex[4]}`) : NaN;
  return Number.isFinite(t) ? t : null;
}

// Epoch ms at which a parked stage may be resumed. A stated instant still ahead of `since` wins and is
// resolved against `firstSince`, so a fresh `since` on a re-park never moves it. Otherwise the wait is
// 30 minutes from `since` on the first park, doubled per identical re-park, capped at 240.
export function capacityWait({ reason, since, firstSince, parks } = {}) {
  const now = Number(since) || Date.now();
  const first = Number(firstSince) || now;
  // A stated instant more than MAX_STATED_DAYS past the first park is a year roll of a date
  // already gone (a re-park after the reset, or a late first park): back off instead.
  const stated = resetInstant(reason, first);
  if (stated !== null && stated > now && stated - first <= MAX_STATED_DAYS * 24 * 60 * MIN) return stated;
  const n = Math.max(1, Math.floor(Number(parks) || 1));
  return now + Math.min(FIRST_WAIT_MIN * 2 ** (n - 1), MAX_WAIT_MIN) * MIN;
}

// The park record for a (re-)park at `now`. `prev` is the holder's last park ({reason, first_since,
// parks, cleared_at?}) or null. The same stated instant still ahead, or two unstated reasons, is
// the same wait: first_since is kept and parks counts up. Anything else restarts at 1: no prior
// park, one cleared more than 4 hours ago, a stated instant already passed, or a different one.
// Pure: the caller passes `now`.
export function parkCapacity(prev, reason, now) {
  const fresh = { reason, since: now, first_since: now, parks: 1 };
  if (!prev) return fresh;
  if (prev.cleared_at && now - prev.cleared_at > MAX_WAIT_MIN * MIN) return fresh;
  const first = Number(prev.first_since) || Number(prev.since) || now;
  const was = resetInstant(prev.reason, first);
  const next = resetInstant(reason, first);
  if (was !== null && was <= now) return fresh;
  if (was !== next) return fresh;
  return { reason, since: now, first_since: first, parks: (Number(prev.parks) || 1) + 1 };
}
