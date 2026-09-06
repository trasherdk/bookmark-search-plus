const ROOT_ID = "0";

export class BookmarkStore {
  constructor() {
    this.root = null;
    this.byId = new Map();
    this.listeners = new Set();
  }

  async load() {
    const tree = await chrome.bookmarks.getTree();
    this.root = tree[0] ?? null;
    this.reindex();
    this.emit();
  }

  reindex() {
    this.byId.clear();
    if (!this.root) {
      return;
    }
    const walk = (node) => {
      this.byId.set(node.id, node);
      if (!node.children) {
        return;
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(this.root);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribeToChrome() {
    const reload = () => {
      if (!chrome?.runtime?.id) {
        return;
      }
      this.load().catch(() => {});
    };
    try {
      chrome.bookmarks.onCreated.addListener(reload);
      chrome.bookmarks.onRemoved.addListener(reload);
      chrome.bookmarks.onChanged.addListener(reload);
      chrome.bookmarks.onMoved.addListener(reload);
      chrome.bookmarks.onChildrenReordered.addListener(reload);
    } catch {
      // Extension was reloaded while this page was still open.
    }
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  isFolder(node) {
    return Boolean(node) && node.url == null;
  }

  visibleRoots() {
    return (this.root?.children ?? []).filter((node) => node.id !== ROOT_ID);
  }

  getAncestors(id) {
    const ancestors = [];
    let node = this.get(id);
    while (node?.parentId && node.parentId !== ROOT_ID) {
      const parent = this.get(node.parentId);
      if (!parent) {
        break;
      }
      ancestors.unshift(parent);
      node = parent;
    }
    return ancestors;
  }

  getPathTitles(id) {
    return this.getAncestors(id).map((node) => node.title || "Untitled");
  }

  getPathLabel(id) {
    return this.getPathTitles(id).join(" / ");
  }

  isDescendantOf(id, ancestorId) {
    if (!ancestorId) {
      return true;
    }
    if (id === ancestorId) {
      return true;
    }
    let node = this.get(id);
    while (node?.parentId) {
      if (node.parentId === ancestorId) {
        return true;
      }
      node = this.get(node.parentId);
    }
    return false;
  }

  currentFolderId(selectedId) {
    if (!selectedId) {
      return null;
    }
    const node = this.get(selectedId);
    if (!node) {
      return null;
    }
    if (this.isFolder(node)) {
      return node.id;
    }
    return node.parentId && node.parentId !== ROOT_ID ? node.parentId : null;
  }

  isSystemRoot(node) {
    return Boolean(node) && (node.id === ROOT_ID || !node.parentId || node.parentId === ROOT_ID);
  }

  canRemove(node) {
    return Boolean(node) && !this.isSystemRoot(node) && !node.unmodifiable;
  }

  canAddTo(folderId) {
    const node = this.get(folderId);
    return this.isFolder(node) && node.id !== ROOT_ID && !node.unmodifiable;
  }

  addTargetFolderId(selectedId) {
    const current = this.currentFolderId(selectedId);
    if (this.canAddTo(current)) {
      return current;
    }
    const bar = this.get("1");
    if (this.canAddTo(bar?.id)) {
      return bar.id;
    }
    return this.visibleRoots().find((node) => this.canAddTo(node.id))?.id ?? null;
  }

  countChildren(node) {
    let count = 0;
    const walk = (item) => {
      for (const child of item.children ?? []) {
        count += 1;
        walk(child);
      }
    };
    walk(node);
    return count;
  }

  insertPoint(node) {
    if (!node) {
      const folderId = this.addTargetFolderId(null);
      return folderId ? { parentId: folderId, index: undefined } : null;
    }
    if (this.isFolder(node)) {
      return this.canAddTo(node.id) ? { parentId: node.id, index: undefined } : null;
    }
    if (!this.canAddTo(node.parentId)) {
      return null;
    }
    return { parentId: node.parentId, index: (node.index ?? 0) + 1 };
  }

  pasteBeforePoint(node) {
    if (!node || this.isSystemRoot(node) || !this.canAddTo(node.parentId)) {
      return null;
    }
    return { parentId: node.parentId, index: node.index ?? 0 };
  }

  directBookmarkUrls(node) {
    return (node?.children ?? []).filter((child) => child.url).map((child) => child.url);
  }

  folderIdsInBranch(node) {
    const ids = [];
    const walk = (item) => {
      if (!this.isFolder(item)) {
        return;
      }
      ids.push(item.id);
      for (const child of item.children ?? []) {
        walk(child);
      }
    };
    walk(node);
    return ids;
  }

  canMoveInto(ids, folderId) {
    if (!this.canAddTo(folderId) || !ids.length) {
      return false;
    }
    return ids.every((id) => {
      if (id === folderId) {
        return false;
      }
      return !this.isDescendantOf(folderId, id);
    });
  }

  dropPoint(dragId, overNode, zone) {
    const dragNode = this.get(dragId);
    if (!dragNode || !overNode || !this.canRemove(dragNode) || dragId === overNode.id) {
      return null;
    }
    if (this.isDescendantOf(overNode.id, dragId)) {
      return null;
    }
    if (zone === "into") {
      return this.canMoveInto([dragId], overNode.id) ? { parentId: overNode.id } : null;
    }
    if (this.isSystemRoot(overNode) || !this.canAddTo(overNode.parentId)) {
      return null;
    }
    if (!this.canMoveInto([dragId], overNode.parentId)) {
      return null;
    }
    const index = zone === "before" ? (overNode.index ?? 0) : (overNode.index ?? 0) + 1;
    return { parentId: overNode.parentId, index };
  }
}

export function faviconUrl(pageUrl, size = 16) {
  if (!chrome?.runtime?.id) {
    return "";
  }
  const url = new URL(chrome.runtime.getURL("_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}
