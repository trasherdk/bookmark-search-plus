import { BookmarkStore, faviconUrl } from "./bookmarks-store.js";
import { ContextMenu } from "./context-menu.js";
import { openFormDialog } from "./dialogs.js";
import { clampFontSize, extensionAlive, FONT_DEFAULT, getPrefs, isContextInvalidated, setPrefs } from "./prefs.js";
import { DEFAULT_FILTERS, filtersAreDefault, searchBookmarks } from "./search.js";

const STORAGE_KEY = "bsp-state";
const ROOT_ID = "0";

const els = {
  search: document.getElementById("search"),
  clearSearch: document.getElementById("clear-search"),
  toggleFilters: document.getElementById("toggle-filters"),
  fontDown: document.getElementById("font-down"),
  fontUp: document.getElementById("font-up"),
  closePanel: document.getElementById("close-panel"),
  filters: document.getElementById("filters"),
  field: document.getElementById("filter-field"),
  scope: document.getElementById("filter-scope"),
  match: document.getElementById("filter-match"),
  type: document.getElementById("filter-type"),
  resetFilters: document.getElementById("reset-filters"),
  status: document.getElementById("status"),
  statusText: document.getElementById("status-text"),
  addPage: document.getElementById("add-page"),
  removeItem: document.getElementById("remove-item"),
  goParent: document.getElementById("go-parent"),
  results: document.getElementById("results"),
  list: document.getElementById("list"),
  ctxRoot: document.getElementById("ctx-root"),
};

function noteDeadContext() {
  if (!els.status) {
    return;
  }
  els.status.classList.add("error");
  els.statusText.textContent = "Extension was reloaded. Close this panel and open it again.";
}

window.addEventListener("unhandledrejection", (event) => {
  if (isContextInvalidated(event.reason)) {
    event.preventDefault();
    noteDeadContext();
  }
});

window.addEventListener("error", (event) => {
  if (isContextInvalidated(event.error)) {
    event.preventDefault();
    noteDeadContext();
  }
});

const store = new BookmarkStore();
const contextMenu = new ContextMenu(els.ctxRoot);
const clipboard = {
  ids: [],
  mode: null,
};

const state = {
  query: "",
  filters: { ...DEFAULT_FILTERS },
  filtersOpen: false,
  expanded: new Set(),
  savedExpanded: null,
  scopeFolderId: null,
  selectedId: null,
  resultId: null,
  resultRows: [],
  rows: [],
  actionError: null,
};

let persistTimer = 0;
let searchTimer = 0;
const DRAG_HOLD_MS = 200;
const DRAG_MOVE_PX = 8;
const drag = {
  id: null,
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  holdTimer: 0,
};

function folderIcon() {
  return `<svg class="folder-glyph icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.75 3.5h4.1l1.15 1.25H14.5v8.25H1.75z"/></svg>`;
}

function bookmarkIcon(url) {
  const src = faviconUrl(url, 16);
  return `<img class="icon" src="${src}" alt="" width="16" height="16" draggable="false" />`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openModeFromEvent(event) {
  if (event.shiftKey) {
    return "window";
  }
  if (event.altKey) {
    return "current";
  }
  return "tab";
}

async function activeBrowserTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  if (!win) {
    return null;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab ?? null;
}

async function openBookmark(url, mode) {
  if (!url) {
    return;
  }
  if (mode === "window") {
    await chrome.windows.create({ url });
    return;
  }
  const tab = await activeBrowserTab();
  if (mode === "current" && tab?.id != null) {
    await chrome.tabs.update(tab.id, { url });
    return;
  }
  await chrome.tabs.create({
    url,
    windowId: tab?.windowId,
    index: tab != null ? tab.index + 1 : undefined,
    openerTabId: tab?.id,
    active: true,
  });
}

function defaultExpanded() {
  return new Set(store.visibleRoots().map((node) => node.id));
}

async function loadPersisted() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY] ?? {};
  if (Array.isArray(data.expandedIds) && data.expandedIds.length) {
    state.expanded = new Set(data.expandedIds);
  } else {
    state.expanded = defaultExpanded();
  }
  state.filters = { ...DEFAULT_FILTERS, ...(data.filters ?? {}) };
  state.filtersOpen = Boolean(data.filtersOpen);
  const prefs = await getPrefs();
  applyFontSize(prefs.fontSize);
}

function applyFontSize(size) {
  document.documentElement.style.setProperty("--ui-font", `${clampFontSize(size)}px`);
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!extensionAlive() || !chrome.storage?.local) {
      return;
    }
    chrome.storage.local
      .set({
        [STORAGE_KEY]: {
          expandedIds: [...state.expanded],
          filters: state.filters,
          filtersOpen: state.filtersOpen,
        },
      })
      .catch(() => {});
  }, 200);
}

function hasQuery() {
  return state.query.trim().length > 0;
}

function beginSearchSession() {
  if (state.savedExpanded == null) {
    state.savedExpanded = new Set(state.expanded);
    state.scopeFolderId = store.currentFolderId(state.selectedId);
  }
}

