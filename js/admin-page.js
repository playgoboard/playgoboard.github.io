// The Admin page (only for the admin, checked by the database): replay the games sent as proof
// for bot achievements and big captures, mark them fine, or ban the player for 7 days.
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

  async function drawList() {
    listBox.textContent = "";
    const head = element("div", "panel-block");
    head.append(element("h1", "", t("Admin: check achievements")),
      element("p", "message", t("Replay each game and run Dragon's Review. If the bot kept making big mistakes that the real bot never makes, the game was probably faked. Only ban when it's obvious.")));
    const toggle = button(showReviewed ? t("Show games to check") : t("Show checked games"), "", () => { showReviewed = !showReviewed; drawList(); });
    head.append(toggle);
    listBox.append(head);

    const { data, error } = await accounts.client.rpc("admin_proofs", { p_reviewed: showReviewed });
    const box = element("div", "panel-block");
    if (error) {
      box.append(element("p", "message", t(error.message.replace(/^.*?:\s*/, ""))));
      listBox.append(box);
      return;
    }
    if (!data.length) box.append(element("p", "message", t("Nothing here.")));
    for (const row of data) {
      const a = window.GoAchievements.BY_ID.get(row.achievement);
      const p = row.proof || {};
      const line = element("div", "admin-row");
      const what = element("div");
      what.append(element("b", "", `${row.username} — ${a ? `${a.icon} ${t(a.title)}` : row.achievement}`),
        element("span", "message", `${p.kind === "bot" ? BOT_NAMES[(p.level || 1) - 1] : t("Online")} · ${p.size}×${p.size} · ${(p.moves || []).length} ${t("moves")} · ${new Date(row.unlocked_at).toLocaleString()}`));
      const actions = element("div", "row-actions");
      actions.append(button(t("Replay"), "small-link", () => replay(row)));
      if (!showReviewed) {
        actions.append(button(t("Looks fine"), "small-link", async () => {
          await accounts.client.rpc("admin_mark_reviewed", { p_player: row.player, p_achievement: row.achievement });
          drawList();
        }));
      }
      actions.append(button(t("Ban 7 days"), "btn-danger small-link", async () => {
        if (!confirm(t("Ban {name} for 7 days and remove all their achievements?", { name: row.username }))) return;
        const { error: banError } = await accounts.client.rpc("admin_ban", { p_player: row.player });
        if (banError) alert(t(banError.message.replace(/^.*?:\s*/, "")));
        drawList();
      }));
      line.append(what, actions);
      box.append(line);
    }
    listBox.append(box);
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
