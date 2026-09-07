# Bookmark Search Plus

A Brave (and Chrome / Edge) side-panel extension for finding bookmarks the way [Bookmark search plus 2](https://github.com/aaFn/Bookmark-search-plus-2/) does in Firefox: search titles, URLs, and folders, see the parent-folder path, then jump to that place in the tree.

This is an original Manifest V3 implementation inspired by that UX, not a source port.

## Install in Brave

1. Open `brave://extensions`
2. Turn on **Developer mode**
3. If this extension is already listed, click **Remove** first
4. Click **Load unpacked**
5. Choose this folder: `bookmark-search-plus`
6. Confirm the version is **1.7.2**
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

**Add current page**  
Use **Add page** in the status bar, or **Ctrl+D** (macOS: **Command+D**). The bookmark goes in the selected folder, or in the parent folder of a selected bookmark. If nothing is selected, it goes in the bookmarks bar. Internal pages such as `brave://` cannot be bookmarked.

**Remove**  
Select an item, then use **Remove**, **Delete** when the list is focused, or **Delete** on the right-click menu. Bookmarks are removed on their own. Removing a folder deletes that folder and every bookmark and folder inside it. The bookmarks bar and other built-in roots cannot be removed.

**Right-click menu**  
Right-click a row for the same kind of menu as Bookmark search plus 2: open all in tabs, go parent, bookmark the highlighted tab(s) here, new bookmark/folder, cut/copy/paste, delete, sort by name, properties, and a bookmark-path submenu. **Advanced** expands or collapses a whole folder branch, opens all bookmarks in a new window, or copies a URL. **New Separator** is shown but disabled — Brave and Chrome have no bookmark separators.

**Drag and drop**  
In the tree, a short click still opens a bookmark or expands a folder. Hold the mouse button (or drag a few pixels) to move an item — the pointer becomes grabbing only after that. Drop on the top or bottom of a row to place it before or after that item. Drop on the middle of a folder to move it inside. Expand the destination folder first if you want to drop among its children. Built-in roots (bookmarks bar, other bookmarks) cannot be dragged. You cannot drop a folder into itself or into one of its children.

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
| Hold, then drag a row | Move the bookmark or folder |
| Alt+click | Open in the current tab |
| Shift+click | Open in a new window |
| Down from the search box | Jump to the first result or tree row |
| Up / Down | Move the selection |
| Enter | Open a bookmark, or expand/collapse a folder |
| Right-click | Open the bookmark menu |
| Right / Left | Expand / collapse a folder |
| Shift+Right / Shift+Left | Expand / collapse a whole folder branch |
| Escape | Close the menu, leave “showing in tree”, or clear the search |
| Ctrl+D / Command+D | Bookmark the current page |
| Delete | Remove the selected bookmark or folder (asks first) |

## Permissions

- **Bookmarks** — read the tree, add pages, create folders, move items, and remove items
- **Side panel** — dock beside the page
- **Tabs** — open a result in the current tab, a new tab, or a new window
- **Favicon** — show site icons already cached by the browser
- **Storage** — remember open folders, filters, and text size

Bookmarks are not uploaded. Nothing leaves the browser.

## Out of scope (v1)

Undo history is not included yet.