function endSearchSession() {
  if (state.savedExpanded) {
    state.expanded = new Set(state.savedExpanded);
    state.savedExpanded = null;
  }
  state.scopeFolderId = null;
  state.resultId = null;
  state.resultRows = [];
}

function expandAncestors(id) {
  for (const ancestor of store.getAncestors(id)) {
    state.expanded.add(ancestor.id);
  }
}

function parentId(id) {
  const node = store.get(id);
  if (!node?.parentId || node.parentId === ROOT_ID) {
    return null;
  }
  return node.parentId;
}

function flattenTree() {
  const rows = [];
  const walk = (node, depth) => {
    rows.push({ kind: "tree", node, depth });
    if (store.isFolder(node) && state.expanded.has(node.id) && node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  };
  for (const root of store.visibleRoots()) {
    walk(root, 0);
  }
  return rows;
}

function visibleIndex(id) {
  return state.rows.findIndex((row) => row.node.id === id);
}

function selectId(id, { scroll = true, scrollTree = scroll, scrollResults = scroll, centerTree = false, focusTree = false } = {}) {
  state.selectedId = id;
  render({ scrollTree, scrollResults, centerTree, focusTree });
}

function revealInTree(id, { center = false, focus = false } = {}) {
  expandAncestors(id);
  const node = store.get(id);
  if (store.isFolder(node)) {
    state.expanded.add(id);
  }
  persistSoon();
  selectId(id, { scrollTree: true, scrollResults: true, centerTree: center, focusTree: focus });
}

function goParentFolder() {
  const target = parentId(state.selectedId);
  if (!target) {
    return;
  }
  revealInTree(target);
}

function canBookmarkUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "ftp:" || protocol === "file:";
  } catch {
    return false;
  }
}

function isEditableTarget(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

async function addCurrentPage() {
  if (!extensionAlive()) {
    noteDeadContext();
    return;
  }
  state.actionError = null;
  const tab = await activeBrowserTab();
  if (!canBookmarkUrl(tab?.url)) {
    state.actionError = "This page cannot be bookmarked.";
    render();
    return;
  }
  const folderId = store.addTargetFolderId(state.selectedId);
  if (!folderId) {
    state.actionError = "No folder to add the bookmark to.";
    render();
    return;
  }
  try {
    const created = await chrome.bookmarks.create({
      parentId: folderId,
      title: (tab.title || "").trim() || tab.url,
      url: tab.url,
    });
    expandAncestors(created.id);
    state.expanded.add(folderId);
    state.selectedId = created.id;
    persistSoon();
  } catch (error) {
    if (isContextInvalidated(error)) {
      noteDeadContext();
      return;
    }
    state.actionError = error.message || "Could not add this page.";
    render();
  }
}

async function removeSelected() {
  if (!extensionAlive()) {
    noteDeadContext();
    return;
  }
  const node = store.get(state.selectedId);
  if (!store.canRemove(node)) {
    return;
  }
  const folder = store.isFolder(node);
  const title = node.title || (folder ? "Untitled folder" : node.url);
  let message;
  if (folder) {
    const count = store.countChildren(node);
    message = count
      ? `Remove folder “${title}” and all ${count} item${count === 1 ? "" : "s"} inside?`
      : `Remove empty folder “${title}”?`;
  } else {
    message = `Remove bookmark “${title}”?`;
  }
  if (!window.confirm(message)) {
    return;
  }
  state.actionError = null;
  const nextId = parentId(node.id);
  try {
    if (folder) {
      await chrome.bookmarks.removeTree(node.id);
    } else {
      await chrome.bookmarks.remove(node.id);
    }
    state.selectedId = nextId;
    state.expanded.delete(node.id);
  } catch (error) {
    if (isContextInvalidated(error)) {
      noteDeadContext();
      return;
    }
    state.actionError = error.message || "Could not remove this item.";
    render();
  }
}

function clipboardNodes() {
  return clipboard.ids.map((id) => store.get(id)).filter(Boolean);
}

function setActionError(message) {
  state.actionError = message;
  render();
}

async function runBookmarkOp(work) {
  if (!extensionAlive()) {
    noteDeadContext();
    return;
  }
  state.actionError = null;
  try {
    await work();
  } catch (error) {
    if (isContextInvalidated(error)) {
      noteDeadContext();
      return;
    }
    setActionError(error.message || "Bookmark action failed.");
  }
}

function selectCreated(id, folderId) {
  expandAncestors(id);
  if (folderId) {
    state.expanded.add(folderId);
  }
  state.selectedId = id;
  persistSoon();
}

async function openUrls(urls, mode) {
  if (!urls.length) {
    return;
  }
  if (mode === "window") {
    const win = await chrome.windows.create({ url: urls[0] });
    for (const url of urls.slice(1)) {
      await chrome.tabs.create({ url, windowId: win?.id, active: false });
    }
    return;
  }
  const tab = await activeBrowserTab();
  let index = tab != null ? tab.index + 1 : undefined;
  for (const [i, url] of urls.entries()) {
    await chrome.tabs.create({
      url,
      windowId: tab?.windowId,
      index,
      openerTabId: tab?.id,
      active: i === 0,
    });
    if (index != null) {
      index += 1;
    }
  }
}

async function cloneNode(node, parentId, index) {
  const children = [...(node.children ?? [])];
  const created = await chrome.bookmarks.create({
    parentId,
    title: node.title || "",
    ...(node.url ? { url: node.url } : {}),
    ...(index == null ? {} : { index }),
  });
  for (const child of children) {
    await cloneNode(child, created.id);
  }
  return created;
}

async function pasteAt(point) {
  const nodes = clipboardNodes();
  if (!point || !nodes.length) {
    return;
  }
  if (clipboard.mode === "cut" && !store.canMoveInto(clipboard.ids, point.parentId)) {
    setActionError("Cannot paste into that folder.");
    return;
  }
  await runBookmarkOp(async () => {
    let lastId = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const destIndex = point.index == null ? undefined : point.index + i;
      if (clipboard.mode === "cut") {
        const moved = await chrome.bookmarks.move(nodes[i].id, {
          parentId: point.parentId,
          ...(destIndex == null ? {} : { index: destIndex }),
        });
        lastId = moved.id;
      } else {
        const created = await cloneNode(nodes[i], point.parentId, destIndex);
        lastId = created.id;
      }
    }
    if (clipboard.mode === "cut") {
      clipboard.ids = [];
      clipboard.mode = null;
    }
    if (lastId) {
      selectCreated(lastId, point.parentId);
    }
  });
}

