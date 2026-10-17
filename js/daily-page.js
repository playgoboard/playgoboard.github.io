// The Daily page: slow games saved in the database (supabase/06-daily-games.sql).
//   daily.html            your games, open challenges, and "create a challenge"
//   daily.html?game=ID    one game: pick a point, then Submit move
// The database checks every move with the real rules, so this page only shows and asks.
// Usernames come from other players, so they are always shown with textContent.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { t, sentences } = window.GoI18n;
  const POLL_MS = 15000;          // look for the opponent's move this often while a game is open
  const LIST_POLL_MS = 60000;
  const DEAD_CHECK_RUNS = 60;     // practice games used to guess dead stones before a pass
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const accounts = window.GoAccounts;
  const listView = $("list-view");
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get("game");
  const joinId = params.get("join");          // opened from an invite link
  const challengeId = params.get("challenge"); // "Daily game" button in the Friends window

  const me = () => (accounts && accounts.ready ? accounts.current().profile : null);
  const colorName = (color) => (color === BLACK ? "black" : "white");
  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));
  const PLAYER_COLUMNS = `black_player:profiles!daily_games_black_fkey(username, rating),
    white_player:profiles!daily_games_white_fkey(username, rating),
    creator:profiles!daily_games_created_by_fkey(username, rating),
    invited_player:profiles!daily_games_invited_fkey(username, rating)`;
  const inviteLink = (id) => `${window.location.origin}${window.location.pathname}?join=${id}`;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(label, className, onClick) {
    const b = element("button", `btn ${className || ""}`, label);
    b.addEventListener("click", onClick);
    return b;
  }

  // "2 d 5 h", "3 h 10 min", or "Time's up".
  function timeLeft(game) {
    const ms = new Date(game.last_move_at).getTime() + game.days * DAY_MS - Date.now();
    if (ms <= 0) return t("Time's up");
    const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    if (days >= 1) return t("{d} d {h} h", { d: days, h: hours % 24 });
    if (hours >= 1) return t("{h} h {m} min", { h: hours, m: minutes % 60 });
    return t("{m} min", { m: Math.max(1, minutes) });
  }

  const daysText = (days) => (days === 1 ? t("1 day per move") : t("{n} days per move", { n: days }));
  const playerText = (p) => (p ? `${p.username} (${p.rating})` : t("Deleted player"));
  const myColorIn = (game) => (!me() ? null : game.black === me().id ? "black" : game.white === me().id ? "white" : null);

  function soundButtonSetup() {
    const soundButton = $("btn-sound");
    const draw = () => {
      const muted = window.GoSounds.isMuted();
      soundButton.textContent = muted ? "🔇" : "🔊";
      soundButton.title = muted ? t("Sound is off. Click to turn it on.") : t("Sound is on. Click to turn it off.");
      soundButton.classList.toggle("off", muted);
    };
    soundButton.addEventListener("click", () => {
      window.GoSounds.setMuted(!window.GoSounds.isMuted());
      draw();
    });
    draw();
  }

  // ---- The list page ----

  // who: "anyone" (listed for everyone), "link" (private invite link) or "friend".
  const newGame = { size: 9, days: 3, rated: false, color: "random", who: challengeId ? "friend" : "anyone", friend: challengeId };

  async function copyLink(id, note) {
    const link = inviteLink(id);
    try {
      await navigator.clipboard.writeText(link);
      note.textContent = t("Invite link copied. Send it to the person you want to play.");
    } catch {
      note.textContent = t("Copy this link: {link}", { link });
    }
  }

  // Your accepted friends, for "A friend".
  async function loadFriends() {
    const id = me().id;
    const { data } = await accounts.client.from("friendships").select(`requester, addressee,
      requester_profile:profiles!friendships_requester_fkey(id, username),
      addressee_profile:profiles!friendships_addressee_fkey(id, username)`).eq("status", "accepted");
    return (data || []).map((r) => (r.requester === id ? r.addressee_profile : r.requester_profile)).filter(Boolean)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  function choiceRow(options, current, onPick) {
    const row = element("div", "choice-row");
    for (const [value, label] of options) {
      const b = element("button", value === current ? "selected" : "", label);
      b.addEventListener("click", () => {
        for (const other of row.children) other.classList.toggle("selected", other === b);
        onPick(value);
      });
      row.append(b);
    }
    return row;
  }

  function createBox(note, friends) {
    const box = element("div", "panel-block");
    box.append(element("h2", "", t("New daily challenge")));

    // Who can join: anyone, people with the link, or one friend.
    const friendPicker = element("select", "friend-select");
    if (!friends.length) friendPicker.append(element("option", "", t("No friends yet — add some in the Friends window")));
    for (const f of friends) {
      const option = element("option", "", f.username);
      option.value = f.id;
      option.selected = f.id === newGame.friend;
      friendPicker.append(option);
    }
    if (!newGame.friend && friends.length) newGame.friend = friends[0].id;
    friendPicker.addEventListener("change", () => { newGame.friend = friendPicker.value; });
    friendPicker.hidden = newGame.who !== "friend";
    box.append(element("p", "label", t("Who can join")),
      choiceRow([["anyone", t("Anyone")], ["link", t("Invite link")], ["friend", t("A friend")]], newGame.who, (v) => {
        newGame.who = v;
        friendPicker.hidden = v !== "friend";
      }), friendPicker);
    box.append(element("p", "label", t("Board size")),
      choiceRow([[9, "9×9"], [13, "13×13"], [19, "19×19"]], newGame.size, (v) => { newGame.size = v; }));
    box.append(element("p", "label", t("Time per move")),
      choiceRow([[1, t("1 day")], [3, t("3 days")], [7, t("7 days")]], newGame.days, (v) => { newGame.days = v; }));
    box.append(element("p", "label", t("Game type")),
      choiceRow([[false, t("Casual")], [true, t("Rated")]], newGame.rated, (v) => { newGame.rated = v; }));
    box.append(element("p", "label", t("Your color")),
      choiceRow([["black", t("Black")], ["random", t("Random")], ["white", t("White")]], newGame.color, (v) => { newGame.color = v; }));
    box.append(button(t("Create challenge"), "btn-primary", async (event) => {
      if (newGame.who === "friend" && !friends.length) {
        note.textContent = t("You have no friends on the site yet. Use an invite link instead, or add friends first.");
        return;
      }
      event.target.disabled = true;
      const settings = { p_size: newGame.size, p_days: newGame.days, p_rated: newGame.rated, p_color: newGame.color };
      const { data, error } = newGame.who === "anyone"
        ? await accounts.client.rpc("create_daily_challenge", settings)
        : await accounts.client.rpc("create_daily_invite", { ...settings, p_friend: newGame.who === "friend" ? newGame.friend : null });
      if (error) {
        event.target.disabled = false;
        note.textContent = errorText(error);
        return;
      }
      await showList();
      if (newGame.who === "link") copyLink(data, note);
      else if (newGame.who === "friend") note.textContent = t("Challenge sent. Your friend sees it on their Daily page.");
      else note.textContent = t("Challenge created. It shows in your games until someone joins.");
    }));
    box.append(element("p", "rated-hint", t("Anyone: listed for everyone. Invite link: only people you send the link to. A friend: only that friend.")));
    return box;
  }

  function table(headings, rows) {
    const t2 = element("table", "data-table");
    const head = element("tr");
    for (const h of headings) head.append(element("th", "", h));
    const thead = element("thead");
    thead.append(head);
    const body = element("tbody");
    body.append(...rows);
    t2.append(thead, body);
    const wrap = element("div", "table-wrap");
    wrap.append(t2);
    return wrap;
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

  const openLink = (id, label) => {
    const a = element("a", "btn small-link", label);
    a.href = `daily.html?game=${id}`;
    return a;
  };

  // One message line for the list page, kept when the list is redrawn.
  const note = element("p", "message friend-note");

  async function joinGame(id, buttonEl) {
    if (buttonEl) buttonEl.disabled = true;
    const { error } = await accounts.client.rpc("join_daily_game", { p_game: id });
    if (error) {
      note.textContent = errorText(error);
      if (buttonEl) buttonEl.disabled = false;
      return false;
    }
    window.location.href = `daily.html?game=${id}`;
    return true;
  }

  async function showList() {
    const intro = element("div", "panel-block");
    intro.append(element("h1", "", t("Daily games")),
      element("p", "message", t("Play at your own pace: make a move whenever you like, within the time per move. You can have several games at once.")));

    if (!me()) {
      intro.append(element("p", "message", t("Log in to play daily games. They are saved to your account.")),
        button(t("Log in"), "btn-primary", () => accounts.showView("login")));
      listView.replaceChildren(intro);
      listView.hidden = false;
      return;
    }
    intro.append(note);

    await accounts.client.rpc("daily_check_timeouts");
    const id = me().id;
    const columns = `id, created_by, creator_color, black, white, board_size, days, rated, status, turn,
      last_move_at, created_at, finished_at, winner, result, private, invited, ${PLAYER_COLUMNS}`;
    const [mine, open, finished, invites, friends] = await Promise.all([
      accounts.client.from("daily_games").select(columns).in("status", ["open", "playing"])
        .or(`black.eq.${id},white.eq.${id},created_by.eq.${id}`).order("created_at", { ascending: false }),
      accounts.client.from("daily_games").select(columns).eq("status", "open").eq("private", false).neq("created_by", id)
        .order("created_at", { ascending: false }).limit(50),
      accounts.client.from("daily_games").select(columns).eq("status", "finished")
        .or(`black.eq.${id},white.eq.${id}`).order("finished_at", { ascending: false }).limit(10),
      accounts.client.from("daily_games").select(columns).eq("status", "open").eq("invited", id)
        .order("created_at", { ascending: false }),
      loadFriends(),
    ]);
    if (mine.error || open.error || finished.error || invites.error) {
      intro.append(element("p", "message", t("Couldn't load daily games. Check your internet connection and try again.")));
      listView.replaceChildren(intro);
      listView.hidden = false;
      return;
    }

    // Your games: your move first, then the least time left.
    const myTurn = (g) => g.status === "playing" && myColorIn(g) === g.turn;
    const games = mine.data.slice().sort((a, b) => (myTurn(b) - myTurn(a))
      || (a.status === "open") - (b.status === "open")
      || new Date(a.last_move_at || a.created_at) - new Date(b.last_move_at || b.created_at));
    const yours = element("div", "panel-block");
    yours.append(element("h2", "", t("Your games")));
    if (!games.length) yours.append(element("p", "message", t("No daily games yet. Create a challenge or join one below.")));
    else {
      yours.append(table([t("Opponent"), t("Board"), t("Color"), t("Status"), t("Time left"), ""], games.map((g) => {
        if (g.status === "open") {
          const actions = element("span", "row-actions");
          if (g.private && !g.invited) actions.append(button(t("Copy link"), "small-link", () => copyLink(g.id, note)));
          actions.append(button(t("Cancel"), "small-link", async () => {
            await accounts.client.rpc("cancel_daily_challenge", { p_game: g.id });
            showList();
          }));
          const waiting = g.invited ? t("Waiting for {name}", { name: g.invited_player ? g.invited_player.username : "?" })
            : g.private ? t("Invite link (waiting)") : t("Waiting for an opponent");
          return row([waiting, `${g.board_size}×${g.board_size}`, t(g.creator_color === "random" ? "Random" : g.creator_color === "black" ? "Black" : "White"),
            g.rated ? t("Rated") : t("Casual"), daysText(g.days), actions]);
        }
        const mineColor = myColorIn(g);
        const opponent = mineColor === "black" ? g.white_player : g.black_player;
        return row([playerText(opponent), `${g.board_size}×${g.board_size}`, mineColor === "black" ? t("Black") : t("White"),
          myTurn(g) ? t("Your move") : t("Their move"), timeLeft(g), openLink(g.id, myTurn(g) ? t("Play") : t("Open"))],
        myTurn(g) ? "my-turn" : "");
      })));
    }

    const others = element("div", "panel-block");
    others.append(element("h2", "", t("Open challenges")));
    if (!open.data.length) others.append(element("p", "message", t("No open challenges right now. Create one above!")));
    else {
      others.append(table([t("Player"), t("Board"), t("Time per move"), t("Type"), t("You play"), ""], open.data.map((g) => {
        const you = g.creator_color === "random" ? t("Random") : g.creator_color === "black" ? t("White") : t("Black");
        const join = button(t("Join"), "btn-primary small-link", async (event) => {
          if (!(await joinGame(g.id, event.target))) showList();
        });
        return row([playerText(g.creator), `${g.board_size}×${g.board_size}`, daysText(g.days),
          g.rated ? t("Rated") : t("Casual"), you, join]);
      })));
    }

    // Friends who challenged you.
    const forYou = element("div", "panel-block");
    forYou.append(element("h2", "", t("Challenges for you")));
    forYou.hidden = !invites.data.length;
    if (invites.data.length) {
      forYou.append(table([t("Player"), t("Board"), t("Time per move"), t("Type"), t("You play"), ""], invites.data.map((g) => {
        const you = g.creator_color === "random" ? t("Random") : g.creator_color === "black" ? t("White") : t("Black");
        const actions = element("span", "row-actions");
        actions.append(button(t("Accept"), "btn-primary small-link", (event) => joinGame(g.id, event.target)),
          button(t("Decline"), "small-link", async () => {
            await accounts.client.rpc("decline_daily_challenge", { p_game: g.id });
            note.textContent = t("Challenge declined.");
            showList();
          }));
        return row([playerText(g.creator), `${g.board_size}×${g.board_size}`, daysText(g.days),
          g.rated ? t("Rated") : t("Casual"), you, actions], "my-turn");
      })));
    }

    const done = element("div", "panel-block");
    done.append(element("h2", "", t("Finished daily games")));
    if (!finished.data.length) done.append(element("p", "message", t("None yet.")));
    else {
      done.append(table([t("Opponent"), t("Board"), t("Result"), ""], finished.data.map((g) => {
        const mineColor = myColorIn(g);
        const opponent = mineColor === "black" ? g.white_player : g.black_player;
        const won = g.winner === mineColor;
        return row([playerText(opponent), `${g.board_size}×${g.board_size}`, won ? t("Won") : t("Lost"), openLink(g.id, t("Open"))],
          won ? "won" : "lost");
      })));
    }

    listView.replaceChildren(intro, forYou, createBox(note, friends), yours, others, done);
    listView.hidden = false;
    if (window.GoDailyBadge) window.GoDailyBadge.update();
  }

  // ---- Opened from an invite link (daily.html?join=ID) ----

  async function showInvite() {
    const box = element("div", "panel-block");
    box.append(element("h1", "", t("Daily game invitation")));
    const show = (...children) => {
      box.append(...children);
      listView.replaceChildren(box);
      listView.hidden = false;
    };
    const { data, error } = await accounts.client.rpc("daily_invite_info", { p_game: joinId });
    if (error || !data) return show(element("p", "message", t("That invitation wasn't found.")));
    if (data.status === "playing" || data.status === "finished") {
      window.location.replace(`daily.html?game=${joinId}`);
      return;
    }
    const allGames = element("a", "link-button spaced-link", t("‹ All daily games"));
    allGames.href = "daily.html";
    if (data.status !== "open") return show(element("p", "message", t("This challenge isn't open any more")), allGames);
    if (data.for_someone_else) return show(element("p", "message", t("This challenge is for someone else")), allGames);

    const you = data.creator_color === "random" ? t("Random") : data.creator_color === "black" ? t("White") : t("Black");
    box.append(element("p", "invite-line", t("{name} ({rating}) invites you to a daily game.", { name: data.creator, rating: data.creator_rating })));
    const details = element("div", "stat-row");
    for (const [label, value] of [[t("Board"), `${data.board_size}×${data.board_size}`], [t("Time per move"), daysText(data.days)],
      [t("Type"), data.rated ? t("Rated") : t("Casual")], [t("You play"), you]]) {
      const stat = element("div", "stat");
      stat.append(element("b", "", value), element("span", "", label));
      details.append(stat);
    }
    box.append(details, note);
    if (!me()) {
      return show(element("p", "message", t("Log in (or create an account) to accept.")),
        button(t("Log in"), "btn-primary", () => accounts.showView("login")));
    }
    if (data.creator === me().username) {
      return show(element("p", "message", t("This is your own invite link. Send it to the person you want to play.")), allGames);
    }
    show(button(t("Accept and play"), "btn-primary", (event) => joinGame(joinId, event.target)), allGames);
  }

  // ---- One game ----

  let game = null;       // the database row
  let rules = null;      // GoGame rebuilt from the moves
  let viewCount = null;  // replay position (null = the live game)
  let pending = null;    // { x, y } picked but not submitted yet
  let deadMarks = [];    // stones the dead-stone check marked before a pass
  let sending = false;

  const isMyTurn = () => game && game.status === "playing" && myColorIn(game) === game.turn && viewCount === null;

  async function loadGame() {
    await accounts.client.rpc("daily_check_timeouts");
    const { data, error } = await accounts.client.from("daily_games").select(`*, ${PLAYER_COLUMNS}`).eq("id", gameId).maybeSingle();
    if (error || !data) {
      listView.replaceChildren(element("p", "message", error ? t("Couldn't load this. Check your internet connection and try again.") : t("That game wasn't found.")));
      listView.hidden = false;
      return false;
    }
    const before = game ? game.moves.length : null;
    const changed = !game || data.moves.length !== game.moves.length || data.status !== game.status;
    game = data;
    if (changed) {
      rules = window.GoHistory.rebuild(game.board_size, game.moves);
      pending = null;
      deadMarks = [];
      if (before !== null && game.moves.length > before) window.GoSounds.stone();
    }
    return changed;
  }

  function drawGame() {
    const mine = myColorIn(game);
    const bottom = mine === "white" ? WHITE : BLACK;
    const seats = { bottom, top: bottom === BLACK ? WHITE : BLACK };
    const players = { [BLACK]: game.black_player, [WHITE]: game.white_player };
    const total = rules.moves.length, shown = viewCount === null ? total : viewCount;
    const turnColor = game.turn === "black" ? BLACK : WHITE;

    for (const seat of ["top", "bottom"]) {
      const color = seats[seat];
      $(`stone-${seat}`).className = `stone-icon ${colorName(color)}`;
      $(`name-${seat}`).textContent = playerText(players[color]);
      const captured = t("Captured: {n}", { n: rules.captures[color] });
      const clock = game.status === "playing" && turnColor === color ? ` · ⏳ ${timeLeft(game)}` : "";
      $(`info-${seat}`).textContent = `${captured}${color === WHITE ? ` · ${t("Komi 7.5")}` : ""}${clock}`;
      $(`card-${seat}`).classList.toggle("to-move", game.status === "playing" && turnColor === color);
    }

    const move = rules.moves[shown - 1];
    const finishedByCount = game.status === "finished" && /^[BW]\+\d/.test(game.result || "");
    $("board").innerHTML = window.GoBoardView.renderBoard({
      size: game.board_size,
      board: rules.boardAfter(shown),
      lastMove: move && !move.pass ? rules.index(move.x, move.y) : null,
      territory: finishedByCount && viewCount === null ? rules.score().territory : null,
      hint: pending,
      marks: viewCount === null ? deadMarks : [],
      ghostColor: isMyTurn() && !pending ? turnColor : null,
    });
    $("board").classList.toggle("no-ghost", !isMyTurn());
    window.GoMoveList.render($("move-list"), rules.moves, game.board_size, shown);
    $("btn-first").disabled = $("btn-prev").disabled = shown === 0;
    $("btn-next").disabled = $("btn-last").disabled = viewCount === null;

    // Status and buttons.
    let status, message = "";
    if (game.status === "finished") {
      status = window.GoHistory.resultWords(game.result);
      const change = mine && game[`${mine}_change`];
      if (typeof change === "number") message = t("Your rating: {before} → {after} ({change}).",
        { before: game[`${mine}_rating_before`], after: game[`${mine}_rating_before`] + change, change: `${change >= 0 ? "+" : ""}${change}` });
      else if (!game.rated) message = t("Casual game.");
    } else if (!mine) {
      status = game.turn === "black" ? t("Black to play") : t("White to play");
    } else if (isMyTurn()) {
      status = t("Your move");
      message = pending ? t("Press Submit move to play there, or pick another point.")
        : t("Time left for this move: {time}", { time: timeLeft(game) });
    } else {
      status = t("Their move");
      message = t("You'll see their move here when they play. You can close this page.");
    }
    $("status").textContent = status;
    if (!$("message").dataset.keep) $("message").textContent = message;
    delete $("message").dataset.keep;

    const playing = game.status === "playing" && mine;
    $("play-row").hidden = !playing;
    $("submit-row").hidden = !pending;
    $("btn-pass").disabled = !isMyTurn() || sending;
    $("btn-resign").disabled = sending;
    $("btn-submit").disabled = sending;
    document.title = `GoBoard — ${playerText(game.black_player)} vs ${playerText(game.white_player)}`;
  }

  function say(text) {
    $("message").textContent = text;
    $("message").dataset.keep = "yes";
  }

  async function send(x, y) {
    sending = true;
    drawGame();
    const { error } = await accounts.client.rpc("daily_move", { p_game: game.id, p_count: game.moves.length, p_x: x, p_y: y });
    sending = false;
    if (error) say(errorText(error));
    pending = null;
    deadMarks = [];
    game = null; // force a fresh load
    await loadGame();
    drawGame();
    if (!error && window.GoDailyBadge) window.GoDailyBadge.update();
  }

  // Before a pass: opponent stones that lose in almost every practice game are probably dead.
  // The count takes the board as it is, so they would count for the opponent.
  function likelyDeadOpponentStones() {
    const opp = myColorIn(game) === "black" ? WHITE : BLACK;
    const size = game.board_size, n = size * size;
    const survived = new Int16Array(n);
    for (let run = 0; run < DEAD_CHECK_RUNS; run++) {
      const board = window.GoBot.FastBoard.fromGame(rules);
      board.playout(rules.turn, -1);
      for (let i = 0; i < n; i++) if (board.cells[i] === opp) survived[i]++;
    }
    const dead = [];
    for (let i = 0; i < n; i++) {
      if (rules.board[i] === opp && survived[i] < DEAD_CHECK_RUNS * 0.2) dead.push({ x: i % size, y: Math.floor(i / size), kind: "target" });
    }
    return dead;
  }

  function setUpGameControls() {
    $("board").addEventListener("click", (event) => {
      const spot = event.target.closest(".spot");
      if (!spot || !isMyTurn() || sending) return;
      const x = Number(spot.dataset.x), y = Number(spot.dataset.y);
      const check = rules.checkMove(x, y);
      if (!check.ok) {
        say({ occupied: t("There's already a stone there."), suicide: t("You can't play where your stones would have no liberties."),
          ko: t("Ko rule: you can't retake right away. Play somewhere else first.") }[check.reason] || "");
        pending = null;
      } else {
        pending = { x, y };
      }
      drawGame();
    });
    $("btn-submit").addEventListener("click", () => { if (pending) send(pending.x, pending.y); });
    $("btn-cancel-move").addEventListener("click", () => { pending = null; drawGame(); });
    $("btn-pass").addEventListener("click", () => {
      if (!isMyTurn()) return;
      deadMarks = likelyDeadOpponentStones();
      drawGame();
      const question = deadMarks.length
        ? t("The red-marked stones look dead, but the count takes the board as it is, so they would count for your opponent. Capture them first? Press Cancel to keep playing, or OK to pass anyway.")
        : rules.lastMove === "pass"
          ? t("Your opponent passed. If you pass too, the game ends and the board is counted. Pass?")
          : t("Pass this turn?");
      if (confirm(question)) send(-1, -1);
    });
    $("btn-resign").addEventListener("click", async () => {
      if (!confirm(t("Are you sure you want to resign?"))) return;
      sending = true;
      const { error } = await accounts.client.rpc("daily_resign", { p_game: game.id });
      sending = false;
      if (error) say(errorText(error));
      game = null;
      await loadGame();
      drawGame();
    });

    const view = (count) => {
      const total = rules.moves.length;
      viewCount = count >= total ? null : Math.max(0, count);
      pending = null;
      drawGame();
    };
    const shownCount = () => (viewCount === null ? rules.moves.length : viewCount);
    $("btn-first").addEventListener("click", () => view(0));
    $("btn-prev").addEventListener("click", () => view(shownCount() - 1));
    $("btn-next").addEventListener("click", () => view(shownCount() + 1));
    $("btn-last").addEventListener("click", () => view(rules.moves.length));
    $("move-list").addEventListener("click", (event) => {
      const b = event.target.closest("[data-count]");
      if (b) view(Number(b.dataset.count));
    });
    document.addEventListener("keydown", (event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, dialog")) return;
      if (event.key === "ArrowLeft") view(shownCount() - 1);
      else if (event.key === "ArrowRight") view(shownCount() + 1);
    });
  }

  async function showGame() {
    if (!(await loadGame())) return;
    setUpGameControls();
    $("game-view").hidden = false;
    drawGame();
    // Watch for the opponent's move; redraw the clocks too.
    setInterval(async () => {
      if (!game || game.status !== "playing" || sending || pending) return drawGame();
      if (await loadGame()) drawGame();
      else drawGame();
    }, POLL_MS);
  }

  // ---- Start ----

  soundButtonSetup();
  if (!accounts || !accounts.ready) {
    listView.replaceChildren(element("p", "message", t("Daily games couldn't load. Check your internet connection and reload the page.")));
    listView.hidden = false;
    return;
  }
  let started = false;
  accounts.onChange(() => {
    // Wait until we know who is logged in (or that nobody is), then show the page once;
    // logging in or out later redraws the list.
    if (gameId) {
      if (!started) showGame();
    } else if (joinId) {
      showInvite();
    } else {
      showList();
    }
    started = true;
  });
  if (!gameId && !joinId) setInterval(() => { if (!document.hidden && me()) showList(); }, LIST_POLL_MS);
})();
