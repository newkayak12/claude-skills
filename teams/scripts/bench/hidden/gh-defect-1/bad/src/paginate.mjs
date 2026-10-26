const MAX_PAGE_SIZE = 50;

export function paginate(items, page, pageSize) {
  const size = Math.min(pageSize, MAX_PAGE_SIZE);
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}