async function bookmarkTabsHere(node) {
  const point = store.insertPoint(node);
  if (!point) {
    setActionError("No folder to add bookmarks to.");
    return;
  }
  const tab = await activeBrowserTab();
  if (!tab?.windowId) {
    setActionError("No browser tab to bookmark.");
    return;
  }
  const tabs = await chrome.tabs.query({ windowId: tab.windowId, highlighted: true });
  const pages = tabs.filter((item) => canBookmarkUrl(item.url));
  if (!pages.length) {
    setActionError("Selected tabs cannot be bookmarked.");
    return;
  }
  await runBookmarkOp(async () => {
    let lastId = null;
    for (let i = 0; i < pages.length; i += 1) {
      const created = await chrome.bookmarks.create({
        parentId: point.parentId,
        title: (pages[i].title || "").trim() || pages[i].url,
        url: pages[i].url,
        ...(point.index == null ? {} : { index: point.index + i }),
      });
      lastId = created.id;
    }
    if (lastId) {
      selectCreated(lastId, point.parentId);
    }
  });
}

async function newBookmark(node) {
  const point = store.insertPoint(node);
  if (!point) {
    setActionError("No folder to add a bookmark to.");
    return;
  }
  const tab = await activeBrowserTab();
  const result = await openFormDialog({
    title: "New bookmark",
    submitLabel: "Add",
    fields: [
      { name: "title", label: "Name", value: canBookmarkUrl(tab?.url) ? tab.title || "" : "" },
      { name: "url", label: "URL", value: canBookmarkUrl(tab?.url) ? tab.url : "https://", required: true },
    ],
  });
  if (!result) {
    return;
  }
  if (!canBookmarkUrl(result.url)) {
    setActionError("That URL cannot be bookmarked.");
    return;
  }
  await runBookmarkOp(async () => {
    const created = await chrome.bookmarks.create({
      parentId: point.parentId,
      title: result.title || result.url,
      url: result.url,
      ...(point.index == null ? {} : { index: point.index }),
    });
    selectCreated(created.id, point.parentId);
  });
}

async function newFolder(node) {
  const point = store.insertPoint(node);
  if (!point) {
    setActionError("No folder to add a folder to.");
    return;
  }
  const result = await openFormDialog({
    title: "New folder",
    submitLabel: "Add",
    fields: [{ name: "title", label: "Name", value: "New folder", required: true }],
  });
  if (!result) {
    return;
  }
  await runBookmarkOp(async () => {
    const created = await chrome.bookmarks.create({
      parentId: point.parentId,
      title: result.title || "New folder",
      ...(point.index == null ? {} : { index: point.index }),
    });
    selectCreated(created.id, point.parentId);
  });
}

async function editProperties(node) {
  if (!node) {
    return;
  }
  const folder = store.isFolder(node);
  const locked = store.isSystemRoot(node) || Boolean(node.unmodifiable);
  const result = await openFormDialog({
    title: "Properties",
    fields: [
      { name: "title", label: "Name", value: node.title || "", readonly: locked },
      ...(!folder ? [{ name: "url", label: "URL", value: node.url || "", readonly: locked, required: true }] : []),
    ],
  });
  if (!result || locked) {
    return;
  }
  if (!folder && !canBookmarkUrl(result.url)) {
    setActionError("That URL cannot be bookmarked.");
    return;
  }
  await runBookmarkOp(async () => {
    await chrome.bookmarks.update(node.id, {
      title: result.title || (folder ? "Untitled folder" : result.url),
      ...(!folder ? { url: result.url } : {}),
    });
    state.selectedId = node.id;
  });
}

