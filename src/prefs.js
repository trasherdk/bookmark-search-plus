export const PREFS_KEY = "bsp-prefs";
export const FONT_MIN = 10;
export const FONT_MAX = 18;
export const FONT_DEFAULT = 12;

export const DEFAULT_PREFS = {
  fontSize: FONT_DEFAULT,
};

export function clampFontSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) {
    return FONT_DEFAULT;
  }
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(value)));
}

export function extensionAlive() {
  try {
    return Boolean(globalThis.chrome?.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextInvalidated(error) {
  return String(error?.message ?? error).includes("Extension context invalidated");
}

export async function getPrefs() {
  if (!extensionAlive() || !chrome.storage?.local) {
    return { ...DEFAULT_PREFS };
  }
  try {
    const data = await chrome.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(data[PREFS_KEY] ?? {}) };
  } catch (error) {
    if (isContextInvalidated(error)) {
      return { ...DEFAULT_PREFS };
    }
    throw error;
  }
}

export async function setPrefs(patch) {
  if (!extensionAlive() || !chrome.storage?.local) {
    return { ...DEFAULT_PREFS, ...patch };
  }
  try {
    const prefs = await getPrefs();
    const next = { ...prefs, ...patch };
    await chrome.storage.local.set({ [PREFS_KEY]: next });
    return next;
  } catch (error) {
    if (isContextInvalidated(error)) {
      return { ...DEFAULT_PREFS, ...patch };
    }
    throw error;
  }
}
