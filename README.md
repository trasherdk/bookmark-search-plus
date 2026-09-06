# Bookmark Search Plus

A Brave (and Chrome / Edge) side-panel extension for finding bookmarks the way [Bookmark search plus 2](https://github.com/aaFn/Bookmark-search-plus-2/) does in Firefox: search titles, URLs, and folders, see the parent-folder path, then jump to that place in the tree.

This is an original Manifest V3 implementation inspired by that UX, not a source port.

## Install in Brave

1. Open `brave://extensions`
2. Turn on **Developer mode**
3. If this extension is already listed, click **Remove** first
4. Click **Load unpacked**
5. Choose this folder: `bookmark-search-plus`
6. Confirm the version is **1.4.1**
7. Pin the toolbar icon (amber star)

Click the icon, or press **Ctrl+Shift+.** (macOS: **Command+Shift+.**), to open the side panel. Drag its edge to resize.

The same **Load unpacked** steps work in Chrome (`chrome://extensions`) and Edge (`edge://extensions`).

If the shortcut is unused, set it under `brave://extensions/shortcuts`.

## How it works

**Tree (no search text)**  
Browse folders like the native bookmarks sidebar. Click a folder to expand or collapse it. Click a bookmark to open it.

**Search**  
Type in the box. Results include folders, not just bookmarks. Each result shows its title, URL (or “Folder”), and the parent path (`Work / Docs / Specs`).

Click a result to expand the tree to that item. Bookmarks also open. Clear the search box to restore the folders you had open before you searched.

**Go parent folder**  
Select an item, then use the status-bar button, **Alt+Up**, or **Left** on a collapsed folder to jump to the enclosing folder.

**Text size**  
Use **A−** / **A+** in the toolbar. The size is remembered.

**Close**  
Use **×** in the toolbar, or Brave’s side-panel close control.

## Search filters

Open the gear control next to the search box.

| Filter | Options |
| --- | --- |
| Match in | Title + URL, Title only, URL only |
| Look in | Entire tree, Current folder tree, Current folder only |
| How | Match words (substring), Use regex |
| Show | All items, Folders only, Bookmarks only |

**Current folder** is the selected folder, or the parent of the selected bookmark, captured when you start typing.

## Mouse and keyboard

| Action | Result |
| --- | --- |
| Click a bookmark | Open in a new tab next to the current one |
| Alt+click | Open in the current tab |
| Shift+click | Open in a new window |
| Down from the search box | Jump to the first result or tree row |
| Up / Down | Move the selection |
| Enter | Open a bookmark, or expand/collapse a folder |
| Right / Left | Expand / collapse a folder |
| Escape | Leave “showing in tree”, or clear the search |

## Permissions

- **Bookmarks** — read the bookmark tree and keep it in sync
- **Side panel** — dock beside the page
- **Tabs** — open a result in the current tab, a new tab, or a new window
- **Favicon** — show site icons already cached by the browser
- **Storage** — remember open folders, filters, and text size

Bookmarks are not uploaded. Nothing leaves the browser.

## Out of scope (v1)

Drag-and-drop, edit/delete, undo history, and a full context menu are not included yet.
