export class BoundedQueue {
  #items = [];
  #capacity;

  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#capacity = capacity;
  }

  get capacity() {
    return this.#capacity;
  }

  size() {
    return this.#items.length;
  }

  isFull() {
    return this.#items.length >= this.#capacity;
  }

  isEmpty() {
    return this.#items.length === 0;
  }

  push(item) {
    if (this.isFull()) return false;
    this.#items.push(item);
    return true;
  }

  shift() {
    return this.#items.shift();
  }

  peek() {
    return this.#items[0];
  }

  drain(fn) {
    let count = 0;
    while (this.#items.length > 0) {
      fn(this.#items.shift());
      count += 1;
    }
    return count;
  }
}
