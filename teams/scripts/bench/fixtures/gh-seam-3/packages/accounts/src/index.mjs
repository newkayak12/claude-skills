import { publish } from "../../bus/src/index.mjs";

export function createUser(name) {
  publish("USER_CREATED", { name });
  return { name };
}

export function deleteUser(name) {
  publish("USER_DELETED", { name });
}