async function sortByName(node) {
  const folderId = store.isFolder(node) ? node.id : node?.parentId;
  const folder = store.get(folderId);
  if (!folder || !store.canAddTo(folderId)) {
    return;
  }
  const children = [...(folder.children ?? [])];
  if (children.length < 2) {
    return;
  }
  children.sort((a, b) => (a.title || a.url || "").localeCompare(b.title || b.url || "", undefined, { sensitivity: "base" }));
  await runBookmarkOp(async () => {
    for (let i = 0; i < children.length; i += 1) {
      await chrome.bookmarks.move(children[i].id, { parentId: folderId, index: i });
    }
    state.selectedId = node.id;
  });
}

function setBranchExpanded(node, expanded) {
  if (!node || !store.isFolder(node)) {
    return;
  }
  for (const id of store.folderIdsInBranch(node)) {
    if (expanded) {
      state.expanded.add(id);
    } else {
      state.expanded.delete(id);
    }
  }
  if (!expanded && store.isSystemRoot(node)) {
    state.expanded.add(node.id);
  }
  persistSoon();
  render({ scroll: true });
}

async function copyUrl(node) {
  if (!node?.url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(node.url);
  } catch {
    setActionError("Could not copy the URL.");
  }
}

function buildContextItems(node) {
  const folder = store.isFolder(node);
  const canRemove = store.canRemove(node);
  const insert = store.insertPoint(node);
  const before = store.pasteBeforePoint(node);
  const liveClip = clipboardNodes();
  const pasteOk = (parentId) => {
    if (!liveClip.length || !parentId) {
      return false;
    }
    return clipboard.mode === "cut" ? store.canMoveInto(clipboard.ids, parentId) : store.canAddTo(parentId);
  };
  const canPasteInto = folder && pasteOk(node.id);
  const canPasteBefore = Boolean(before) && pasteOk(before.parentId);
  const childUrls = folder ? store.directBookmarkUrls(node) : [];
  const sortFolder = folder ? node : store.get(node?.parentId);
  const canSort = Boolean(sortFolder && store.canAddTo(sortFolder.id) && (sortFolder.children?.length ?? 0) > 1);
  const ancestors = node ? store.getAncestors(node.id) : [];

  const first = folder
    ? { id: "open-all", label: "Open All in Tabs", accessKey: "O", disabled: childUrls.length === 0 }
    : { id: "open", label: "Open", accessKey: "O", disabled: !node?.url };

  return [
    first,
    { type: "separator" },
    { id: "go-parent", label: "Go Parent Folder", accessKey: "G", disabled: !parentId(node?.id) },
    { type: "separator" },
    { id: "bookmark-here", label: "Bookmark Tab(s) Here", accessKey: "H", disabled: !insert },
    { id: "new-bookmark", label: "New Bookmark…", accessKey: "B", disabled: !insert },
    { id: "new-folder", label: "New Folder…", accessKey: "F", disabled: !insert },
    {
      id: "new-separator",
      label: "New Separator",
      accessKey: "S",
      disabled: true,
      title: "Brave and Chrome do not support bookmark separators.",
    },
    { type: "separator" },
    { id: "cut", label: "Cut", accessKey: "t", disabled: !canRemove },
    { id: "copy", label: "Copy", accessKey: "C", disabled: !node || store.isSystemRoot(node) },
    { id: "paste-before", label: "Paste Before", accessKey: "P", disabled: !canPasteBefore },
    { id: "paste-into", label: "Paste Into", accessKey: "I", disabled: !canPasteInto },
    { type: "separator" },
    { id: "delete", label: "Delete", accessKey: "D", disabled: !canRemove },
    { type: "separator" },
    { id: "sort", label: "Sort by Name", accessKey: "r", disabled: !canSort },
    { type: "separator" },
    {
      id: "advanced",
      label: "Advanced",
      accessKey: "v",
      submenu: folder
        ? [
            { id: "expand-branch", label: "Expand all in branch", accessKey: "E" },
            { id: "collapse-branch", label: "Collapse all in branch", accessKey: "L" },
            { id: "open-all-window", label: "Open all in new window", accessKey: "W", disabled: childUrls.length === 0 },
          ]
        : [{ id: "copy-url", label: "Copy URL", accessKey: "U", disabled: !node?.url }],
    },
    { id: "properties", label: "Properties…", accessKey: "i", disabled: !node },
    {
      id: "path",
      label: "Bookmark path",
      accessKey: "a",
      submenu: ancestors.length
        ? ancestors.map((item) => ({
            id: `path:${item.id}`,
            label: item.title || "Untitled",
          }))
        : [{ id: "path-none", label: "No parent folders", disabled: true }],
    },
  ];
}

