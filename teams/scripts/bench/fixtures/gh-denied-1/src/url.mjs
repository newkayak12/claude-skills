import { slugify } from "../vendor/slug.mjs";

export function articleUrl(title) {
  return "/articles/" + slugify(title);
}
