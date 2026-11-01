// Block and report players (supabase/20-block-report.sql). Blocking stops friend requests, daily
// challenges and quick match between the two players; reports go to the admin page.
// Used by the profile page (js/profile-extras.js), your game history and the Friends window.
(function () {
  const { t } = window.GoI18n;
  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));
  const REASONS = [["cheating", "Cheating"], ["rude", "Rude in chat"], ["name", "Bad name or profile"], ["other", "Other"]];

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(text, className, onClick) {
    const b = element("button", `btn ${className || ""}`, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  async function isBlocked(client, me, player) {
    const { data, error } = await client.from("blocks").select("blocked").eq("blocker", me.id).eq("blocked", player.id);
    return !error && data.length > 0;
  }

  async function block(client, player) {
    if (!confirm(t("Block {name}? You won't get friend requests or daily challenges from each other, quick match won't pair you, and you stop being friends.", { name: player.username }))) return false;
    const { error } = await client.rpc("block_player", { p_player: player.id });
    if (error) { alert(errorText(error)); return false; }
    return true;
  }

  async function unblock(client, player) {
    const { error } = await client.rpc("unblock_player", { p_player: player.id });
    if (error) { alert(errorText(error)); return false; }
    return true;
  }

  // The report window. gameId: a game from your own history against this player, or null.
  function openReport(client, player, gameId) {
    const dialog = element("dialog", "account-dialog report-dialog");
    const close = () => { dialog.close(); dialog.remove(); };
    const closeRow = element("div", "dialog-close-row");
    const x = element("button", "dialog-close", "✕");
    x.type = "button";
    x.setAttribute("aria-label", t("Close"));
    x.addEventListener("click", close);
    closeRow.append(x);
    dialog.append(closeRow, element("h2", "", t("Report {name}", { name: player.username })));
    if (gameId) dialog.append(element("p", "", t("The admin will see this game.")));

    let reason = null;
    const reasons = element("div", "choice-row wrap");
    for (const [value, label] of REASONS) {
      const b = element("button", "", t(label));
      b.type = "button";
      b.addEventListener("click", () => {
        reason = value;
        for (const other of reasons.children) other.classList.toggle("selected", other === b);
      });
      reasons.append(b);
    }
    const note = element("textarea", "about-input");
    note.maxLength = 300;
    note.rows = 3;
    note.placeholder = t("What happened? (optional)");
    const message = element("p", "message");
    const send = button(t("Send report"), "btn-primary", async () => {
      if (!reason) { message.textContent = t("Pick a reason first"); return; }
      send.disabled = true;
      const { error } = await client.rpc("report_player", {
        p_player: player.id, p_reason: reason, p_note: note.value.replace(/\s+/g, " ").trim(), p_game: gameId || null,
      });
      if (error) {
        send.disabled = false;
        message.textContent = errorText(error);
        return;
      }
      dialog.replaceChildren(closeRow, element("h2", "", t("Thanks for the report")),
        element("p", "", t("The admin will look at it. You can also block this player so they can't challenge you.")));
    });
    dialog.append(element("p", "label", t("Reason")), reasons, note, send, message);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  // Block / Unblock and Report for someone else's profile. onChange runs after blocking or unblocking.
  async function profileButtons(client, me, player, onChange) {
    const row = element("div", "profile-actions block-report");
    const blocked = await isBlocked(client, me, player);
    if (blocked) {
      row.append(element("span", "friend-state", t("You blocked this player")),
        button(t("Unblock"), "small-btn", async () => { if (await unblock(client, player)) onChange(); }));
    } else {
      row.append(button(t("Block"), "small-btn", async () => { if (await block(client, player)) onChange(); }));
    }
    row.append(button(t("Report"), "small-btn", () => openReport(client, player, null)));
    return { row, blocked };
  }

  // Players you blocked, for the Friends window: [{ id, username }].
  async function blockedPlayers(client, me) {
    const { data, error } = await client.from("blocks")
      .select("blocked, player:profiles!blocks_blocked_fkey(id, username)")
      .eq("blocker", me.id).order("created_at", { ascending: false });
    return error ? [] : data.map((r) => r.player).filter(Boolean);
  }

  window.GoBlockReport = { openReport, profileButtons, blockedPlayers, unblock };
})();
