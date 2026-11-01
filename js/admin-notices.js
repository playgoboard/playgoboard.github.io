// What a player sees from the admin (supabase/21-admin-tools.sql): a window when they're banned,
// warnings they have to tap OK on, and picking a new username when the admin asked for one.
(function () {
  const accounts = window.GoAccounts;
  if (!accounts || !accounts.ready) return;
  const client = accounts.client;
  const { t } = window.GoI18n;
  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));
  const BAN_SHOWN_KEY = "goboard-ban-shown";

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  // A window that stays until fill's "finish" is called; Escape doesn't close it.
  function notice(heading, fill) {
    return new Promise((resolve) => {
      const dialog = element("dialog", "account-dialog admin-notice");
      dialog.append(element("h2", "", heading));
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      fill(dialog, () => { dialog.close(); dialog.remove(); resolve(); });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  function message(heading, text, onOk) {
    return notice(heading, (dialog, finish) => {
      const ok = element("button", "btn btn-primary", t("OK"));
      ok.type = "button";
      ok.addEventListener("click", () => { if (onOk) onOk(); finish(); });
      dialog.append(element("p", "admin-notice-text", text), ok);
    });
  }

  function askNewName() {
    return notice(t("Please pick a new username"), (dialog, finish) => {
      const input = element("input");
      input.maxLength = 16;
      input.autocomplete = "off";
      input.placeholder = t("3–16 letters, numbers or _");
      const problem = element("p", "message");
      const save = element("button", "btn btn-primary", t("Save"));
      save.type = "button";
      save.addEventListener("click", async () => {
        const name = input.value.trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { problem.textContent = t("Usernames are 3–16 letters, numbers or _ (no spaces)."); return; }
        if (window.GoChatFilter && window.GoChatFilter.cleanMessage(name) !== name) { problem.textContent = t("Please pick a friendlier username."); return; }
        save.disabled = true;
        const { error } = await client.rpc("set_my_new_username", { p_name: name });
        save.disabled = false;
        if (error) { problem.textContent = errorText(error); return; }
        finish();
        accounts.refreshProfile();
      });
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") save.click(); });
      dialog.append(element("p", "", t("The admin asked you to change your username. Your rating and games stay the same.")), input, save, problem);
    });
  }

  let checkedFor = null; // once per page, for each account

  accounts.onChange(async ({ profile }) => {
    if (!profile) {
      checkedFor = null;
      const ban = accounts.banMessage();
      if (!ban) return;
      // Once per visit, because a banned player can't do anything else here anyway.
      try {
        if (sessionStorage.getItem(BAN_SHOWN_KEY)) return;
        sessionStorage.setItem(BAN_SHOWN_KEY, "1");
      } catch { /* shows on every page instead */ }
      message(t("Your account is banned"), ban);
      return;
    }
    if (checkedFor === profile.id) return;
    checkedFor = profile.id;
    if (profile.must_rename) await askNewName();
    const { data, error } = await client.from("player_warnings").select("id, message")
      .is("seen_at", null).order("created_at");
    if (error) return; // the step 21 tables aren't there yet, or no connection
    for (const warning of data) {
      await message(t("A message from the admin"), warning.message,
        () => client.rpc("ack_warning", { p_warning: warning.id }));
    }
  });
})();
