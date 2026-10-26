import { subscribe } from "../../bus/src/index.mjs";

let log = [];

// startAudit() clears the log and records "<topic>:<name>" for every user event it hears
export function startAudit() {
  log = [];
  for (const topic of ["user.created", "user.deleted"]) {
    subscribe(topic, (payload) => log.push(topic + ":" + payload.name));
  }
}

export function entries() {
  return [...log];
}
