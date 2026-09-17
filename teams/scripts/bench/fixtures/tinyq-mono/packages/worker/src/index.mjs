import { withRetry } from '../../retry/src/index.mjs';

export class Worker {
  #queue;
  #handler;
  #concurrency;
  #retry;
  #running = false;
  #inflight = 0;
  #processed = 0;
  #failed = 0;
  #loops = [];

  constructor(queue, handler, { concurrency = 1, retry = {} } = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
    }
    this.#queue = queue;
    this.#handler = handler;
    this.#concurrency = concurrency;
    this.#retry = retry;
  }

  start() {
    if (this.#running) return this;
    this.#running = true;
    for (let i = 0; i < this.#concurrency; i += 1) {
      this.#loops.push(this.#loop());
    }
    return this;
  }

  async stop() {
    this.#running = false;
    await Promise.all(this.#loops);
    this.#loops = [];
  }

  stats() {
    return { processed: this.#processed, failed: this.#failed, inflight: this.#inflight };
  }

  async #loop() {
    while (this.#running) {
      const job = this.#queue.shift();
      if (job === undefined) {
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      this.#inflight += 1;
      try {
        await withRetry(() => this.#handler(job), this.#retry);
        this.#processed += 1;
      } catch {
        this.#failed += 1;
      } finally {
        this.#inflight -= 1;
      }
    }
  }
}