async function handleContextAction(action, node) {
  if (action.startsWith("path:")) {
    revealInTree(action.slice(5));
    return;
  }
  switch (action) {
    case "open":
      await openBookmark(node?.url, "tab");
      break;
    case "open-all":
      await openUrls(store.directBookmarkUrls(node), "tab");
      break;
    case "open-all-window":
      await openUrls(store.directBookmarkUrls(node), "window");
      break;
    case "go-parent":
      goParentFolder();
      break;
    case "bookmark-here":
      await bookmarkTabsHere(node);
      break;
    case "new-bookmark":
      await newBookmark(node);
      break;
    case "new-folder":
      await newFolder(node);
      break;
    case "cut":
      if (store.canRemove(node)) {
        clipboard.ids = [node.id];
        clipboard.mode = "cut";
      }
      break;
    case "copy":
      if (node && !store.isSystemRoot(node)) {
        clipboard.ids = [node.id];
        clipboard.mode = "copy";
      }
      break;
    case "paste-before":
      await pasteAt(store.pasteBeforePoint(node));
      break;
    case "paste-into":
      await pasteAt(store.isFolder(node) ? { parentId: node.id, index: undefined } : null);
      break;
    case "delete":
      await removeSelected();
      break;
    case "sort":
      await sortByName(node);
      break;
    case "expand-branch":
      setBranchExpanded(node, true);
      break;
    case "collapse-branch":
      setBranchExpanded(node, false);
      break;
    case "copy-url":
      await copyUrl(node);
      break;
    case "properties":
      await editProperties(node);
      break;
    default:
      break;
  }
}

function openItemMenu(event, node) {
  contextMenu.show(event.clientX, event.clientY, buildContextItems(node), (action) => {
    handleContextAction(action, node);
  });
}

function dropTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const row = el?.closest?.("#list [data-id]") ?? null;
  const node = row ? store.get(row.dataset.id) : null;
  if (!row || !node) {
    return { row: null, node: null, zone: null };
  }
  const rect = row.getBoundingClientRect();
  const y = (clientY - rect.top) / Math.max(rect.height, 1);
  let zone;
  if (store.isFolder(node)) {
    if (y < 0.25) {
      zone = "before";
    } else if (y > 0.75) {
      zone = "after";
    } else {
      zone = "into";
    }
  } else {
    zone = y < 0.5 ? "before" : "after";
  }
  return { row, node, zone };
}

function clearDropMarks() {
  for (const row of els.list.querySelectorAll(".drop-before, .drop-after, .drop-into")) {
    row.classList.remove("drop-before", "drop-after", "drop-into");
  }
}

function autoscrollList(event) {
  const rect = els.list.getBoundingClientRect();
  const edge = 28;
  if (event.clientY < rect.top + edge) {
    els.list.scrollTop -= 12;
  } else if (event.clientY > rect.bottom - edge) {
    els.list.scrollTop += 12;
  }
}

function resetDragCursor() {
  document.documentElement.classList.remove("is-dragging");
  document.documentElement.style.cursor = "default";
  document.body.style.cursor = "default";
  requestAnimationFrame(() => {
    document.documentElement.style.cursor = "";
    document.body.style.cursor = "";
  });
}

function clearHoldTimer() {
  clearTimeout(drag.holdTimer);
  drag.holdTimer = 0;
}

function beginDrag() {
  if (drag.active || !drag.id) {
    return;
  }
  contextMenu.close();
  drag.active = true;
  document.documentElement.classList.add("is-dragging");
  const sel = `[data-id="${CSS.escape(drag.id)}"]`;
  els.list.querySelector(sel)?.classList.add("dragging");
  els.results.querySelector(sel)?.classList.add("dragging");
}

function updateDropMarks(event) {
  autoscrollList(event);
  const { row, node, zone } = dropTargetAt(event.clientX, event.clientY);
  const point = store.dropPoint(drag.id, node, zone);
  clearDropMarks();
  if (point && row) {
    row.classList.add(`drop-${zone}`);
  }
}

function endDrag() {
  clearHoldTimer();
  clearDropMarks();
  els.list.querySelector(".dragging")?.classList.remove("dragging");
  els.results.querySelector(".dragging")?.classList.remove("dragging");
  drag.id = null;
  drag.pointerId = null;
  resetDragCursor();
}

async function moveDraggedTo(id, point) {
  if (!id || !point) {
    return;
  }
  await runBookmarkOp(async () => {
    await chrome.bookmarks.move(
      id,
      point.index == null ? { parentId: point.parentId } : { parentId: point.parentId, index: point.index }
    );
    if (point.parentId) {
      state.expanded.add(point.parentId);
    }
    selectCreated(id, point.parentId);
  });
  resetDragCursor();
}

async function activateNode(node, event, { fromResults = false } = {}) {
  const folder = store.isFolder(node);
  if (fromResults) {
    state.resultId = node.id;
    revealInTree(node.id, { center: true, focus: true });
    return;
  }

  if (folder) {
    if (state.expanded.has(node.id)) {
      state.expanded.delete(node.id);
    } else {
      state.expanded.add(node.id);
    }
    persistSoon();
    selectId(node.id);
    return;
  }

  selectId(node.id, { scroll: false });
  await openBookmark(node.url, openModeFromEvent(event));
}

