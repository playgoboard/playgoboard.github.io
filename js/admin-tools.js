// The Numbers, Players and Log tabs of the Admin page, and the ban window (also used by Reports).
// The database checks the admin code on every look and action (supabase/21-admin-tools.sql).
// Player search needs no code, because usernames and ratings are public anyway.
(function () {
  const { t } = window.GoI18n;
  const accounts = window.GoAccounts;
  const askCode = (what) => window.GoAdminCode.ask(what);
  const clean = (text) => t(String(text).replace(/^.*?:\s*/, ""));
  const when = (date) => new Date(date).toLocaleString();

  const REASON_NAMES = { cheating: "Cheating", rude: "Rude in chat", name: "Bad name or profile", other: "Other" };
  const ACTION_NAMES = {
    ban: "Banned", unban: "Unbanned", warn: "Warned", reset_profile: "Profile reset", force_rename: "Forced rename",
    set_rating: "Rating changed", undo_game: "Game undone", proof_fine: "Proof marked fine",
    proof_ban: "Banned for faked proof", dismiss_report: "Report dismissed",
  };
  const BAN_LENGTHS = [[1, "1 day"], [7, "7 days"], [30, "30 days"], [0, "Forever"]];

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

  // A small window with a form. onSubmit returns false to keep it open (after showing why in "problem").
  function formWindow(heading, fill, confirmText, onSubmit) {
    const dialog = element("dialog", "account-dialog admin-form");
    const problem = element("p", "message");
    const body = element("div");
    const read = fill(body, problem);
    const ok = button(confirmText, "btn-primary", async () => {
      const values = read();
      if (!values) return;
      dialog.close();
      dialog.remove();
      onSubmit(values);
    });
    const cancel = button("Cancel", "", () => { dialog.close(); dialog.remove(); });
    dialog.append(element("h2", "", heading), body, ok, cancel, problem);
    document.body.append(dialog);
    dialog.showModal();
  }

  function textBox(placeholder, max) {
    const box = element("textarea", "about-input");
    box.maxLength = max;
    box.rows = 3;
    box.placeholder = placeholder;
    return box;
  }

  // Asks for the code, runs one action, and calls onDone(code) when it worked. onProblem gets the reason why not.
  async function runAction(askText, rpcName, args, onProblem, onDone) {
    const code = await askCode(askText);
    if (!code) return;
    const { data, error } = await accounts.client.rpc(rpcName, { ...args, p_code: code });
    if (error || data) { onProblem(clean(error ? error.message : data)); return; }
    onDone(code);
  }

  // The ban window. player: { id, username }.
  function banWindow(player, startReason, onProblem, onDone) {
    let days = null;
    formWindow(`Ban ${player.username}`, (body, problem) => {
      const lengths = element("div", "choice-row wrap");
      for (const [value, label] of BAN_LENGTHS) {
        const b = element("button", "", label);
        b.type = "button";
        b.addEventListener("click", () => {
          days = value;
          for (const other of lengths.children) other.classList.toggle("selected", other === b);
        });
        lengths.append(b);
      }
      const reason = textBox("The reason the player will see", 200);
      reason.value = startReason || "";
      body.append(element("p", "label", "How long"), lengths, element("p", "label", "Reason"), reason,
        element("p", "message", "Their achievements stay. Every open report about them is closed."));
      return () => {
        if (days === null) { problem.textContent = "Pick how long the ban lasts"; return null; }
        if (!reason.value.trim()) { problem.textContent = "Write the reason the player will see"; return null; }
        return { reason: reason.value.trim() };
      };
    }, "Next", ({ reason }) => {
      runAction(`Admin code to ban ${player.username}`, "admin_set_ban",
        { p_player: player.id, p_days: days, p_reason: reason }, onProblem, onDone);
    });
  }

  // ---- Numbers ----

  async function drawNumbers(box, retry) {
    const code = await askCode("Admin code to see the numbers");
    if (!code) { box.append(button("Show the numbers", "btn-primary", retry)); return; }
    const { data, error } = await accounts.client.rpc("admin_numbers", { p_code: code });
    const problem = error ? error.message : data.error;
    if (problem) { box.append(element("p", "message", clean(problem)), button("Try again", "btn-primary", retry)); return; }
    const n = data.numbers;
    const row = element("div", "stat-row");
    for (const [label, value] of [["Players", n.players], ["New this week", n.new_week], ["Online games today", n.games_today],
      ["Online games this week", n.games_week], ["Open reports", n.open_reports], ["Games to check", n.proofs], ["Banned now", n.banned]]) {
      const stat = element("div", "stat");
      stat.append(element("b", "", String(value)), element("span", "", label));
      row.append(stat);
    }
    box.append(row, element("p", "message", "Online games counts games saved by logged-in players. Bot games and games between guests aren't saved, so they aren't counted."));
  }

  // ---- Log ----

  async function drawLog(box, retry) {
    const code = await askCode("Admin code to see the log");
    if (!code) { box.append(button("Show the log", "btn-primary", retry)); return; }
    const { data, error } = await accounts.client.rpc("admin_log_list", { p_code: code });
    const problem = error ? error.message : data.error;
    if (problem) { box.append(element("p", "message", clean(problem)), button("Try again", "btn-primary", retry)); return; }
    if (!data.rows.length) box.append(element("p", "message", "Nothing here yet."));
    for (const row of data.rows) box.append(logLine(row, row.player_name));
  }

  function logLine(row, name) {
    const line = element("div", "admin-row");
    const what = element("div");
    what.append(element("b", "", `${ACTION_NAMES[row.action] || row.action}${name ? ` — ${name}` : ""}`),
      element("span", "message", `${when(row.at)}${row.detail ? ` · ${row.detail}` : ""}`));
    line.append(what);
    return line;
  }

  // ---- Players ----

  function drawPlayers(box, note) {
    const search = element("div", "join-row");
    const input = element("input");
    input.placeholder = "Part of a username (empty = newest players)";
    input.maxLength = 16;
    input.autocomplete = "off";
    const results = element("div");
    const card = element("div");
    const go = async () => {
      results.textContent = "";
      card.textContent = "";
      const words = input.value.replace(/[^A-Za-z0-9_]/g, "");
      let query = accounts.client.from("profiles").select("id, username, rating, banned_until");
      query = words ? query.ilike("username", `%${words.replace(/_/g, "\\_")}%`).order("username")
        : query.order("created_at", { ascending: false });
      const { data, error } = await query.limit(20);
      if (error) { results.append(element("p", "message", clean(error.message))); return; }
      if (!data.length) results.append(element("p", "message", "No players found."));
      for (const player of data) {
        const line = element("div", "admin-row");
        const what = element("div");
        const banned = player.banned_until && new Date(player.banned_until) > new Date();
        what.append(element("b", "", player.username), element("span", "message", `Rating ${player.rating}${banned ? " · Banned" : ""}`));
        const open = button("Open", "small-link", () => openCard(player.id, card, note));
        line.append(what, open);
        results.append(line);
      }
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    search.append(input, button("Search", "btn-primary", go));
    box.append(search, results, card);
    go();
  }

  async function openCard(playerId, card, note, knownCode) {
    const code = knownCode || await askCode("Admin code to open this player");
    if (!code) return;
    const { data, error } = await accounts.client.rpc("admin_player_card", { p_player: playerId, p_code: code });
    const problem = error ? error.message : data.error;
    if (problem) { note.textContent = clean(problem); return; }
    card.textContent = "";
    drawCard(data.card, card, note);
    card.scrollIntoView();
  }

  function drawCard(info, card, note) {
    const p = info.player;
    const reopen = (code) => openCard(p.id, card, note, code);
    const fail = (text) => { note.textContent = text; };
    const box = element("div", "panel-block admin-card");
    const name = element("h2");
    name.append(window.GoAvatars.profileLink(p.username));
    box.append(name);
    if (p.must_rename) box.append(element("p", "message", "Waiting for this player to pick a new username."));
    if (p.banned_until) {
      const forever = new Date(p.banned_until).getFullYear() >= 9000;
      box.append(element("p", "admin-banned", `${forever ? "Banned forever" : `Banned until ${when(p.banned_until)}`}${p.ban_reason ? `: ${p.ban_reason}` : ""}`));
    }
    if (p.about) box.append(element("p", "message admin-about", p.about));

    const stats = element("div", "stat-row");
    for (const [label, value] of [["Rating", p.rating], ["Rated games", p.games], ["Wins", p.wins], ["Losses", p.losses],
      ["Joined", new Date(p.created_at).toLocaleDateString()]]) {
      const stat = element("div", "stat");
      stat.append(element("b", "", String(value)), element("span", "", label));
      stats.append(stat);
    }
    box.append(stats);

    const actions = element("div", "button-row admin-actions");
    if (p.banned_until) {
      actions.append(button("Unban", "", () => runAction(`Admin code to unban ${p.username}`, "admin_unban", { p_player: p.id }, fail, (code) => {
        note.textContent = `${p.username} is unbanned.`;
        reopen(code);
      })));
    }
    if (!p.is_admin) {
      actions.append(button(p.banned_until ? "Change ban" : "Ban", "btn-danger", () => banWindow(p, p.ban_reason, fail, (code) => {
        note.textContent = `${p.username} is banned.`;
        reopen(code);
      })));
    }
    actions.append(button("Warn", "", () => formWindow(`Warn ${p.username}`, (body, problem) => {
      const words = textBox("The message they'll see next time they open the site", 500);
      body.append(words);
      return () => {
        if (!words.value.trim()) { problem.textContent = "Write the message first"; return null; }
        return { message: words.value.trim() };
      };
    }, "Next", ({ message }) => runAction(`Admin code to warn ${p.username}`, "admin_warn", { p_player: p.id, p_message: message }, fail, (code) => {
      note.textContent = `Warning sent to ${p.username}.`;
      reopen(code);
    }))));
    actions.append(button("Clear picture and About me", "", () => {
      if (!confirm(`Clear ${p.username}'s picture and About me?`)) return;
      runAction(`Admin code to reset ${p.username}'s profile`, "admin_reset_profile", { p_player: p.id }, fail, (code) => {
        note.textContent = "Profile cleared.";
        reopen(code);
      });
    }));
    actions.append(button("Force new username", "", () => {
      if (!confirm(`Give ${p.username} a temporary name and make them pick a new one?`)) return;
      runAction(`Admin code to rename ${p.username}`, "admin_force_rename", { p_player: p.id }, fail, (code) => {
        note.textContent = "Temporary name given. They'll pick a new one next visit.";
        reopen(code);
      });
    }));
    actions.append(button("Change rating", "", () => formWindow(`Change ${p.username}'s rating`, (body, problem) => {
      const number = element("input");
      number.type = "number";
      number.min = 100;
      number.max = 3000;
      number.value = p.rating;
      const reason = textBox("Why (only in the log)", 200);
      body.append(element("p", "label", "New rating (100 to 3000)"), number, element("p", "label", "Reason"), reason);
      return () => {
        const rating = Number(number.value);
        if (!Number.isInteger(rating) || rating < 100 || rating > 3000) { problem.textContent = "The rating must be between 100 and 3000"; return null; }
        return { rating, reason: reason.value.trim() };
      };
    }, "Next", ({ rating, reason }) => runAction(`Admin code to change ${p.username}'s rating`, "admin_set_rating",
      { p_player: p.id, p_rating: rating, p_reason: reason }, fail, (code) => {
        note.textContent = "Rating changed.";
        reopen(code);
      }))));
    box.append(actions);

    const section = (heading, rows, draw) => {
      const part = element("div", "admin-section");
      part.append(element("h3", "", `${heading} (${rows.length})`));
      for (const row of rows) part.append(draw(row));
      box.append(part);
    };
    const line = (title, detail, extra) => {
      const row = element("div", "admin-row");
      const what = element("div");
      what.append(element("b", "", title), element("span", "message", detail));
      row.append(what);
      if (extra) {
        const tools = element("span", "row-actions");
        tools.append(extra);
        row.append(tools);
      }
      return row;
    };
    const replayLink = (record) => {
      if (!record) return null;
      const a = element("a", "btn small-link", "Replay");
      a.href = `leaderboard.html?game=${record}`;
      a.target = "_blank";
      return a;
    };
    const reportLine = (word) => (r) => {
      const row = line(`${REASON_NAMES[r.reason] || r.reason} (${r.status})`, `${word} ${r.other || "Deleted player"} · ${when(r.created_at)}`, replayLink(r.game));
      if (r.note) row.firstChild.append(element("p", "admin-report-note", r.note));
      return row;
    };

    section("Rated games", info.games, (g) => {
      const signed = `${g.change >= 0 ? "+" : ""}${g.change}`;
      const tools = element("span", "row-actions");
      const replay = replayLink(g.record);
      if (replay) tools.append(replay);
      if (g.rating_undone) tools.append(element("span", "message", "Undone"));
      else {
        tools.append(button("Undo rating", "small-link", () => {
          if (!confirm("Undo this game's rating change, win and loss for BOTH players?")) return;
          runAction("Admin code to undo this game", "admin_undo_game", { p_kind: g.kind, p_game: g.id }, fail, (code) => {
            note.textContent = "Game undone for both players.";
            reopen(code);
          });
        }));
      }
      return line(`${g.won ? "Won" : "Lost"} against ${g.opponent || "Deleted player"} (${signed})`,
        `${g.kind === "daily" ? "Daily" : "Live"} · ${g.board_size}×${g.board_size} · ${when(g.finished_at)}`, tools);
    });
    section("Reports against them", info.against, reportLine("From"));
    section("Reports they sent", info.sent, reportLine("About"));
    section("Warnings", info.warnings, (w) => line(w.message, `${when(w.created_at)} · ${w.seen_at ? `Seen ${when(w.seen_at)}` : "Not seen yet"}`));
    section("Admin actions", info.log, (l) => logLine(l, ""));
    card.append(box);
  }

  window.GoAdminTools = { drawNumbers, drawLog, drawPlayers, banWindow, REASON_NAMES };
})();
