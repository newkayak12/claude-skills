// @gh-seam-3/topics - the one place event topic names are defined. Publishers and subscribers
// import TOPICS by relative path and must not keep their own copy of a topic string.
export const TOPICS = Object.freeze({
  USER_CREATED: "user.created",
  USER_DELETED: "user.deleted",
});
