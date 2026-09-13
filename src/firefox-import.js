const SKIP_ROOTS = new Set([
  "recent tags",
  "tags",
  "history",
  "mozilla firefox",
  "firefox nightly resources",
  "firefox release notes",
]);

export function normalizeBookmarkUrl(url) {
  try {
    const parsed = new URL(String(url).trim());
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return String(url || "").trim();
  }
}

export function canImportUrl(url) {
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

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match;
  while ((match = re.exec(raw ?? ""))) {
    attrs[match[1].toUpperCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function hasTrueAttr(attrs, name) {
  const value = attrs[name];
  return value != null && value !== "" && value.toLowerCase() !== "false";
}

export function parseNetscapeBookmarks(html) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, "");
  const root = { children: [] };
  const stack = [root];
  let pendingFolder = null;
  const tokenRe =
    /<DL\b[^>]*>|<\/DL>|<DT\b[^>]*>\s*<H3\b([^>]*)>([\s\S]*?)<\/H3>|<DT\b[^>]*>\s*<A\b([^>]*)>([\s\S]*?)<\/A>/gi;
  let match;
  while ((match = tokenRe.exec(source))) {
    const token = match[0];
    if (/^<DL/i.test(token)) {
      if (pendingFolder) {
        stack.push(pendingFolder);
        pendingFolder = null;
      }
      continue;
    }
    if (/^<\/DL/i.test(token)) {
      pendingFolder = null;
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    if (match[1] != null) {
      const attrs = parseAttrs(match[1]);
      const folder = {
        title: decodeEntities(match[2]) || "Untitled",
        children: [],
      };
      if (hasTrueAttr(attrs, "PERSONAL_TOOLBAR_FOLDER") || Object.hasOwn(attrs, "PERSONAL_TOOLBAR_FOLDER")) {
        folder.root = "toolbar";
      }
      if (hasTrueAttr(attrs, "UNFILED_BOOKMARKS_FOLDER") || Object.hasOwn(attrs, "UNFILED_BOOKMARKS_FOLDER")) {
        folder.root = "unfiled";
      }
      stack[stack.length - 1].children.push(folder);
      pendingFolder = folder;
      continue;
    }
    pendingFolder = null;
    const attrs = parseAttrs(match[3]);
    const href = attrs.HREF;
    if (href) {
      stack[stack.length - 1].children.push({
        title: decodeEntities(match[4]) || decodeEntities(href),
        url: decodeEntities(href),
      });
    }
  }
  return root.children;
}

function jsonRootKind(node) {
  const guid = String(node.guid || "");
  const root = String(node.root || "");
  if (guid.startsWith("toolbar") || /toolbar/i.test(root)) {
    return "toolbar";
  }
  if (guid.startsWith("unfiled") || /unfiled/i.test(root)) {
    return "unfiled";
  }
  if (guid.startsWith("menu") || /menu/i.test(root)) {
    return "menu";
  }
  if (guid.startsWith("mobile") || /mobile/i.test(root)) {
    return "mobile";
  }
  return null;
}

function fromFirefoxJsonNode(node) {
  if (!node || node.type === "text/x-moz-place-separator" || node.typeCode === 3) {
    return null;
  }
  const url = node.uri || node.url;
  if (url || node.type === "text/x-moz-place" || node.typeCode === 1) {
    return url ? { title: node.title || url, url } : null;
  }
  const children = (node.children ?? []).map(fromFirefoxJsonNode).filter(Boolean);
  const folder = { title: node.title || "Untitled", children };
  const root = jsonRootKind(node);
  if (root) {
    folder.root = root;
  }
  return folder;
}

export function parseFirefoxJson(data) {
  const root = typeof data === "string" ? JSON.parse(data) : data;
  if (Array.isArray(root)) {
    return root.map(fromFirefoxJsonNode).filter(Boolean);
  }
  if (root.children) {
    return root.children.map(fromFirefoxJsonNode).filter(Boolean);
  }
  const converted = fromFirefoxJsonNode(root);
  return converted ? [converted] : [];
}

export function parseFirefoxExport(text, filename = "") {
  const name = filename.toLowerCase();
  const trimmed = text.trim();
  if (name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseFirefoxJson(trimmed);
  }
  return parseNetscapeBookmarks(text);
}

export function mapFirefoxRoot(item) {
  const title = typeof item === "string" ? item : item?.title;
  const key = (title || "").trim().toLowerCase();
  const kind = typeof item === "object" && item ? item.root : null;
  if (kind === "toolbar") {
    return { chromeId: "1" };
  }
  if (kind === "unfiled" || kind === "menu") {
    return { chromeId: "2" };
  }
  if (kind === "mobile") {
    return { chromeId: "3" };
  }
  if (!key || SKIP_ROOTS.has(key)) {
    return { skip: true };
  }
  if (key === "toolbar" || key === "bookmarks bar" || key === "bookmarks toolbar") {
    return { chromeId: "1" };
  }
  if (key === "mobile" || key === "mobile bookmarks") {
    return { chromeId: "3" };
  }
  if (
    key === "other bookmarks" ||
    key === "unsorted bookmarks" ||
    key === "unfiled bookmarks" ||
    key === "unfiled" ||
    key === "bookmarks menu"
  ) {
    return { chromeId: "2" };
  }
  return { chromeId: null };
}

export function countImportTree(nodes) {
  let folders = 0;
  let bookmarks = 0;
  const walk = (items) => {
    for (const item of items) {
      if (item.url) {
        bookmarks += 1;
      } else {
        folders += 1;
        walk(item.children ?? []);
      }
    }
  };
  walk(nodes);
  return { folders, bookmarks };
}

async function existingFolderId(parentId, title) {
  const children = await chrome.bookmarks.getChildren(parentId);
  const needle = normName(title);
  return children.find((child) => child.url == null && normName(child.title) === needle)?.id ?? null;
}

function fallbackRootId() {
  return "2";
}

function normName(title) {
  return (title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function titlesAreCompatible(left, right) {
  const first = normName(left);
  const second = normName(right);
  if (!first || !second) {
    return false;
  }
  if (first === second) {
    return true;
  }
  const strip = (value) => value.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const a = strip(first);
  const b = strip(second);
  return Boolean(a) && a === b;
}

function collectUrls(item) {
  const urls = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.url) {
        if (canImportUrl(node.url)) {
          urls.push(normalizeBookmarkUrl(node.url));
        }
      } else {
        walk(node.children);
      }
    }
  };
  walk(item.children);
  return urls;
}

function hasNewBookmarks(item, seen) {
  return collectUrls(item).some((url) => !seen.has(url));
}

function directUrls(item) {
  return (item.children ?? [])
    .filter((child) => child.url && canImportUrl(child.url))
    .map((child) => normalizeBookmarkUrl(child.url));
}

function voteFolder(urls, urlToFolder) {
  const votes = new Map();
  for (const url of urls) {
    const folderId = urlToFolder.get(url);
    if (!folderId) {
      continue;
    }
    votes.set(folderId, (votes.get(folderId) ?? 0) + 1);
  }
  let bestId = null;
  let bestCount = 0;
  let total = 0;
  for (const [id, count] of votes) {
    total += count;
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  if (!bestId || bestCount * 2 < total) {
    return null;
  }
  return bestId;
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

function identifyFolder(item, ctx, match) {
  if (item.url) {
    return null;
  }
  const mapped = mapFirefoxRoot(item);
  if (mapped.chromeId || mapped.skip) {
    for (const child of item.children ?? []) {
      if (!child.url) {
        identifyFolder(child, ctx, match);
      }
    }
    match.set(item, null);
    return null;
  }
  const childIds = [];
  for (const child of item.children ?? []) {
    if (!child.url) {
      const id = identifyFolder(child, ctx, match);
      if (id) {
        childIds.push(id);
      }
    }
  }
  const byUrl = voteFolder(directUrls(item), ctx.urlToFolder);
  if (byUrl && !ctx.systemRoot.has(byUrl)) {
    match.set(item, byUrl);
    return byUrl;
  }
  if (childIds.length) {
    const parents = childIds.map((id) => ctx.parentOf.get(id)).filter(Boolean);
    const shared =
      parents.length === childIds.length && parents.every((parent) => parent === parents[0])
        ? parents[0]
        : null;
    if (shared && !ctx.systemRoot.has(shared) && !childIds.includes(shared)) {
      if (titlesAreCompatible(ctx.titleOf.get(shared), item.title)) {
        match.set(item, shared);
        return shared;
      }
    }
  }
  match.set(item, null);
  return null;
}

function needsNewFolder(item, ctx) {
  if (hasNewBookmarks(item, ctx.existingUrls)) {
    return true;
  }
  return (item.children ?? []).some((child) => !child.url);
}

async function addBookmark(item, parentId, ctx, stats) {
  if (!canImportUrl(item.url)) {
    stats.invalid += 1;
    return;
  }
  const key = normalizeBookmarkUrl(item.url);
  if (ctx.existingUrls.has(key)) {
    stats.skipped += 1;
    return;
  }
  await chrome.bookmarks.create({
    parentId,
    title: item.title || item.url,
    url: item.url,
  });
  ctx.existingUrls.add(key);
  ctx.urlToFolder.set(key, parentId);
  stats.added += 1;
}

function shouldMoveFolder(id, intendedParent, ctx) {
  const currentParent = ctx.parentOf.get(id);
  if (!intendedParent || currentParent === intendedParent) {
    return false;
  }
  if (isAncestor(ctx.parentOf, id, intendedParent)) {
    return false;
  }
  if (ctx.systemRoot.has(intendedParent) && currentParent && !ctx.systemRoot.has(currentParent)) {
    return false;
  }
  return true;
}

async function applyFolder(item, intendedParent, ctx, match, stats) {
  const mapped = mapFirefoxRoot(item);
  if (mapped.skip) {
    for (const child of item.children ?? []) {
      if (!child.url) {
        await applyFolder(child, intendedParent, ctx, match, stats);
      }
    }
    return;
  }
  if (mapped.chromeId && (ctx.systemRoot.has(mapped.chromeId) || mapped.chromeId === fallbackRootId())) {
    const dest = mapped.chromeId;
    for (const child of item.children ?? []) {
      if (child.url) {
        await addBookmark(child, dest, ctx, stats);
      } else {
        await applyFolder(child, dest, ctx, match, stats);
      }
    }
    return;
  }

  let id = match.get(item);
  if (!id && intendedParent) {
    id = await existingFolderId(intendedParent, item.title || "Untitled");
    if (id) {
      match.set(item, id);
    }
  }
  if (!id && intendedParent && needsNewFolder(item, ctx)) {
    const created = await chrome.bookmarks.create({
      parentId: intendedParent,
      title: item.title || "Untitled",
    });
    id = created.id;
    ctx.parentOf.set(id, intendedParent);
    ctx.titleOf.set(id, item.title || "Untitled");
    ctx.childFolderIds.set(id, []);
    match.set(item, id);
    stats.folders += 1;
  } else if (id) {
    stats.reused += 1;
  }

  if (id && !ctx.systemRoot.has(id)) {
    const wantTitle = item.title || "Untitled";
    if (titlesAreCompatible(ctx.titleOf.get(id), wantTitle) && normName(ctx.titleOf.get(id)) !== normName(wantTitle)) {
      const currentParent = ctx.parentOf.get(id) || intendedParent;
      const clash = currentParent ? await existingFolderId(currentParent, wantTitle) : null;
      if (!clash || clash === id) {
        await chrome.bookmarks.update(id, { title: wantTitle });
        ctx.titleOf.set(id, wantTitle);
        stats.renamed += 1;
      }
    }
    if (shouldMoveFolder(id, intendedParent, ctx)) {
      await chrome.bookmarks.move(id, { parentId: intendedParent });
      ctx.parentOf.set(id, intendedParent);
      stats.moved += 1;
    }
  }

  const dest = id || intendedParent;
  if (!dest) {
    return;
  }
  for (const child of item.children ?? []) {
    if (child.url) {
      await addBookmark(child, dest, ctx, stats);
    } else {
      await applyFolder(child, dest, ctx, match, stats);
    }
  }
}

function peelSingleWrapper(nodes) {
  const items = nodes ?? [];
  if (items.length !== 1 || items[0].url) {
    return items;
  }
  const mapped = mapFirefoxRoot(items[0]);
  if (mapped.chromeId || mapped.skip) {
    return items;
  }
  return items[0].children ?? items;
}

function resolveChromeRoot(item, rootExists) {
  const mapped = mapFirefoxRoot(item);
  if (mapped.skip) {
    return { skip: true, chromeId: null };
  }
  let chromeId = mapped.chromeId;
  if (chromeId && !rootExists(chromeId)) {
    chromeId = chromeId === "3" ? fallbackRootId() : null;
  }
  return { skip: false, chromeId };
}

export async function mergeFirefoxBookmarks(nodes, { rootExists, structure }) {
  const stats = { added: 0, folders: 0, reused: 0, skipped: 0, invalid: 0, moved: 0, renamed: 0 };
  const ctx = structure;
  const match = new Map();
  const top = peelSingleWrapper(nodes ?? []);

  const startFolders = (items) => {
    for (const item of items) {
      if (!item.url) {
        identifyFolder(item, ctx, match);
      }
    }
  };

  const applyItems = async (items, parentId) => {
    for (const item of items) {
      if (item.url) {
        await addBookmark(item, parentId, ctx, stats);
        continue;
      }
      const mapped = resolveChromeRoot(item, rootExists);
      if (mapped.skip) {
        for (const child of item.children ?? []) {
          if (!child.url) {
            await applyItems([child], parentId);
          }
        }
        continue;
      }
      if (mapped.chromeId) {
        await applyItems(item.children ?? [], mapped.chromeId);
        continue;
      }
      await applyFolder(item, parentId, ctx, match, stats);
    }
  };

  startFolders(top);
  await applyItems(top, fallbackRootId());
  return stats;
}
