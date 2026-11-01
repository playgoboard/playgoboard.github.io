// The Admin page (only for the admin, checked by the database): replay the games sent as proof
// for bot achievements and big captures, mark them fine, or ban the player for 7 days.
// Every admin action asks for the admin code (set in Supabase, see supabase/12-admin-code.sql).
(function () {
  const { t } = window.GoI18n;
  const { BLACK, WHITE } = window.Go;
  const accounts = window.GoAccounts;
  const $ = (id) => document.getElementById(id);
  const listBox = $("admin-list");
  const BOT_NAMES = ["Pebble", "Sprout", "Fox", "Tiger", "Dragon"];

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

  let showReviewed = false;
  const TABS = [["numbers", "Numbers"], ["players", "Players"], ["proofs", "Achievements"], ["reports", "Reports"], ["log", "Log"]];
  let tab = "players"; // starts here because searching needs no admin code

  const askCode = window.GoAdminCode.ask;

  const note = element("p", "message admin-note");

  async function drawList() {
    listBox.textContent = "";
    $("replay-panel").hidden = true;
    note.textContent = "";
    const switchRow = element("div", "choice-row wrap admin-switch");
    for (const [name, label] of TABS) {
      const b = element("button", name === tab ? "selected" : "", label);
      b.type = "button";
      b.addEventListener("click", () => { if (tab !== name) { tab = name; drawList(); } });
      switchRow.append(b);
    }
    listBox.append(switchRow);
    if (tab === "reports") return drawReports();
    if (tab !== "proofs") {
      const tools = window.GoAdminTools;
      const head = element("div", "panel-block");
      head.append(element("h1", "", `Admin: ${TABS.find(([name]) => name === tab)[1].toLowerCase()}`), note);
      const box = element("div", "panel-block");
      listBox.append(head, box);
      if (tab === "numbers") tools.drawNumbers(box, drawList);
      else if (tab === "log") tools.drawLog(box, drawList);
      else tools.drawPlayers(box, note);
      return;
    }
    const head = element("div", "panel-block");
    head.append(element("h1", "", t("Admin: check achievements")),
      element("p", "message", t("Replay each game and run Dragon's Review. If the bot kept making big mistakes that the real bot never makes, the game was probably faked. Only ban when it's obvious.")));
    const toggle = button(showReviewed ? t("Show games to check") : t("Show checked games"), "", () => { showReviewed = !showReviewed; drawList(); });
    head.append(toggle, note);
    listBox.append(head);

    const box = element("div", "panel-block");
    listBox.append(box);
    const code = await askCode(t("Admin code to see the list"));
    if (!code) {
      box.append(button(t("Show the list"), "btn-primary", drawList));
      return;
    }
    const { data, error } = await accounts.client.rpc("admin_proofs", { p_reviewed: showReviewed, p_code: code });
    const problem = error ? error.message.replace(/^.*?:\s*/, "") : data.error;
    if (problem) {
      box.append(element("p", "message", t(problem)), button(t("Try again"), "btn-primary", drawList));
      return;
    }
    const rows = data.rows;
    if (!rows.length) box.append(element("p", "message", t("Nothing here.")));
    for (const row of rows) {
      const a = window.GoAchievements.BY_ID.get(row.achievement);
      const p = row.proof || {};
      const line = element("div", "admin-row");
      line.dataset.player = row.player;
      const what = element("div");
      what.append(element("b", "", `${row.username} — ${a ? `${a.icon} ${t(a.title)}` : row.achievement}`),
        element("span", "message", `${p.kind === "bot" ? BOT_NAMES[(p.level || 1) - 1] : t("Online")} · ${p.size}×${p.size} · ${(p.moves || []).length} ${t("moves")} · ${new Date(row.unlocked_at).toLocaleString()}`));
      const actions = element("div", "row-actions");
      actions.append(button(t("Replay"), "small-link", () => replay(row)));
      if (!showReviewed) {
        actions.append(button(t("Looks fine"), "small-link", async () => {
          const okCode = await askCode(t("Admin code to mark this game fine"));
          if (!okCode) return;
          const { data: problem, error: e } = await accounts.client.rpc("admin_mark_reviewed", { p_player: row.player, p_achievement: row.achievement, p_code: okCode });
          if (e || problem) return showProblem(e ? e.message : problem);
          line.remove();
          note.textContent = t("Marked fine.");
        }));
      }
      actions.append(button(t("Ban 7 days"), "btn-danger small-link", async () => {
        if (!confirm(t("Ban {name} for 7 days and remove all their achievements?", { name: row.username }))) return;
        const banCode = await askCode(t("Admin code to ban {name}", { name: row.username }));
        if (!banCode) return;
        const { data: problem, error: e } = await accounts.client.rpc("admin_ban", { p_player: row.player, p_code: banCode });
        if (e || problem) return showProblem(e ? e.message : problem);
        for (const other of [...box.querySelectorAll(".admin-row")]) if (other.dataset.player === row.player) other.remove();
        note.textContent = t("{name} is banned for 7 days.", { name: row.username });
      }));
      line.append(what, actions);
      box.append(line);
    }
    listBox.append(box);
  }

  // ---- Reports from players ----

  const REASON_NAMES = window.GoAdminTools.REASON_NAMES;

  async function drawReports() {
    const head = element("div", "panel-block");
    head.append(element("h1", "", t("Admin: reports")),
      element("p", "message", t("Look at the game or the player's profile first. A ban keeps their achievements and closes every report about them.")), note);
    const box = element("div", "panel-block");
    listBox.append(head, box);
    const code = await askCode(t("Admin code to see the list"));
    if (!code) {
      box.append(button(t("Show the list"), "btn-primary", drawList));
      return;
    }
    const { data, error } = await accounts.client.rpc("admin_reports", { p_code: code });
    const problem = error ? error.message.replace(/^.*?:\s*/, "") : data.error;
    if (problem) {
      box.append(element("p", "message", t(problem)), button(t("Try again"), "btn-primary", drawList));
      return;
    }
    if (!data.rows.length) box.append(element("p", "message", t("Nothing here.")));
    for (const row of data.rows) {
      const line = element("div", "admin-row");
      line.dataset.player = row.reported;
      const what = element("div");
      const name = element("b");
      name.append(window.GoAvatars.profileLink(row.reported_name),
        document.createTextNode(` — ${t(REASON_NAMES[row.reason] || row.reason)}`));
      what.append(name,
        element("span", "message", `${t("From {name}", { name: row.reporter_name || t("Deleted player") })} · ${new Date(row.created_at).toLocaleString()} · ${t("Open reports: {n}", { n: row.open_reports })}`));
      if (row.note) what.append(element("p", "admin-report-note", row.note));
      const actions = element("div", "row-actions");
      if (row.game) {
        const game = element("a", "btn small-link", t("Replay"));
        game.href = `leaderboard.html?game=${row.game}`;
        game.target = "_blank";
        actions.append(game);
      }
      const dismiss = async () => {
        const okCode = await askCode(t("Admin code to dismiss this report"));
        if (!okCode) return;
        const { data: problem, error: e } = await accounts.client.rpc("admin_handle_report", { p_report: row.id, p_ban: false, p_code: okCode });
        if (e || problem) return showProblem(e ? e.message : problem);
        line.remove();
        note.textContent = t("Report dismissed.");
      };
      const ban = () => window.GoAdminTools.banWindow({ id: row.reported, username: row.reported_name }, t(REASON_NAMES[row.reason] || ""), showProblem, () => {
        for (const other of [...box.querySelectorAll(".admin-row")]) if (other.dataset.player === row.reported) other.remove();
        note.textContent = `${row.reported_name} is banned.`;
      });
      actions.append(button(t("Dismiss"), "small-link", dismiss), button(t("Ban"), "btn-danger small-link", ban));
      line.append(what, actions);
      box.append(line);
    }
  }

  function showProblem(text) {
    note.textContent = t(String(text).replace(/^.*?:\s*/, ""));
  }

  // Replay one proof game on the board, with Dragon's Review.
  let current = null;
  function replay(row) {
    const p = row.proof;
    const game = window.GoHistory.rebuild(p.size, p.moves);
    const total = game.moves.length;
    current = { game, total, shown: total, dead: new Set(p.dead || []), you: p.you === "black" ? BLACK : WHITE };
    $("replay-title").textContent = `${row.username}: ${p.you === "black" ? t("Black") : t("White")} · ${p.kind === "bot" ? BOT_NAMES[(p.level || 1) - 1] : t("Online")}`;
    $("review-box").textContent = "";
    $("btn-admin-review").disabled = false;
    $("replay-panel").hidden = false;
    draw();
    $("replay-panel").scrollIntoView();
  }

  function draw() {
    const { game, shown, total } = current;
    const board = game.boardAfter(shown);
    $("admin-board").innerHTML = window.GoBoardView.renderBoard({
      size: game.size, board, ghostColor: null,
      // Stones the player marked dead at the end show faded (a cheat could mark live stones dead).
      dead: shown === total ? current.dead : new Set(),
      lastMove: shown > 0 && typeof game.moves[shown - 1].x === "number" ? game.moves[shown - 1].y * game.size + game.moves[shown - 1].x : null,
    });
    $("replay-count").textContent = t("Move {n} of {total}", { n: shown, total });
  }

  const go = (n) => { if (current) { current.shown = Math.max(0, Math.min(current.total, n)); draw(); } };
  $("btn-first").addEventListener("click", () => go(0));
  $("btn-prev").addEventListener("click", () => go(current.shown - 1));
  $("btn-next").addEventListener("click", () => go(current.shown + 1));
  $("btn-last").addEventListener("click", () => go(current.total));
  $("btn-admin-review").addEventListener("click", async () => {
    if (!current) return;
    $("btn-admin-review").disabled = true;
    const box = $("review-box");
    box.textContent = t("Dragon is reviewing the game… {n}%", { n: 0 });
    try {
      const data = await window.GoReview.analyze({
        size: current.game.size,
        startBoard: new Array(current.game.size * current.game.size).fill(0),
        moves: current.game.moves,
        onProgress: (done) => { box.textContent = t("Dragon is reviewing the game… {n}%", { n: Math.round(done * 100) }); },
        isCancelled: () => false,
      });
      box.textContent = "";
      window.GoReview.renderPanel(box, data, go);
    } catch {
      box.textContent = t("Dragon's Review couldn't run in this browser.");
    }
  });

  if (!accounts || !accounts.ready) return;
  accounts.onChange(async ({ profile }) => {
    if (!profile) {
      listBox.textContent = "";
      listBox.append(element("p", "message panel-block", t("Log in with the admin account to see this page.")));
      return;
    }
    const { data: admin } = await accounts.client.rpc("is_admin");
    if (!admin) {
      listBox.textContent = "";
      listBox.append(element("p", "message panel-block", t("Only the admin can see this page.")));
      return;
    }
    drawList();
  });
})();
