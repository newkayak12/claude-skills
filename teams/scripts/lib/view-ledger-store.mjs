// Incremental reader of ledger.jsonl for the shared view server. Per ledger it keeps the offset read
// to, mtime, size, a head fingerprint and the parsed events, and reads only appended bytes when the
// file grows. Its events equal what view.mjs tailLines + parse give (the oracle): the last 256 KiB
// window, a line kept iff its start offset is greater than the window start when that is > 0, and a
// trailing line with no newline parsed for this answer but not kept (the next read starts at it).
// No since filter and no HOLD_MS here: the caller filters in memory and recomputes failures from now.
import { openSync, fstatSync, readSync, closeSync } from 'node:fs';

export const TAIL_BYTES = 256 * 1024;
const HEAD_BYTES = 64;

function parseLine(buf) {
  const s = buf.toString('utf8');
  if (!s.trim()) return null;
  try {
    const e = JSON.parse(s);
    return e && typeof e.ts === 'number' ? e : null;
  } catch { return null; }
}

export function createLedgerStore() {
  const files = new Map();
  const stats = { reads: 0, bytesRead: 0 };

  function pread(fd, len, pos) {
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, pos + got);
      if (n <= 0) break;
      got += n;
    }
    stats.reads += 1;
    stats.bytesRead += got;
    return got === len ? buf : buf.subarray(0, got);
  }

  // Read [from, size), split on newline, keep complete lines starting after winStart; returns the
  // kept events, the offset after the last newline and the trailing partial event (or null).
  function scan(fd, from, size, winStart) {
    const buf = pread(fd, size - from, from);
    const kept = [];
    let pos = 0;
    let nl;
    while ((nl = buf.indexOf(0x0a, pos)) !== -1) {
      const start = from + pos;
      if (!(winStart > 0) || start > winStart) {
        const ev = parseLine(buf.subarray(pos, nl));
        if (ev) kept.push({ start, ev });
      }
      pos = nl + 1;
    }
    let tail = null;
    const tailStart = from + pos;
    if (pos < buf.length && (!(winStart > 0) || tailStart > winStart)) tail = parseLine(buf.subarray(pos));
    return { kept, offset: from + pos, tail };
  }

  function read(path) {
    let fd;
    try {
      fd = openSync(path, 'r');
      const { size, mtimeMs } = fstatSync(fd);
      let st = files.get(path);
      if (st && st.size === size && st.mtimeMs === mtimeMs) return answer(st);
      const winStart = Math.max(0, size - TAIL_BYTES);
      let head = null;
      let incremental = false;
      if (st && size > st.size && size - st.offset <= TAIL_BYTES) {
        head = pread(fd, Math.min(HEAD_BYTES, size), 0);
        incremental = head.equals(st.head.subarray(0, Math.min(head.length, st.head.length))) && st.head.length <= head.length;
      }
      let r;
      if (incremental) {
        r = scan(fd, st.offset, size, winStart);
        st.entries = st.entries.filter((x) => !(winStart > 0) || x.start > winStart).concat(r.kept);
      } else {
        r = scan(fd, winStart, size, winStart);
        head = pread(fd, Math.min(HEAD_BYTES, size), 0);
        st = { entries: r.kept };
        files.set(path, st);
      }
      st.size = size;
      st.mtimeMs = mtimeMs;
      st.head = head;
      st.offset = r.offset;
      st.tail = r.tail;
      return answer(st);
    } catch {
      files.delete(path);
      return [];
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  const answer = (st) => {
    const out = st.entries.map((x) => x.ev);
    if (st.tail) out.push(st.tail);
    return out;
  };

  return { read, stats, forget: (path) => files.delete(path), size: () => files.size };
}
