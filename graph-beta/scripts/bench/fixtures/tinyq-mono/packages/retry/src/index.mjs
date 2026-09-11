export class RetryExhaustedError extends Error {
  constructor(attempts, lastError) {
    super(`retry exhausted after ${attempts} attempt(s): ${lastError?.message ?? lastError}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

const defaults = { attempts: 3, baseMs: 100, factor: 2, jitter: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function computeDelay(attempt, { baseMs, factor, jitter }) {
  const raw = baseMs * factor ** (attempt - 1);
  if (jitter <= 0) return raw;
  const spread = raw * jitter;
  return Math.max(0, raw + (Math.random() * 2 - 1) * spread);
}

export async function withRetry(fn, options = {}) {
  const opts = { ...defaults, ...options };
  if (!Number.isInteger(opts.attempts) || opts.attempts < 1) {
    throw new RangeError(`attempts must be a positive integer, got ${opts.attempts}`);
  }
  let lastError;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < opts.attempts) {
        await sleep(computeDelay(attempt, opts));
      }
    }
  }
  throw new RetryExhaustedError(opts.attempts, lastError);
}
