// Asks the admin for the admin code in a small window (supabase/12-admin-code.sql checks it).
// Resolves to the code, or null if cancelled. The code is never kept: every action asks again.
(function () {
  const { t } = window.GoI18n;

  // The window for choosing a code, shown when this admin has none (supabase/22-choose-admin-code.sql).
  // Resolves to the new code, or null if cancelled.
  function choose() {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "account-dialog";
      let finished = false;
      const finish = (answer) => {
        if (finished) return;
        finished = true;
        dialog.close();
        dialog.remove();
        resolve(answer);
      };
      const heading = document.createElement("h2");
      heading.textContent = "Choose your admin code";
      const about = document.createElement("p");
      about.textContent = "You'll type it for every admin action. Use at least 6 characters, and not your GoBoard password. It can't be changed here later.";
      const box = (text) => {
        const label = document.createElement("label");
        label.textContent = text;
        const input = document.createElement("input");
        input.type = "password";
        input.autocomplete = "new-password";
        label.append(input);
        return { label, input };
      };
      const first = box("New admin code");
      first.input.name = "goboard-new-admin-code";
      const again = box("Type it again");
      again.input.name = "goboard-new-admin-code-again";
      const showRow = document.createElement("label");
      showRow.className = "remember-row";
      const show = document.createElement("input");
      show.type = "checkbox";
      show.addEventListener("change", () => {
        first.input.type = again.input.type = show.checked ? "text" : "password";
      });
      showRow.append(show, document.createTextNode("Show the code"));
      const problem = document.createElement("p");
      problem.className = "message";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "btn btn-primary";
      ok.textContent = "Save code";
      ok.addEventListener("click", async () => {
        const code = first.input.value.trim();
        if (code !== again.input.value.trim()) { problem.textContent = "The two codes aren't the same"; return; }
        ok.disabled = true;
        const { data, error } = await window.GoAccounts.client.rpc("admin_choose_code", { p_code: code });
        ok.disabled = false;
        if (error || data) { problem.textContent = t(String(error ? error.message : data).replace(/^.*?:\s*/, "")); return; }
        codeIsSet = true;
        finish(code);
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Later";
      cancel.addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
      dialog.append(heading, about, first.label, again.label, showRow, ok, cancel, problem);
      document.body.append(dialog);
      dialog.showModal();
      first.input.focus();
    });
  }

  // Once a code exists it stays, so this is remembered for the rest of the visit.
  let codeIsSet = false;
  async function needsChoosing() {
    if (codeIsSet) return false;
    const { data, error } = await window.GoAccounts.client.rpc("admin_code_is_set");
    if (error || data !== false) { // before step 22 is set up the question fails: ask for the code as usual
      codeIsSet = !error;
      return false;
    }
    return true;
  }

  // For opening the Admin page: asks an admin with no code to choose one.
  async function chooseIfNeeded() {
    if (await needsChoosing()) await choose();
  }

  async function ask(what) {
    // Choosing a code is also the proof for the action that was waiting for it.
    if (await needsChoosing()) return choose();
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

  window.GoAdminCode = { ask, chooseIfNeeded };
})();
