function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function labelHtml(label, accessKey) {
  const text = String(label);
  if (!accessKey) {
    return escapeHtml(text);
  }
  const index = text.toLowerCase().indexOf(accessKey.toLowerCase());
  if (index === -1) {
    return escapeHtml(text);
  }
  return `${escapeHtml(text.slice(0, index))}<u>${escapeHtml(text.slice(index, index + 1))}</u>${escapeHtml(text.slice(index + 1))}`;
}

function clampMenu(el, x, y) {
  const pad = 4;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - width - pad));
  const top = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - height - pad));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export class ContextMenu {
  constructor(host) {
    this.host = host;
    this.onAction = null;
    this.items = [];
    this.submenuTimer = 0;
    this.boundPointer = (event) => this.onPointerDown(event);
    this.boundKey = (event) => this.onKeyDown(event);
    this.boundClose = () => this.close();
  }

  get open() {
    return this.host.childElementCount > 0;
  }

  show(x, y, items, onAction) {
    this.close();
    this.items = items;
    this.onAction = onAction;
    const menu = this.renderMenu(items);
    this.host.append(menu);
    clampMenu(menu, x, y);
    document.addEventListener("pointerdown", this.boundPointer, true);
    document.addEventListener("keydown", this.boundKey, true);
    window.addEventListener("resize", this.boundClose);
    document.addEventListener("scroll", this.boundClose, true);
  }

  close() {
    clearTimeout(this.submenuTimer);
    this.host.replaceChildren();
    this.items = [];
    this.onAction = null;
    document.removeEventListener("pointerdown", this.boundPointer, true);
    document.removeEventListener("keydown", this.boundKey, true);
    window.removeEventListener("resize", this.boundClose);
    document.removeEventListener("scroll", this.boundClose, true);
  }

  renderMenu(items, { submenu = false } = {}) {
    const menu = document.createElement("div");
    menu.className = submenu ? "ctx-menu ctx-sub" : "ctx-menu";
    menu.setAttribute("role", "menu");
    for (const item of items) {
      if (item.type === "separator") {
        const sep = document.createElement("div");
        sep.className = "ctx-sep";
        sep.setAttribute("role", "separator");
        menu.append(sep);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ctx-item";
      button.dataset.action = item.id;
      button.setAttribute("role", "menuitem");
      button.disabled = Boolean(item.disabled);
      if (item.title) {
        button.title = item.title;
      }
      const text = document.createElement("span");
      text.innerHTML = labelHtml(item.label, item.accessKey);
      button.append(text);
      if (item.submenu) {
        button.classList.add("has-sub");
        const caret = document.createElement("span");
        caret.className = "ctx-caret";
        caret.textContent = "▸";
        button.append(caret);
        button.addEventListener("pointerenter", () => this.openSubmenu(button, item.submenu));
      } else {
        button.addEventListener("pointerenter", () => this.closeSubmenu());
        button.addEventListener("click", () => {
          if (button.disabled) {
            return;
          }
          const action = item.id;
          const handler = this.onAction;
          this.close();
          handler?.(action);
        });
      }
      menu.append(button);
    }
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    return menu;
  }

  openSubmenu(anchor, items) {
    clearTimeout(this.submenuTimer);
    this.closeSubmenu();
    const sub = this.renderMenu(items, { submenu: true });
    this.host.append(sub);
    const rect = anchor.getBoundingClientRect();
    const x = rect.right - 2;
    const y = rect.top - 4;
    clampMenu(sub, x, y);
    if (sub.getBoundingClientRect().left < rect.right - 8) {
      clampMenu(sub, rect.left - sub.offsetWidth + 2, y);
    }
  }

  closeSubmenu() {
    for (const node of [...this.host.children].slice(1)) {
      node.remove();
    }
  }

  onPointerDown(event) {
    if (this.host.contains(event.target)) {
      return;
    }
    this.close();
  }

  onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.stopPropagation();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const letter = event.key.toLowerCase();
    const match = this.flatItems().find(
      (item) => item.accessKey && item.accessKey.toLowerCase() === letter && !item.disabled && !item.submenu
    );
    if (!match) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handler = this.onAction;
    this.close();
    handler?.(match.id);
  }

  flatItems() {
    const list = [];
    const walk = (items) => {
      for (const item of items) {
        if (item.type === "separator") {
          continue;
        }
        list.push(item);
        if (item.submenu) {
          walk(item.submenu);
        }
      }
    };
    walk(this.items);
    return list;
  }
}
