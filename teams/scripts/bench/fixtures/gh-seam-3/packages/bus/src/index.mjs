// @gh-seam-3/bus - an in-process publish/subscribe bus. It treats topic names as opaque strings.
const handlers = new Map();

export function subscribe(topic, fn) {
  if (!handlers.has(topic)) handlers.set(topic, []);
  handlers.get(topic).push(fn);
}

export function publish(topic, payload) {
  for (const fn of handlers.get(topic) ?? []) fn(payload);
}

export function reset() {
  handlers.clear();
}
