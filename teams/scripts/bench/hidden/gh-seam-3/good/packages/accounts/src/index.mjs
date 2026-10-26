import { publish } from "../../bus/src/index.mjs";
import { TOPICS } from "../../topics/src/index.mjs";

export function createUser(name) {
  publish(TOPICS.USER_CREATED, { name });
  return { name };
}

export function deleteUser(name) {
  publish(TOPICS.USER_DELETED, { name });
}
