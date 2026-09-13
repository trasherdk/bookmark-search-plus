export const BACKUP_KIND = "bookmark-search-plus-backup";
export const BACKUP_STORAGE_KEY = "bsp-import-backup";

const ROOT_ID = "0";

export function isBackupFile(data) {
  return Boolean(data) && data.kind === BACKUP_KIND && Number(data.version) >= 1 && Array.isArray(data.nodes);
}

export function tryParseBackup(text) {
  try {
    const data = JSON.parse(text);
    return isBackupFile(data) ? data : null;
  } catch {
    return null;
  }
}

export function snapshotFromTree(root) {
  const nodes = [];
  const walk = (node) => {
    if (!node?.id) {
      return;
    }
    nodes.push({
      id: node.id,
      parentId: node.parentId ?? null,
      index: node.index ?? 0,
      title: node.title ?? "",
      url: node.url ?? null,
    });
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(root);
  return {
    kind: BACKUP_KIND,
    version: 1,
    createdAt: new Date().toISOString(),
    nodes,
  };
}

export async function captureBookmarkSnapshot() {
  const tree = await chrome.bookmarks.getTree();
  return snapshotFromTree(tree[0]);
}

export function backupFilename(iso = new Date().toISOString()) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `bsp-bookmarks-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`
  );
}

export async function writeBackupFile(snapshot) {
  const text = JSON.stringify(snapshot);
  const name = backupFilename(snapshot.createdAt);
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "Bookmark Search Plus backup",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error?.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

export async function persistBackup(snapshot) {
  await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: snapshot });
}

export async function loadBackup() {
  const stored = await chrome.storage.local.get(BACKUP_STORAGE_KEY);
  const data = stored[BACKUP_STORAGE_KEY];
  return isBackupFile(data) ? data : null;
}

export async function clearBackup() {
  await chrome.storage.local.remove(BACKUP_STORAGE_KEY);
}

function isAncestor(parentOf, ancestorId, id) {
  let current = id;
  const seen = new Set();
  while (current) {
    if (current === ancestorId) {
      return true;
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}

function isProtected(node) {
  return !node || node.id === ROOT_ID || node.parentId == null || node.parentId === ROOT_ID || Boolean(node.unmodifiable);
}

function flattenTree(root) {
  const byId = new Map();
  const parentOf = new Map();
  const walk = (node) => {
    byId.set(node.id, node);
    if (node.parentId != null) {
      parentOf.set(node.id, node.parentId);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(root);
  return { byId, parentOf };
}

async function liveTree() {
  const tree = await chrome.bookmarks.getTree();
  return flattenTree(tree[0]);
}

function allNewSubtree(id, byId, newSet) {
  const node = byId.get(id);
  if (!node) {
    return true;
  }
  if (!newSet.has(id)) {
    return false;
  }
  return (node.children ?? []).every((child) => allNewSubtree(child.id, byId, newSet));
}

export function formatBackupTime(snapshot) {
  if (!snapshot?.createdAt) {
    return "the last backup";
  }
  const date = new Date(snapshot.createdAt);
  if (Number.isNaN(date.getTime())) {
    return "the last backup";
  }
  return date.toLocaleString();
}

export async function restoreBookmarkSnapshot(snapshot) {
  if (!isBackupFile(snapshot)) {
    throw new Error("Not a Bookmark Search Plus backup.");
  }
  const snapById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const stats = { moved: 0, renamed: 0, removed: 0 };

  let { byId, parentOf } = await liveTree();

  let progress = true;
  let rounds = 0;
  while (progress && rounds < snapshot.nodes.length + 8) {
    progress = false;
    rounds += 1;
    for (const snap of snapshot.nodes) {
      const live = byId.get(snap.id);
      if (!live || isProtected(live) || !snap.parentId || !byId.has(snap.parentId)) {
        continue;
      }
      if (parentOf.get(snap.id) === snap.parentId) {
        continue;
      }
      if (isAncestor(parentOf, snap.id, snap.parentId)) {
        continue;
      }
      await chrome.bookmarks.move(snap.id, { parentId: snap.parentId });
      parentOf.set(snap.id, snap.parentId);
      stats.moved += 1;
      progress = true;
    }
  }

  ({ byId, parentOf } = await liveTree());

  const byParent = new Map();
  for (const snap of snapshot.nodes) {
    const live = byId.get(snap.id);
    if (!live || isProtected(live) || !snap.parentId) {
      continue;
    }
    const list = byParent.get(snap.parentId) ?? [];
    list.push(snap);
    byParent.set(snap.parentId, list);
  }
  for (const [parentId, kids] of byParent) {
    if (!byId.has(parentId)) {
      continue;
    }
    kids.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (let index = 0; index < kids.length; index += 1) {
      const siblings = await chrome.bookmarks.getChildren(parentId);
      const current = siblings.findIndex((child) => child.id === kids[index].id);
      if (current === -1 || current === index) {
        continue;
      }
      await chrome.bookmarks.move(kids[index].id, { parentId, index });
    }
  }

  ({ byId, parentOf } = await liveTree());
  for (const snap of snapshot.nodes) {
    const live = byId.get(snap.id);
    if (!live || isProtected(live)) {
      continue;
    }
    const want = snap.title ?? "";
    if ((live.title || "") !== want) {
      await chrome.bookmarks.update(snap.id, { title: want });
      stats.renamed += 1;
    }
  }

  ({ byId, parentOf } = await liveTree());
  const newIds = [...byId.values()]
    .filter((node) => !snapById.has(node.id) && !isProtected(node))
    .map((node) => node.id);
  const newSet = new Set(newIds);
  const depthOf = (id) => {
    let depth = 0;
    let current = id;
    const seen = new Set();
    while (current && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentOf.get(current);
    }
    return depth;
  };
  newIds.sort((a, b) => depthOf(b) - depthOf(a));
  const forget = (id) => {
    const node = byId.get(id);
    for (const child of node?.children ?? []) {
      forget(child.id);
    }
    byId.delete(id);
    parentOf.delete(id);
    newSet.delete(id);
  };
  for (const id of newIds) {
    const node = byId.get(id);
    if (!node || isProtected(node) || !allNewSubtree(id, byId, newSet)) {
      continue;
    }
    if (node.url) {
      await chrome.bookmarks.remove(id);
    } else {
      await chrome.bookmarks.removeTree(id);
    }
    forget(id);
    stats.removed += 1;
  }

  return stats;
}
