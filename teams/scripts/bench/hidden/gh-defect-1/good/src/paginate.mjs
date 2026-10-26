export function paginate(items, page, pageSize) {
  const size = Math.min(pageSize, 50);
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}
