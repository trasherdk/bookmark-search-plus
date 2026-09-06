function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function openFormDialog({ title, fields, submitLabel = "Save" }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const form = document.createElement("form");
    form.className = "dialog";
    form.innerHTML = `<h2>${escapeHtml(title)}</h2>`;

    for (const field of fields) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.id = `dialog-${field.name}`;
      input.name = field.name;
      input.type = field.type || "text";
      input.value = field.value ?? "";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (field.required) {
        input.required = true;
      }
      if (field.readonly) {
        input.readOnly = true;
      }
      label.append(field.label, input);
      form.append(label);
    }

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "text-btn";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "text-btn dialog-ok";
    submit.textContent = submitLabel;
    if (fields.every((field) => field.readonly)) {
      submit.hidden = true;
    }
    actions.append(cancel, submit);
    form.append(actions);
    backdrop.append(form);
    document.body.append(backdrop);

    const finish = (value) => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    cancel.addEventListener("click", () => finish(null));
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) {
        finish(null);
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const data = {};
      for (const field of fields) {
        data[field.name] = String(formData.get(field.name) ?? "").trim();
      }
      finish(data);
    });
    document.addEventListener("keydown", onKey, true);
    form.querySelector("input")?.focus();
    form.querySelector("input")?.select();
  });
}
