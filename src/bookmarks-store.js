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
