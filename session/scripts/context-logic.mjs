// Pure logic for the context % the status line shows, used by /smart-compact. No I/O.
//
// Measured in U1 (live session, two turns, status line stdin vs /smart-compact log):
//   context_window.context_window_size = 1000000
//   context_window.total_input_tokens  = 57877
//   context_window.current_usage       = { input_tokens 4, cache_creation_input_tokens 16625,
//                                          cache_read_input_tokens 41248, output_tokens 5 }
//   status line used_percentage        = 6   (the /smart-compact log read "6% vs 70% -> below")
// Formula: tokens = input + cache_creation + cache_read (= 57877, equal to total_input_tokens);
//   percent = round(100 * tokens / context_window_size) = round(5.79) = 6. Output tokens are not counted.

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

// usage: the status line's context_window object. Returns { percent, tokens, window, base };
// percent is null when the window is missing, zero or invalid. base names where tokens came from.
export function statusLinePercent(usage) {
  const u = usage && typeof usage === 'object' ? usage : {}
  const window = num(u.context_window_size)
  const cur = u.current_usage && typeof u.current_usage === 'object' ? u.current_usage : null
  let tokens, base
  if (cur) {
    tokens = num(cur.input_tokens) + num(cur.cache_creation_input_tokens) + num(cur.cache_read_input_tokens)
    base = 'current_usage'
  } else {
    tokens = num(u.total_input_tokens)
    base = 'total_input_tokens'
  }
  const percent = window > 0 ? Math.round((100 * tokens) / window) : null
  return { percent, tokens, window, base }
}

// Text for /smart-compact with no argument.
export function fmtContext(result, threshold) {
  const r = result ?? {}
  const pct = typeof r.percent === 'number' ? `${r.percent}%` : 'unknown'
  const tokens = num(r.tokens)
  const win = num(r.window)
  return `context ${pct} (${tokens.toLocaleString('en-US')} tokens${win ? ` of ${win.toLocaleString('en-US')}` : ''}) · threshold ${threshold}%`
}