function applyFilterInputs() {
  els.field.value = state.filters.field;
  els.scope.value = state.filters.scope;
  els.match.value = state.filters.match;
  els.type.value = state.filters.type;
  els.filters.classList.toggle("hidden", !state.filtersOpen);
  els.toggleFilters.setAttribute("aria-expanded", String(state.filtersOpen));
  els.toggleFilters.title = state.filtersOpen ? "Hide search filters" : "Show search filters";
  els.resetFilters.classList.toggle("hidden", filtersAreDefault(state.filters));
}

function updateStatus(resultCount, error) {
  const shownError = error || state.actionError;
  els.status.classList.toggle("error", Boolean(shownError));
  if (shownError) {
    els.statusText.textContent = shownError;
  } else if (hasQuery()) {
    els.statusText.textContent =
      resultCount === 1 ? "1 match" : `${resultCount} matches`;
  } else {
    const count = store.byId.size > 0 ? store.byId.size - 1 : 0;
    els.statusText.textContent = `${count} items`;
  }

  els.goParent.disabled = !parentId(state.selectedId);
  els.removeItem.disabled = !store.canRemove(store.get(state.selectedId));
  const folderId = store.addTargetFolderId(state.selectedId);
  const folder = folderId ? store.get(folderId) : null;
  const folderLabel = folder
    ? [...store.getPathTitles(folder.id), folder.title || "Untitled"].join(" / ")
    : "Bookmarks";
  els.addPage.title = `Bookmark the current page in ${folderLabel}`;
  els.clearSearch.classList.toggle("hidden", !state.query);
}

function renderTreeRows() {
  state.rows = flattenTree();
  if (!state.rows.length) {
    els.list.innerHTML = `<div class="empty">No bookmarks yet.</div>`;
    if (!hasQuery()) {
      updateStatus(0, null);
    }
    return;
  }

  const html = state.rows
    .map(({ node, depth }) => {
      const folder = store.isFolder(node);
      const selected = node.id === state.selectedId ? " selected" : "";
      const twistie = folder ? (state.expanded.has(node.id) ? "▼" : "▶") : "";
      const icon = folder ? folderIcon() : bookmarkIcon(node.url);
      const title = escapeHtml(node.title || (folder ? "Untitled folder" : node.url));
      const tip = escapeHtml(folder ? store.getPathLabel(node.id) || title : node.url || title);
      return `<div class="row${selected}" data-id="${node.id}" data-kind="tree" title="${tip}" style="padding-left:${6 + depth * 12}px">
        <span class="twistie">${twistie}</span>
        ${icon}
        <span class="title">${title}</span>
      </div>`;
    })
    .join("");
  els.list.innerHTML = html;
  if (!hasQuery()) {
    updateStatus(state.rows.length, null);
  }
}

function resultIndex(id) {
  return state.resultRows.findIndex((row) => row.node.id === id);
}

function renderResultsPane() {
  if (!hasQuery()) {
    state.resultRows = [];
    els.results.classList.add("hidden");
    els.results.innerHTML = "";
    return;
  }

  const { results, error } = searchBookmarks(
    store,
    state.query,
    state.filters,
    state.scopeFolderId
  );
  state.resultRows = results.map((item) => ({ kind: "result", node: item.node, path: item.path }));
  els.results.classList.remove("hidden");

  if (error) {
    els.results.innerHTML = `<div class="error-msg">${escapeHtml(error)}</div>`;
    updateStatus(0, error);
    return;
  }
  if (!results.length) {
    els.results.innerHTML = `<div class="empty">No matching bookmarks or folders.</div>`;
    updateStatus(0, null);
    return;
  }

  if (state.resultId && resultIndex(state.resultId) === -1) {
    state.resultId = null;
  }

  const html = results
    .map(({ node, path }) => {
      const folder = store.isFolder(node);
      const selected = node.id === (state.resultId || state.selectedId) ? " selected" : "";
      const icon = folder ? folderIcon() : bookmarkIcon(node.url);
      const title = escapeHtml(node.title || (folder ? "Untitled folder" : node.url));
      const meta = folder ? "Folder" : escapeHtml(node.url);
      const pathLabel = escapeHtml(path || "Bookmarks");
      const tip = escapeHtml(folder ? path || title : `${node.url || ""}\n${path || "Bookmarks"}`);
      return `<div class="row result${selected}" data-id="${node.id}" data-kind="result" role="option" title="${tip}">
        <div class="primary">${icon}<span class="title">${title}</span></div>
        <div class="meta">${meta}</div>
        <div class="path">${pathLabel}</div>
      </div>`;
    })
    .join("");
  els.results.innerHTML = html;
  updateStatus(results.length, null);
}

function scrollRowIn(container, id, block) {
  const row = container.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!row) {
    return;
  }
  if (block === "center") {
    const area = container.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    container.scrollTop += item.top - area.top - (area.height - item.height) / 2;
    return;
  }
  row.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function render({ scroll = false, scrollTree = scroll, scrollResults = scroll, centerTree = false, focusTree = false } = {}) {
  applyFilterInputs();
  renderTreeRows();
  renderResultsPane();

  if (scrollTree && state.selectedId) {
    scrollRowIn(els.list, state.selectedId, centerTree ? "center" : "nearest");
  }
  if (scrollResults && (state.resultId || state.selectedId)) {
    const id = state.resultId || state.selectedId;
    scrollRowIn(els.results, id, "nearest");
  }
  if (focusTree) {
    els.list.focus();
  }
}

