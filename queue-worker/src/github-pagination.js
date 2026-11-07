export async function fetchAllSearchPages(fetchPage, options = {}) {
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 100));
  const maxPages = Math.max(1, Math.min(10, Number(options.maxPages) || 10));
  const items = [];
  let expectedTotal = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchPage(page);
    if (!payload || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
      throw new Error("GitHub search returned an invalid pagination payload");
    }
    if (expectedTotal === null) expectedTotal = payload.total_count;
    else if (payload.total_count !== expectedTotal) {
      throw new Error("GitHub issue search total changed during pagination");
    }

    items.push(...payload.items);
    if (items.length >= expectedTotal) return items.slice(0, expectedTotal);
    if (payload.items.length < pageSize) break;
  }

  if (items.length < (expectedTotal || 0)) {
    throw new Error("GitHub issue search exceeded the configured 1,000-result paging cap; refusing a partial queue");
  }
  return items;
}
