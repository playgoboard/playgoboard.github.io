// Asks the admin for the admin code in a small window (supabase/12-admin-code.sql checks it).
// Resolves to the code, or null if cancelled. The code is never kept: every action asks again.
(function () {
  const { t } = window.GoI18n;

  function ask(what) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "account-dialog";
      const heading = document.createElement("h2");
      heading.textContent = what;
      const label = document.createElement("label");
      label.textContent = t("Admin code");
      const input = document.createElement("input");
      input.type = "password";
      // "off" is ignored for password boxes: browsers would fill in the saved login password.
      input.autocomplete = "new-password";
      input.name = "goboard-admin-code";
      label.append(input);
      const showRow = document.createElement("label");
      showRow.className = "remember-row";
      const show = document.createElement("input");
      show.type = "checkbox";
      show.addEventListener("change", () => { input.type = show.checked ? "text" : "password"; });
      showRow.append(show, document.createTextNode(t("Show the code")));
      let answer = null; // stays null when closed with Cancel or Escape
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "btn btn-primary";
      ok.textContent = t("Confirm");
      ok.addEventListener("click", () => { answer = input.value.trim() || null; dialog.close(); });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = t("Cancel");
      cancel.addEventListener("click", () => dialog.close());
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") ok.click(); });
      dialog.append(heading, label, showRow, ok, cancel);
      dialog.addEventListener("close", () => {
        dialog.remove();
        resolve(answer);
      });
      document.body.append(dialog);
      dialog.showModal();
      input.focus();
    });
  }

  window.GoAdminCode = { ask };
})();