function moveSelection(delta) {
  if (!state.rows.length) {
    return;
  }
  const current = visibleIndex(state.selectedId);
  const next = current === -1 ? (delta > 0 ? 0 : state.rows.length - 1) : current + delta;
  const clamped = Math.max(0, Math.min(state.rows.length - 1, next));
  selectId(state.rows[clamped].node.id, { scrollTree: true, scrollResults: false });
}

function moveResultSelection(delta) {
  if (!state.resultRows.length) {
    return;
  }
  const current = resultIndex(state.resultId);
  const next = current === -1 ? (delta > 0 ? 0 : state.resultRows.length - 1) : current + delta;
  const clamped = Math.max(0, Math.min(state.resultRows.length - 1, next));
  state.resultId = state.resultRows[clamped].node.id;
  render({ scrollResults: true, scrollTree: false });
}

function setQuery(value, { immediate = false } = {}) {
  const previous = state.query;
  state.query = value;
  els.search.value = value;

  if (!previous.trim() && value.trim()) {
    beginSearchSession();
    state.resultId = null;
  }
  if (previous.trim() && !value.trim()) {
    endSearchSession();
    persistSoon();
  }

  const update = () => render({ scrollResults: true, scrollTree: false });
  if (immediate) {
    clearTimeout(searchTimer);
    update();
    return;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(update, 60);
}

async function lastBrowserWindow() {
  return chrome.windows.getLastFocused({ windowTypes: ["normal"] });
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    if (!extensionAlive()) {
      noteDeadContext();
      return;
    }
    setQuery(event.target.value);
  });

  els.search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hasQuery()) {
        if (!state.resultRows.length) {
          render();
        }
        if (state.resultRows.length) {
          state.resultId = state.resultRows[0].node.id;
          render({ scrollResults: true, scrollTree: false });
          els.results.focus();
        }
      } else if (state.rows.length) {
        selectId(state.rows[0].node.id, { scrollTree: true, scrollResults: false });
        els.list.focus();
      }
    } else if (event.key === "Enter") {
      const first = state.resultRows[0] || state.rows[0];
      if (first) {
        event.preventDefault();
        if (hasQuery()) {
          state.resultId = first.node.id;
          revealInTree(first.node.id, { center: true, focus: true });
        } else {
          activateNode(first.node, event);
        }
      }
    } else if (event.key === "Escape" && state.query) {
      event.preventDefault();
      setQuery("", { immediate: true });
    }
  });

  els.clearSearch.addEventListener("click", () => {
    setQuery("", { immediate: true });
    els.search.focus();
  });

  els.toggleFilters.addEventListener("click", () => {
    state.filtersOpen = !state.filtersOpen;
    persistSoon();
    applyFilterInputs();
  });

  els.fontDown.addEventListener("click", async () => {
    const prefs = await getPrefs();
    const fontSize = clampFontSize((prefs.fontSize ?? FONT_DEFAULT) - 1);
    await setPrefs({ fontSize });
    applyFontSize(fontSize);
  });

  els.fontUp.addEventListener("click", async () => {
    const prefs = await getPrefs();
    const fontSize = clampFontSize((prefs.fontSize ?? FONT_DEFAULT) + 1);
    await setPrefs({ fontSize });
    applyFontSize(fontSize);
  });

  els.closePanel.addEventListener("click", async () => {
    const win = await lastBrowserWindow();
    if (win?.id != null && typeof chrome.sidePanel.close === "function") {
      try {
        await chrome.sidePanel.close({ windowId: win.id });
        return;
      } catch {
        // Fall through to window.close().
      }
    }
    window.close();
  });

  const onFilterChange = () => {
    state.filters = {
      field: els.field.value,
      scope: els.scope.value,
      match: els.match.value,
      type: els.type.value,
    };
    persistSoon();
    render({ scroll: true });
  };
  for (const select of [els.field, els.scope, els.match, els.type]) {
    select.addEventListener("change", onFilterChange);
  }

  els.resetFilters.addEventListener("click", () => {
    state.filters = { ...DEFAULT_FILTERS };
    persistSoon();
    render({ scroll: true });
  });

  els.addPage.addEventListener("click", () => {
    addCurrentPage();
  });

  els.removeItem.addEventListener("click", () => {
    removeSelected();
  });

  els.goParent.addEventListener("click", () => {
    goParentFolder();
  });

  els.list.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : store.get(store.addTargetFolderId(state.selectedId));
    if (row && node) {
      selectId(node.id, { scroll: false });
    }
    openItemMenu(event, node);
  });

  els.results.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (node) {
      state.resultId = node.id;
      openItemMenu(event, node);
    }
  });

  els.list.addEventListener("click", (event) => {
    if (drag.active) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest("[data-id]");
    if (!row) {
      return;
    }
    const node = store.get(row.dataset.id);
    if (!node) {
      return;
    }
    const twistie = event.target.closest(".twistie");
    if (twistie && store.isFolder(node) && row.dataset.kind === "tree") {
      activateNode(node, event);
      return;
    }
    activateNode(node, event);
  });

  els.results.addEventListener("click", (event) => {
    if (drag.active) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (!node) {
      return;
    }
    activateNode(node, event, { fromResults: true });
  });

  const onPointerMove = (event) => {
    if (event.pointerId !== drag.pointerId) {
      return;
    }
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < DRAG_MOVE_PX) {
        return;
      }
      clearHoldTimer();
      beginDrag();
    }
    if (!drag.active) {
      return;
    }
    event.preventDefault();
    updateDropMarks(event);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== drag.pointerId) {
      return;
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    const wasDragging = drag.active;
    const id = drag.id;
    const { node, zone } = dropTargetAt(event.clientX, event.clientY);
    const point = wasDragging ? store.dropPoint(id, node, zone) : null;
    endDrag();
    if (wasDragging) {
      drag.active = true;
      if (point) {
        moveDraggedTo(id, point);
      }
      setTimeout(() => {
        drag.active = false;
      }, 0);
    }
  };

  const armDrag = (event, node) => {
    drag.id = node.id;
    drag.active = false;
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    clearHoldTimer();
    drag.holdTimer = setTimeout(() => {
      beginDrag();
    }, DRAG_HOLD_MS);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  els.list.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".twistie")) {
      return;
    }
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (!row || row.dataset.kind !== "tree" || !store.canRemove(node)) {
      return;
    }
    armDrag(event, node);
  });

  els.results.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (!row || !store.canRemove(node)) {
      return;
    }
    armDrag(event, node);
  });

  els.list.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  els.results.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  els.list.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });

  els.list.addEventListener("auxclick", (event) => {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (node && !store.isFolder(node)) {
      openBookmark(node.url, "tab");
    }
  });

  els.results.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });

  els.results.addEventListener("auxclick", (event) => {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    const row = event.target.closest("[data-id]");
    const node = row ? store.get(row.dataset.id) : null;
    if (node && !store.isFolder(node)) {
      openBookmark(node.url, "tab");
    }
  });

  els.list.addEventListener("keydown", (event) => {
    const node = store.get(state.selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      if (visibleIndex(state.selectedId) === 0) {
        els.search.focus();
        els.search.select();
      }
    } else if (event.key === "Enter" && node) {
      event.preventDefault();
      activateNode(node, event);
    } else if (event.key === "ArrowRight" && node && store.isFolder(node)) {
      event.preventDefault();
      if (event.shiftKey) {
        setBranchExpanded(node, true);
        return;
      }
      state.expanded.add(node.id);
      persistSoon();
      render({ scrollTree: true });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (event.shiftKey && node && store.isFolder(node)) {
        setBranchExpanded(node, false);
        return;
      }
      if (node && store.isFolder(node) && state.expanded.has(node.id)) {
        state.expanded.delete(node.id);
        persistSoon();
        selectId(node.id, { scrollTree: true, scrollResults: false });
      } else {
        goParentFolder();
      }
    } else if (event.key === "Backspace" && (event.altKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      goParentFolder();
    } else if (event.key === "Escape") {
      if (state.query) {
        els.search.focus();
      }
    }
  });

  els.results.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveResultSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (resultIndex(state.resultId) <= 0) {
        els.search.focus();
        els.search.select();
        return;
      }
      moveResultSelection(-1);
    } else if (event.key === "Enter") {
      const node = store.get(state.resultId);
      if (node) {
        event.preventDefault();
        revealInTree(node.id, { center: true, focus: true });
        if (!store.isFolder(node)) {
          openBookmark(node.url, openModeFromEvent(event));
        }
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.altKey || event.ctrlKey || event.metaKey) && event.key === "ArrowUp") {
      event.preventDefault();
      goParentFolder();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      addCurrentPage();
    } else if (event.key === "Delete" && !event.altKey && !isEditableTarget(event.target)) {
      event.preventDefault();
      removeSelected();
    }
  });
}

async function init() {
  bindEvents();
  await loadPersisted();
  applyFilterInputs();
  store.onChange(() => {
    contextMenu.close();
    state.actionError = null;
    if (state.selectedId && !store.get(state.selectedId)) {
      state.selectedId = null;
    }
    const known = new Set(store.byId.keys());
    state.expanded = new Set([...state.expanded].filter((id) => known.has(id)));
    if (!state.expanded.size) {
      state.expanded = defaultExpanded();
    }
    render({ scroll: Boolean(state.selectedId) });
  });
  store.subscribeToChrome();
  try {
    await store.load();
    els.search.focus();
  } catch (error) {
    els.status.classList.add("error");
    els.statusText.textContent = "Could not load bookmarks.";
    els.list.innerHTML = `<div class="error-msg">${escapeHtml(error.message || String(error))}</div>`;
  }
}

init();
