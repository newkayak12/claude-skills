import { publish } from "../../bus/src/index.mjs";

export function createUser(name) {
  publish("user.created", { name });
  return { name };
}

export function deleteUser(name) {
  publish("user.deleted", { name });
}
