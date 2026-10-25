// The Leaderboard page. Three views, picked by the address:
//   leaderboard.html                  top players
//   leaderboard.html?player=NAME      one player's profile and game history
//   leaderboard.html?game=ID          replay of one saved game
// Usernames come from other players, so they are always shown with textContent.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { t } = window.GoI18n;
  const TOP_PLAYERS = 100;
  const HISTORY_GAMES = 50;
  const STATS_GAMES = 500; // stats and the rating graph look further back than the list

  const $ = (id) => document.getElementById(id);
  const accounts = window.GoAccounts;
  const gameHistory = window.GoHistory;
  const listView = $("list-view");
  const params = new URLSearchParams(window.location.search);

  const playerLink = (name) => `leaderboard.html?player=${encodeURIComponent(name)}`;
  const myProfile = () => (accounts && accounts.ready ? accounts.current().profile : null);
  const dateText = (when) => new Date(when).toLocaleDateString();
  // Saved names of players without an account look like "Guest" or "Guest (Novice)".
  function shownName(name) {
    const guest = /^Guest(?: \((\w+)\))?$/.exec(name);
    if (!guest) return name;
    return guest[1] ? t("Guest ({level})", { level: t(guest[1]) }) : t("Guest");
  }

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function link(text, href, className) {
    const a = element("a", className || "", text);
    a.href = href;
    return a;
  }

  // A name with its small profile picture, linking to the profile.
  function nameWithPicture(p) {
    const a = link("", playerLink(p.username), "player-link");
    a.append(window.GoAvatars.element(p.avatar, p.username, 24), p.username);
    return a;
  }

  function row(cells, className) {
    const tr = element("tr", className);
    for (const cell of cells) {
      const td = element("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell;
      tr.append(td);
    }
    return tr;
  }

  function table(headings, rows) {
    const t = element("table", "data-table");
    const head = element("tr");
    for (const h of headings) head.append(element("th", "", h));
    const thead = element("thead");
    thead.append(head);
    const body = element("tbody");
    body.append(...rows);
    t.append(thead, body);
    const wrap = element("div", "table-wrap");
    wrap.append(t);
    return wrap;
  }

  function showList(...children) {
    listView.textContent = "";
    listView.append(...children);
    listView.hidden = false;
  }

  function problem(text) {
    const box = element("div", "panel-block");
    box.append(element("h1", "", t("Leaderboard")), element("p", "message", text));
    showList(box);
  }

  const failText = t("Couldn't load this. Check your internet connection and try again.");

  // ---- Top players ----

  async function showTopPlayers() {
    const { data, error } = await accounts.client.from("profiles")
      .select("*")
      .gt("games", 0).order("rating", { ascending: false }).limit(TOP_PLAYERS);
    if (error) return problem(failText);
    const me = myProfile();
    const box = element("div", "panel-block");
    box.append(element("h1", "", t("Leaderboard")),
      element("p", "message", t("Players with at least one rated game. Click a name to see their games.")));
    if (!data.length) {
      box.append(element("p", "message", t("Nobody has played a rated game yet. Be the first! Play online and pick Rated.")));
    } else {
      box.append(table(["#", t("Player"), t("Rating"), t("Games"), t("Won / Lost")], data.map((p, k) =>
        row([String(k + 1), nameWithPicture(p), String(p.rating), String(p.games), `${p.wins} / ${p.losses}`],
          me && me.username === p.username ? "me" : ""))));
    }
    if (me) box.append(link(t("See my games"), playerLink(me.username), "link-button spaced-link"));
    showList(box);
  }

  // ---- One player's profile and games ----

  // Saved games (with moves) plus rated games that were played before saving existed.
  function mergeGames(player, records, ratedGames) {
    const ratedById = new Map(ratedGames.map((g) => [g.id, g]));
    const games = records.map((r) => ({
      when: r.created_at,
      opponent: r.opponent_name,
      opponentIsAccount: Boolean(r.opponent),
      color: r.my_color,
      size: r.board_size,
      won: r.winner === r.my_color,
      how: r.result.split("+")[1],
      rated: r.rated_game_id ? ratedById.get(r.rated_game_id) || { pending: true } : null,
      quick: r.quick,
      daily: r.daily,
      ratingChange: r.rating_change,
      replayId: r.id,
    }));
    const saved = new Set(records.map((r) => r.rated_game_id).filter(Boolean));
    for (const g of ratedGames) {
      if (saved.has(g.id) || !g.winner) continue;
      const color = g.black === player.id ? "black" : "white";
      const other = color === "black" ? g.white_player : g.black_player;
      games.push({
        when: g.finished_at || g.created_at,
        opponent: other ? other.username : t("Deleted player"),
        opponentIsAccount: Boolean(other),
        color,
        size: g.board_size,
        won: g.winner === color,
        how: null,
        rated: g,
        quick: false,
        replayId: null,
      });
    }
    return games.sort((a, b) => new Date(b.when) - new Date(a.when));
  }

  function resultText(game) {
    if (game.rated && game.rated.winner === "disputed") return t("Disputed");
    const won = game.won;
    if (game.how === "R") return won ? t("Won (resign)") : t("Lost (resign)");
    if (game.how === "T") return won ? t("Won (time)") : t("Lost (time)");
    if (game.how) return won ? t("Won by {n} points", { n: game.how }) : t("Lost by {n} points", { n: game.how });
    return won ? t("Won") : t("Lost");
  }

  function typeText(game, color) {
    const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
    if (game.daily) {
      return typeof game.ratingChange === "number"
        ? `${t("Daily")} · ${t("Rated")} ${signed(game.ratingChange)}` : `${t("Daily")} · ${t("Casual")}`;
    }
    if (!game.rated) return game.quick ? t("Casual · Quick") : t("Casual");
    const change = game.rated[`${color}_change`];
    if (typeof change !== "number") return t("Rated");
    return `${t("Rated")} ${change >= 0 ? "+" : ""}${change}`;
  }

  async function showPlayer(name) {
    const client = accounts.client;
    const extras = window.GoProfileExtras;
    // "*" so the page still works before supabase/08-profiles.sql adds the picture columns.
    const found = await client.from("profiles").select("*").eq("username", name).maybeSingle();
    if (found.error) return problem(failText);
    const player = found.data;
    if (!player) return problem(t("There's no player with that name. They may have deleted their account."));

    const [records, rated] = await Promise.all([
      client.from("game_records")
        .select("id, my_color, opponent, opponent_name, board_size, winner, result, rated_game_id, quick, daily, rating_change, created_at")
        .eq("player", player.id).order("created_at", { ascending: false }).limit(STATS_GAMES),
      client.from("rated_games")
        .select(`id, black, white, board_size, winner, created_at, finished_at, black_change, white_change,
          black_player:profiles!rated_games_black_fkey(username), white_player:profiles!rated_games_white_fkey(username)`)
        .or(`black.eq.${player.id},white.eq.${player.id}`)
        .order("created_at", { ascending: false }).limit(STATS_GAMES),
    ]);
    if (rated.error) return problem(failText);
    // Before the game history database step is set up, show rated games only.
    const savedRecords = records.error ? [] : records.data;
    const allGames = mergeGames(player, savedRecords, rated.data);
    const games = allGames.slice(0, HISTORY_GAMES);

    // Every rating change: rated live games, and rated daily games (saved with their change).
    const changes = [
      ...rated.data.filter((g) => g.winner === "black" || g.winner === "white")
        .map((g) => ({ when: g.finished_at || g.created_at, change: g.black === player.id ? g.black_change : g.white_change })),
      ...savedRecords.filter((r) => r.daily && typeof r.rating_change === "number")
        .map((r) => ({ when: r.created_at, change: r.rating_change })),
    ];

    const me = myProfile();
    const isMe = Boolean(me && me.id === player.id);
    const profile = element("div", "panel-block");
    const head = element("div", "profile-head");
    const titles = element("div");
    titles.append(element("h1", "", player.username));
    if (player.about) titles.append(element("p", "profile-about", player.about));
    head.append(window.GoAvatars.element(player.avatar, player.username, 64), titles);
    profile.append(link(t("‹ Leaderboard"), "leaderboard.html", "link-button"), head);
    const stats = element("div", "stat-row");
    for (const [label, value] of [[t("Rating"), player.rating], [t("Rated games"), player.games], [t("Wins"), player.wins],
      [t("Losses"), player.losses], [t("Member since"), dateText(player.created_at)],
      ...(window.GoAchievements ? [[t("Streak"), `🔥 ${window.GoAchievements.currentStreak(player)}`]] : [])]) {
      const stat = element("div", "stat");
      stat.append(element("b", "", String(value)), element("span", "", label));
      stats.append(stat);
    }
    profile.append(stats);

    const parts = [profile];
    if (isMe) {
      const edit = extras.editBox(client, player, () => window.location.reload());
      const editButton = element("button", "btn", t("Edit profile"));
      editButton.type = "button";
      editButton.addEventListener("click", () => { edit.hidden = !edit.hidden; });
      const row = element("div", "profile-actions");
      row.append(editButton);
      profile.append(row);
      parts.push(edit);
    } else {
      profile.append(await extras.actions(client, me, player));
    }
    parts.push(await extras.badges(client, player), extras.ratingGraph(player.rating, changes), extras.stats(allGames));

    const list = element("div", "panel-block");
    list.append(element("h2", "", t("Games")));
    if (!games.length) {
      list.append(element("p", "message", t("No online games yet. Games are saved here when a logged-in player finishes an online game.")));
    } else {
      list.append(table([t("Date"), t("Opponent"), t("Color"), t("Board"), t("Result"), t("Type"), ""], games.map((g) => {
        const opponent = g.opponentIsAccount ? link(g.opponent, playerLink(g.opponent)) : shownName(g.opponent);
        const replay = g.replayId ? link(t("Replay"), `leaderboard.html?game=${g.replayId}`, "btn small-link") : element("span", "message", t("No replay"));
        return row([dateText(g.when), opponent, g.color === "black" ? t("Black") : t("White"), `${g.size}×${g.size}`,
          resultText(g), typeText(g, g.color), replay], g.won ? "won" : "lost");
      })));
    }
    parts.push(list);
    showList(...parts);
    document.title = `GoBoard — ${player.username}`;
  }

  // ---- Replaying a saved game ----

  async function showReplay(id) {
    const { data: record, error } = await accounts.client.from("game_records")
      .select("*, owner:profiles!game_records_player_fkey(username)").eq("id", id).maybeSingle();
    if (error || !record) return problem(error ? failText : t("That game wasn't found."));
    let rated = null;
    if (record.rated_game_id) {
      const r = await accounts.client.from("rated_games").select("*").eq("id", record.rated_game_id).maybeSingle();
      rated = r.data;
    }

    const game = gameHistory.rebuild(record.board_size, record.moves);
    const total = game.moves.length;
    let shown = total;
    const ownerColor = record.my_color === "black" ? BLACK : WHITE;
    const ownerName = record.owner ? record.owner.username : t("Deleted player");
    const seats = { bottom: ownerColor, top: ownerColor === BLACK ? WHITE : BLACK };
    const names = { [ownerColor]: ownerName, [seats.top]: shownName(record.opponent_name) };

    $("replay-back").href = record.owner ? playerLink(record.owner.username) : "leaderboard.html";
    $("replay-result").textContent = gameHistory.resultWords(record.result);
    const kind = rated ? `${t("Rated")}${typeof rated[`${record.my_color}_change`] === "number"
      ? ` (${ownerName} ${rated[`${record.my_color}_change`] >= 0 ? "+" : ""}${rated[`${record.my_color}_change`]})` : ""}`
      : record.daily ? (typeof record.rating_change === "number"
        ? `${t("Daily")} · ${t("Rated")} (${ownerName} ${record.rating_change >= 0 ? "+" : ""}${record.rating_change})`
        : `${t("Daily")} · ${t("Casual")}`)
      : record.quick ? t("Casual quick match") : t("Casual");
    $("replay-details").textContent = `${record.board_size}×${record.board_size} · ${kind} · ${dateText(record.created_at)}`;

    for (const seat of ["top", "bottom"]) {
      const color = seats[seat];
      $(`stone-${seat}`).className = `stone-icon ${color === BLACK ? "black" : "white"}`;
      $(`name-${seat}`).textContent = names[color];
    }

    function draw() {
      const move = game.moves[shown - 1];
      const captures = shown >= total ? game.captures : game.history[shown].captures;
      const turnColor = shown >= total ? null : game.history[shown].turn;
      $("board").innerHTML = window.GoBoardView.renderBoard({
        size: game.size,
        board: game.boardAfter(shown),
        lastMove: move && !move.pass ? game.index(move.x, move.y) : null,
        hint: review ? window.GoReview.suggestion(review.data, shown) : null,
        ghostColor: null,
      });
      for (const seat of ["top", "bottom"]) {
        const color = seats[seat];
        $(`info-${seat}`).textContent = t("Captured: {n}", { n: captures[color] }) + (color === WHITE ? ` · ${t("Komi 7.5")}` : "");
        $(`card-${seat}`).classList.toggle("to-move", turnColor === color);
      }
      window.GoMoveList.render($("move-list"), game.moves, game.size, shown, review ? window.GoReview.moveLabels(review.data) : undefined);
      if (review) review.panel.show(shown);
      $("btn-first").disabled = $("btn-prev").disabled = shown === 0;
      $("btn-next").disabled = $("btn-last").disabled = shown >= total;
    }

    const go = (count) => {
      shown = Math.max(0, Math.min(total, count));
      draw();
    };

    // Dragon's Review of this game (js/dragon-review.js).
    let review = null;
    const reviewButton = $("btn-review");
    reviewButton.hidden = !window.GoReview || total < 2;
    reviewButton.addEventListener("click", async () => {
      reviewButton.hidden = true;
      const box = $("review-block");
      box.hidden = false;
      box.textContent = "";
      const heading = document.createElement("h2");
      heading.textContent = t("Dragon's Review");
      const progress = document.createElement("p");
      progress.className = "message thinking";
      progress.textContent = window.GoBot.brainLoading()
        ? t("Dragon is waking up: loading its brain (about 15 MB, only the first time)…")
        : t("Dragon is reviewing the game… {n}%", { n: 0 });
      box.append(heading, progress);
      try {
        const data = await window.GoReview.analyze({
          size: game.size,
          startBoard: new Array(game.size * game.size).fill(0),
          moves: game.moves,
          onProgress: (done) => { progress.textContent = t("Dragon is reviewing the game… {n}%", { n: Math.round(done * 100) }); },
          isCancelled: () => false,
        });
        review = { data, panel: window.GoReview.renderPanel(box, data, go) };
        draw();
      } catch {
        box.textContent = t("Dragon's Review couldn't run in this browser.");
      }
    });
    $("btn-first").addEventListener("click", () => go(0));
    $("btn-prev").addEventListener("click", () => go(shown - 1));
    $("btn-next").addEventListener("click", () => go(shown + 1));
    $("btn-last").addEventListener("click", () => go(total));
    $("move-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-count]");
      if (button) go(Number(button.dataset.count));
    });
    document.addEventListener("keydown", (event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, dialog")) return;
      if (event.key === "ArrowLeft") go(shown - 1);
      else if (event.key === "ArrowRight") go(shown + 1);
    });

    draw();
    $("replay-view").hidden = false;
    document.title = `GoBoard — ${names[BLACK]} vs ${names[WHITE]}`;
  }

  // ---- Start ----

  if (!accounts || !accounts.ready || !gameHistory) {
    problem(t("The leaderboard couldn't load. Check your internet connection and reload the page."));
    return;
  }
  const gameId = params.get("game");
  const playerName = params.get("player");
  const view = gameId ? showReplay(gameId) : playerName ? showPlayer(playerName) : showTopPlayers();
  view.catch(() => problem(failText));
})();
