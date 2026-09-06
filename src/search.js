export const DEFAULT_FILTERS = {
  field: "all",
  match: "words",
  type: "all",
  scope: "all",
};

export function filtersAreDefault(filters) {
  return (
    filters.field === DEFAULT_FILTERS.field &&
    filters.match === DEFAULT_FILTERS.match &&
    filters.type === DEFAULT_FILTERS.type &&
    filters.scope === DEFAULT_FILTERS.scope
  );
}

function buildMatcher(query, matchMode) {
  if (matchMode === "regex") {
    try {
      const regex = new RegExp(query, "i");
      return { match: (text) => regex.test(text), error: null };
    } catch {
      return { match: null, error: "Invalid regular expression" };
    }
  }

  const needle = query.toLowerCase();
  return {
    match: (text) => text.toLowerCase().includes(needle),
    error: null,
  };
}

function inScope(store, node, filters, scopeId) {
  if (filters.scope === "all" || !scopeId) {
    return true;
  }
  if (filters.scope === "folder") {
    return node.parentId === scopeId;
  }
  return store.isDescendantOf(node.id, scopeId);
}

export function searchBookmarks(store, query, filters, scopeId) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], error: null };
  }

  const { match, error } = buildMatcher(trimmed, filters.match);
  if (error) {
    return { results: [], error };
  }

  const results = [];
  for (const node of store.byId.values()) {
    if (node.id === "0") {
      continue;
    }

    const isFolder = store.isFolder(node);
    if (filters.type === "folders" && !isFolder) {
      continue;
    }
    if (filters.type === "bookmarks" && isFolder) {
      continue;
    }
    if (!inScope(store, node, filters, scopeId)) {
      continue;
    }

    const title = node.title || "";
    const url = node.url || "";
    let hit = false;
    if (filters.field === "title") {
      hit = match(title);
    } else if (filters.field === "url") {
      hit = !isFolder && match(url);
    } else {
      hit = match(title) || (!isFolder && match(url));
    }

    if (hit) {
      results.push({
        node,
        path: store.getPathLabel(node.id),
      });
    }
  }

  results.sort((a, b) => {
    const titleA = (a.node.title || "").toLowerCase();
    const titleB = (b.node.title || "").toLowerCase();
    if (titleA < titleB) {
      return -1;
    }
    if (titleA > titleB) {
      return 1;
    }
    return (a.node.url || "").localeCompare(b.node.url || "");
  });

  return { results, error: null };
}
