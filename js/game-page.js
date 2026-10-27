// Draws the board and wires up the buttons. All rule decisions live in go-rules.js,
// the computer's moves come from go-bot.js, and online-lobby.js connects online games
// through the small window.GoPage interface at the bottom.
(function () {
  const { GoGame, BLACK, WHITE, otherColor } = window.Go;
  const { BOT_LEVELS, chooseBotMove } = window.GoBot;
  const { GameClock, formatTime } = window.GoClock;
  const LOW_TIME_MS = 20000;      // the clock turns red below this
  const TIMEOUT_GRACE_MS = 2000;  // online: wait a moment before calling your friend's time, in case their move is on its way

  const { t, sentences } = window.GoI18n;
  const COLOR_NAME = { [BLACK]: t("Black"), [WHITE]: t("White") };
  const ILLEGAL_MOVE_TEXT = {
    occupied: t("There's already a stone there."),
    suicide: t("You can't play where your stones would have no liberties."),
    ko: t("Ko rule: you can't retake right away. Play somewhere else first."),
  };

  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const statusEl = $("status");
  const messageEl = $("message");
  const undoButton = $("btn-undo");
  const passButton = $("btn-pass");
  const resignButton = $("btn-resign");
  const hintButton = $("btn-hint");

  // Choices in the "New game" box (only used when a game starts).
  const setup = { mode: "friend", size: 19, botLevel: 1, color: "black", clockMinutes: 0, bonusSeconds: 0, rated: false };

  // The game being played right now.
  let game = new GoGame(setup.size);
  let clock = new GameClock(0, 0);
  let gameNumber = 0;
  let opponent = "friend"; // "friend" (same computer), "bot" or "online"
  let humanColor = BLACK;  // your color against a bot or an online friend
  let botLevel = 1;
  let botThinking = false;
  let botToken = 0;        // bumped to cancel a bot that is still thinking
  let link = null;         // the online connection, if any
  let linkOpen = false;
  let onlineActions = [];  // everything that happened in this online game, in order (replayed after a reconnect)
  let viewCount = null;      // replay: show the board after this many moves (null = the live game)
  let rematchMine = false;   // you asked for a rematch
  let rematchFriend = false; // your friend asked for one
  let onlineMeta = {};       // from the creator: { ratedGameId, players: { [color]: { username, rating } }, note }
  let ratedReported = false; // this browser already sent the result of the rated game
  let recordSaved = false;   // this game is already in your game history
  // Achievements (js/achievements.js), tracked by gameNumber. Undo or a custom start position
  // makes a game "unfair": it still counts for the streak, but not for bot achievements.
  let unfairGame = -1;
  let achievementsGame = -1;
  let capturesSeen = { gameNumber: -1, count: 0 };

  // Hints come from the strongest bot and are only valid for the position they were asked in.
  const HINT_LEVEL = 5;
  let hint = null;         // { x, y } or { pass: true }
  let hintThinking = false;
  let hintKey = "";
  let hintToken = 0;
  const positionKey = () => `${gameNumber}|${game.board.join("")}|${game.turn}|${game.phase}`;

  // Each bot has a round picture in img/bots/, named after its English name.
  const botPicture = (bot) => `img/bots/${bot.name.toLowerCase()}.svg`;
  const botShortName = () => t(BOT_LEVELS[botLevel - 1].name);
  const botName = () => t("{name} (Level {level})", { name: botShortName(), level: botLevel });
  const isOpponentTurn = () => opponent !== "friend" && game.phase === "play" && game.turn !== humanColor;
  const isBotTurn = () => opponent === "bot" && isOpponentTurn();

  // Logged-in online players have a username and rating (from the creator's lookup).
  const onlinePlayer = (color) => (opponent === "online" && onlineMeta.players ? onlineMeta.players[color] : null);
  // Quick match opponents are strangers, so the texts say "opponent" instead of "friend".
  const friendWord = () => (opponent === "online" && onlineMeta.quick ? "opponent" : "friend");
  const FriendWord = () => (friendWord() === "friend" ? t("Friend") : t("Opponent"));
  const YourFriend = () => (friendWord() === "friend" ? t("Your friend") : t("Your opponent"));
  const yourFriend = () => (friendWord() === "friend" ? t("your friend") : t("your opponent"));
  const isYou = (color) => opponent !== "friend" && color === humanColor;

  function playerName(color) {
    if (opponent === "friend") return COLOR_NAME[color];
    if (color === humanColor) return t("You");
    if (opponent === "bot") return botName();
    return onlinePlayer(color) ? onlinePlayer(color).username : FriendWord();
  }

  // Quick match guests show the level they picked, e.g. "Guest (Beginner)".
  function guestName(player) {
    return player.level ? t("Guest ({level})", { level: t(player.level) }) : t("Guest");
  }

  // The name on the player card: online it shows usernames with ratings when known.
  function cardName(color) {
    const player = onlinePlayer(color);
    if (!player) return playerName(color);
    if (player.rating !== undefined) return `${player.username} (${player.rating})${player.title ? ` · 🏅 ${t(player.title)}` : ""}`;
    return player.id ? player.username : guestName(player);
  }

  // Resignation and running out of time end the game without counting.
  const endedByScore = () => game.phase === "over" && game.result && game.result.margin !== undefined;

  function resultText(r) {
    const vars = { winner: playerName(r.winner), n: r.margin };
    if (isYou(r.winner)) {
      if (r.byResignation) return t("You win by resignation");
      if (r.byTimeout) return t("You win on time");
      return t("You win by {n} points", vars);
    }
    if (r.byResignation) return t("{winner} wins by resignation", vars);
    if (r.byTimeout) return t("{winner} wins on time", vars);
    return t("{winner} wins by {n} points", vars);
  }

  // ---- Board drawing ----

  function drawBoard() {
    if (window.GoEditor && window.GoEditor.isOpen()) return; // the position editor owns the board for now
    // While replaying, show the old position plainly: no territory, dead marks, hints or ghost stones.
    const viewing = viewCount !== null;
    const scoring = !viewing && (game.phase === "scoring" || endedByScore());
    let lastMove = null;
    if (viewing) {
      const move = game.moves[viewCount - 1];
      if (move && !move.pass) lastMove = game.index(move.x, move.y);
    } else if (typeof game.lastMove === "number" && game.phase === "play") {
      lastMove = game.lastMove;
    }
    const ghostsOn = game.phase === "play" && !isOpponentTurn() && !viewing;
    boardEl.innerHTML = window.GoBoardView.renderBoard({
      size: game.size,
      board: viewing ? game.boardAfter(viewCount) : game.board,
      dead: viewing ? null : game.dead,
      territory: scoring ? game.score().territory : null,
      lastMove,
      hint: hint && !hint.pass && !viewing ? hint : review ? window.GoReview.suggestion(review.data, shownCount()) : null,
      ghostColor: ghostsOn ? game.turn : null,
    });
  }

  // ---- Side panel ----

  function statusText() {
    if (game.phase === "scoring") {
      const s = game.score();
      return t("Scoring — Black {black}, White {white}", { black: s.black, white: s.white });
    }
    if (game.phase === "over") return resultText(game.result);
    if (botThinking) return t("{name} is thinking", { name: botShortName() });
    if (hintThinking) return t("Looking for a good move");
    if (opponent === "online" && !linkOpen) return t("Connection lost");
    if (opponent === "online") return isOpponentTurn() ? t("{name}'s move", { name: FriendWord() }) : t("Your move");
    if (opponent === "bot") return t("Your move");
    return game.turn === BLACK ? t("Black to play") : t("White to play");
  }

  function updatePanel() {
    const online = opponent === "online";
    for (const [color, id] of [[BLACK, "name-black"], [WHITE, "name-white"]]) {
      // Players with an account: the name opens their profile (in a new tab, so the game keeps going).
      const player = onlinePlayer(color);
      if (player && player.id) {
        const a = window.GoAvatars.profileLink(player.username, cardName(color));
        a.target = "_blank";
        $(id).replaceChildren(a);
      } else {
        $(id).textContent = cardName(color);
      }
    }
    $("info-black").textContent = t("Captured: {n}", { n: game.captures[BLACK] });
    $("info-white").textContent = `${t("Captured: {n}", { n: game.captures[WHITE] })} · ${t("Komi 7.5")}`;

    const bottomColor = opponent === "friend" ? BLACK : humanColor;
    for (const color of [BLACK, WHITE]) {
      const card = $(color === BLACK ? "card-black" : "card-white");
      card.classList.toggle("to-move", game.phase === "play" && game.turn === color);
      const avatar = $(color === BLACK ? "avatar-black" : "avatar-white");
      const isBot = opponent === "bot" && color !== humanColor;
      avatar.hidden = !isBot;
      if (isBot) avatar.src = botPicture(BOT_LEVELS[botLevel - 1]);
      card.classList.toggle("bottom-seat", color === bottomColor);
      card.classList.toggle("top-seat", color !== bottomColor);
    }

    window.GoChat.show(online);
    const rematchButton = $("btn-rematch");
    $("rematch-row").hidden = !(online && game.phase === "over");
    $("review-row").hidden = !(game.phase === "over" && game.moves.length >= 2 && !review && !reviewing && window.GoReview);
    rematchButton.disabled = !linkOpen || rematchMine;
    rematchButton.textContent = rematchMine ? t("Waiting for {yourFriend}…", { yourFriend: yourFriend() })
      : rematchFriend ? t("Accept rematch") : t("Rematch");
    $("play-buttons").hidden = game.phase === "scoring";
    $("scoring-buttons").hidden = game.phase !== "scoring";
    // No takebacks or hints against an online friend: that would be cheating.
    undoButton.disabled = online || botThinking || !game.canUndo();
    hintButton.disabled = online || game.phase !== "play" || isOpponentTurn() || hintThinking;
    passButton.disabled = game.phase !== "play" || isOpponentTurn() || (online && !linkOpen);
    resignButton.disabled = game.phase !== "play" || isBotTurn() || (online && !linkOpen);
    if (resignButton.disabled && !$("resign-ask").hidden) showResignAsk(false);
    $("btn-finish").disabled = $("btn-resume").disabled = online && !linkOpen;
    if (opponent === "bot" && botScoring.busy) $("btn-finish").disabled = true;
    undoButton.title = online ? t("Undo is off in online games") : "";

    statusEl.classList.toggle("thinking", botThinking || hintThinking);
    statusEl.textContent = statusText();
    if (game.phase === "scoring" && opponent === "bot") {
      messageEl.textContent = botScoring.busy
        ? t("{name} is checking which stones are dead…", { name: botShortName() })
        : t("{name} marked the dead stones. Press Count score, or Keep playing if you disagree.", { name: botShortName() });
    } else if (game.phase === "scoring") {
      messageEl.textContent = online
        ? t("Both passed. Either of you can click dead groups (you both see it), then press Count score.")
        : t("Both passed. Click any dead groups to remove them, then press Count score.");
    } else if (endedByScore()) {
      messageEl.textContent = t("Final score: Black {black}, White {white}.", { black: game.result.black, white: game.result.white });
    }
  }

  function dropStaleHint() {
    if ((hint || hintThinking) && hintKey !== positionKey()) {
      hint = null;
      hintThinking = false;
      hintToken++;
    }
  }

  // Plays a sound when a new stone appears (any player), but not for undo or a new game.
  let heard = { gameNumber: -1, moveNumber: 0, captures: 0 };
  function playMoveSounds() {
    const captures = game.captures[BLACK] + game.captures[WHITE];
    const newStone = heard.gameNumber === gameNumber && game.moveNumber === heard.moveNumber + 1
      && typeof game.lastMove === "number";
    if (newStone) {
      window.GoSounds.stone();
      if (captures > heard.captures) window.GoSounds.capture(captures - heard.captures);
    }
    heard = { gameNumber, moveNumber: game.moveNumber, captures };
  }

  // The button may be missing if a browser briefly mixes an old cached page with this script.
  const soundButton = $("btn-sound");
  function updateSoundButton() {
    const muted = window.GoSounds.isMuted();
    const button = soundButton;
    if (!button) return;
    button.textContent = muted ? "🔇" : "🔊";
    button.title = muted ? t("Sound is off. Click to turn it on.") : t("Sound is on. Click to turn it off.");
    button.classList.toggle("off", muted);
  }

  if (soundButton) soundButton.addEventListener("click", () => {
    window.GoSounds.setMuted(!window.GoSounds.isMuted());
    updateSoundButton();
    if (!window.GoSounds.isMuted()) window.GoSounds.stone(); // a sample so you hear it's on
  });
  updateSoundButton();
  window.addEventListener("goboard-sound", updateSoundButton);

  // ---- Game clock ----

  // Whose clock should run right now (null = nobody's). Bots have no clock, and
  // online clocks pause while the connection is down.
  function clockRunner() {
    if (!clock.on || game.phase !== "play" || isBotTurn()) return null;
    if (opponent === "online" && !linkOpen) return null;
    return game.turn;
  }

  function showClocks() {
    for (const color of [BLACK, WHITE]) {
      const el = $(color === BLACK ? "clock-black" : "clock-white");
      if (!el) continue;
      el.hidden = !clock.on || (opponent === "bot" && color !== humanColor);
      const left = clock.timeLeft(color);
      el.textContent = formatTime(left);
      el.classList.toggle("low", left < LOW_TIME_MS);
    }
  }

  // Ran out of time? Online, you call your own time at once and your friend's
  // only after a short grace period, in case their move is still on its way.
  function checkTimeout() {
    const color = clock.running;
    if (!color || game.phase !== "play") return;
    const left = clock.timeLeft(color);
    const online = opponent === "online";
    const limit = online && color !== humanColor ? -TIMEOUT_GRACE_MS : 0;
    if (left > limit) return;
    clock.run(null);
    clock.set(color, 0);
    if (online) doOnline({ type: "timeout", loser: color });
    else game.loseOnTime(color);
    refresh();
  }

  setInterval(() => {
    if (!clock.on) return;
    showClocks();
    checkTimeout();
  }, 200);

  // The player who just moved or passed stops their clock and gets the bonus seconds.
  function pressClock(color) {
    return clock.press(color);
  }

  // ---- Move list and replay ----

  function showMoveList() {
    if (viewCount !== null && viewCount >= game.moves.length) viewCount = null; // caught up with the game
    const shown = viewCount === null ? game.moves.length : viewCount;
    window.GoMoveList.render($("move-list"), game.moves, game.size, shown, review ? window.GoReview.moveLabels(review.data) : undefined);
    if (review) review.panel.show(shown);
    const viewing = viewCount !== null;
    $("btn-first").disabled = $("btn-prev").disabled = shown === 0;
    $("btn-next").disabled = $("btn-last").disabled = !viewing;
    $("view-note").textContent = viewing
      ? t("Looking at move {n} of {total}. Press » to go back to the game.", { n: viewCount, total: game.moves.length })
      : "";
  }

  function viewMove(count) {
    const total = game.moves.length;
    viewCount = count >= total ? null : Math.max(0, count);
    drawBoard();
    showMoveList();
  }

  const shownCount = () => (viewCount === null ? game.moves.length : viewCount);
  $("btn-first").addEventListener("click", () => viewMove(0));
  $("btn-prev").addEventListener("click", () => viewMove(shownCount() - 1));
  $("btn-next").addEventListener("click", () => viewMove(shownCount() + 1));
  $("btn-last").addEventListener("click", () => viewMove(game.moves.length));
  $("move-list").addEventListener("click", (event) => {
    const move = event.target.closest(".move");
    if (move) viewMove(Number(move.dataset.count));
  });
  // Arrow keys step through the game, unless you're typing (chat or the join code).
  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof Element && event.target.closest("input, textarea");
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") viewMove(shownCount() - 1);
    else if (event.key === "ArrowRight") viewMove(shownCount() + 1);
    else return;
    event.preventDefault();
  });

  function refresh() {
    playMoveSounds();
    dropStaleHint();
    clock.run(clockRunner());
    drawBoard();
    updatePanel();
    showMoveList();
    showClocks();
    startBotIfItsTurn();
    reportRatedResult();
    saveGameRecord();
    noteAchievements();
    reportLive();
    markBotDeadStones();
    if (window.GoVersion && opponent === "online" && game.phase === "over") window.GoVersion.recheck();
  }
  if (window.GoVersion) window.GoVersion.holdWhile(() => opponent === "online" && linkOpen && game.phase !== "over");

  // Against a bot, the bot decides which stones are dead (GoBot.deadStones), so nobody can win
  // by marking the bot's live stones dead. If you disagree, Keep playing and capture them.
  const botScoring = { key: null, busy: false };
  function markBotDeadStones() {
    if (opponent !== "bot" || game.phase !== "scoring") return;
    const key = positionKey();
    if (botScoring.key === key) return;
    botScoring.key = key;
    botScoring.busy = true;
    $("btn-finish").disabled = true;
    window.GoBot.deadStones(game).catch(() => []).then((dead) => {
      if (botScoring.key !== key) return; // the game moved on meanwhile
      botScoring.busy = false;
      $("btn-finish").disabled = false;
      if (game.phase !== "scoring") return;
      game.dead.clear();
      for (const i of dead) game.dead.add(i);
      updatePanel();
      drawBoard();
    });
  }

  // Online games go to the database so friends can watch (js/live-games.js).
  function reportLive() {
    const watchers = $("watchers");
    if (opponent !== "online" || !onlineMeta.gameKey || !window.GoLive) {
      watchers.hidden = true;
      return;
    }
    window.GoLive.report({
      key: onlineMeta.gameKey, size: game.size, myColor: humanColor === BLACK ? "black" : "white",
      blackName: cardName(BLACK), whiteName: cardName(WHITE),
      moves: game.moves.map((m) => (m.pass ? "pass" : [m.x, m.y])),
      result: game.phase === "over" && game.result ? window.GoHistory.resultCode(game.result) : null,
    });
  }
  if (window.GoLive) {
    window.GoLive.onWatchers((n) => {
      const watchers = $("watchers");
      watchers.hidden = !n || opponent !== "online";
      watchers.textContent = n === 1 ? t("👁 1 friend watching") : t("👁 {n} friends watching", { n });
    });
    setInterval(reportLive, window.GoLive.HEARTBEAT_MS); // keeps the game "live" and the count fresh
  }

  // The game so far, for the admin to replay (supabase/10-achievements.sql).
  function proofOfGame() {
    return {
      kind: opponent, level: opponent === "bot" ? botLevel : null, size: game.size,
      you: humanColor === BLACK ? "black" : "white",
      moves: game.moves.map((m) => (m.pass ? "pass" : [m.x, m.y])),
      dead: [...game.dead], result: game.result,
    };
  }

  // Undo, Hint or a custom position: tell logged-in players this bot game won't count.
  function markUnfair() {
    if (unfairGame === gameNumber) return;
    unfairGame = gameNumber;
    if (opponent === "bot" && window.GoAchievements && window.GoAchievements.loggedIn()) {
      $("achievement-note").textContent = t("Undo, Hint or a custom position was used: this game won't count for bot achievements.");
    }
  }

  function noteAchievements() {
    if (!window.GoAchievements || opponent === "friend") return;
    const fair = unfairGame !== gameNumber;
    const mine = game.captures[humanColor];
    const last = game.moves[game.moves.length - 1];
    if (capturesSeen.gameNumber === gameNumber && fair && last && last.color === humanColor && mine - capturesSeen.count >= 10) {
      window.GoAchievements.claim("big-capture", proofOfGame());
    }
    capturesSeen = { gameNumber, count: mine };
    if (game.phase !== "over" || achievementsGame === gameNumber) return;
    achievementsGame = gameNumber;
    const won = Boolean(game.result && game.result.winner === humanColor);
    window.GoAchievements.gameFinished(game.size, opponent === "online", won && (opponent === "online" || fair));
    if (opponent === "bot" && fair && game.result && game.result.winner === humanColor) {
      const botColor = otherColor(humanColor);
      const deadMine = [...game.dead].filter((i) => game.board[i] === humanColor).length;
      window.GoAchievements.botWin({ level: botLevel, size: game.size, lostStones: game.captures[botColor] + deadMine, proof: proofOfGame() });
    }
  }

  // ---- The computer's turn ----

  // The first time Dragon thinks on a visit, its network downloads (cached after that).
  function noteBrainDownload(level) {
    if (BOT_LEVELS[level - 1].neural && window.GoBot.brainLoading()) {
      messageEl.textContent = t("Dragon is waking up: loading its brain (about 15 MB, only the first time)…");
    }
  }

  let botFailures = 0; // thinking that failed in a row; after 2 the bot passes instead of freezing

  function startBotIfItsTurn() {
    if (!isBotTurn() || botThinking) return;
    botThinking = true;
    const token = ++botToken;
    updatePanel();
    noteBrainDownload(botLevel);

    Promise.resolve().then(() => chooseBotMove(game, botLevel, () => token !== botToken)).catch((error) => {
      console.warn("The bot couldn't think:", error);
      if (++botFailures <= 2) return { retry: true };
      return { pass: true };
    }).then((choice) => {
      if (token !== botToken) return;
      botThinking = false;
      if (choice.retry) {
        setTimeout(startBotIfItsTurn, 300);
        return;
      }
      botFailures = 0;
      const placed = !choice.pass && choice.moves.some(({ x, y }) => game.play(x, y).ok);
      if (messageEl.textContent === t("Dragon is waking up: loading its brain (about 15 MB, only the first time)…")) messageEl.textContent = "";
      if (!placed) {
        game.pass();
        messageEl.textContent = game.phase === "play" ? t("{name} passed.", { name: botShortName() }) : "";
      }
      refresh();
    });
  }

  function cancelBot() {
    botToken++;
    botThinking = false;
  }

  // ---- Online games ----

  function sendToFriend(message) {
    if (opponent === "online" && link) link.send(message);
  }

  function leaveOnlineGame() {
    if (link) link.close();
    link = null;
    linkOpen = false;
  }

  // Every change to an online game goes through here and is written down, so the
  // creator can re-send the whole game after a reconnect. Both browsers run the
  // same rules on the same actions, so the two boards stay identical.
  function applyOnlineAction(action) {
    let ok = true;
    switch (action.type) {
      case "move": ok = game.play(action.x, action.y).ok; break;
      case "pass": game.pass(); break;
      case "resume": game.resumePlay(); break;
      case "toggle-dead": game.toggleDead(action.x, action.y); break;
      case "finish": game.finishScoring(); break;
      case "resign": game.resign(action.loser); break;
      case "timeout": game.loseOnTime(action.loser); clock.set(action.loser, 0); break;
      default: ok = false;
    }
    if (ok) onlineActions.push(action);
    return ok;
  }

  // Your own action in an online game: do it here, then tell your friend.
  // Moves and passes carry your time left, so both screens show the same clocks.
  function doOnline(action) {
    if (!linkOpen) return false;
    const mover = game.turn;
    const ok = applyOnlineAction(action);
    if (ok && (action.type === "move" || action.type === "pass")) action.left = pressClock(mover);
    if (ok) sendToFriend(action);
    return ok;
  }

  // ---- Rated games (the database checks everything; see supabase/02-rated-games.sql) ----

  // Why a rated game became casual, worded for whoever is reading it.
  function casualNote(meta, iAmCreator) {
    const notLoggedIn = (creatorIsMissing) => (creatorIsMissing === iAmCreator
      ? t("You're not logged in, so this game is casual (not rated).")
      : t("{yourFriend} isn't logged in, so this game is casual (not rated).", { yourFriend: YourFriend() }));
    switch (meta.casualReason) {
      case "host-logged-out": return notLoggedIn(true);
      case "guest-logged-out": return notLoggedIn(false);
      case "same-account": return t("Both players use the same account, so this game is casual.");
      case "error": return t("This game is casual (not rated): {reason}", { reason: t(meta.errorText) });
      default: return "";
    }
  }

  function joinRatedGame(gameId, myColor) {
    window.GoRated.join(gameId, myColor).catch((error) => {
      if (onlineMeta.ratedGameId !== gameId) return;
      onlineMeta.ratedGameId = null;
      messageEl.textContent = t("This game couldn't be rated, so it's casual: {reason}", { reason: t(error.message) });
    });
  }

  // When a rated game ends, report the winner once and show how the rating moved.
  function reportRatedResult() {
    const gameId = onlineMeta.ratedGameId;
    if (!gameId || ratedReported || opponent !== "online" || game.phase !== "over") return;
    ratedReported = true;
    const myColorName = window.GoRated.colorName(humanColor);
    const reportNote = $("rated-note");
    reportNote.textContent = t("Saving the rated result…");
    window.GoRated.report(gameId, game.result.winner).then((row) => {
      if (onlineMeta.ratedGameId !== gameId) return;
      if (row.winner === "disputed") {
        reportNote.textContent = t("The two browsers reported different results, so this game didn't change ratings.");
      } else if (row.finished_at) {
        const before = row[`${myColorName}_rating_before`], change = row[`${myColorName}_change`];
        reportNote.textContent = t("Your rating: {before} → {after} ({change}).",
          { before, after: before + change, change: `${change >= 0 ? "+" : ""}${change}` });
        window.GoAccounts.refreshProfile();
      } else {
        reportNote.textContent = t("Result saved. Ratings update once {yourFriend}'s browser confirms it (or after 10 minutes).",
          { yourFriend: yourFriend() });
      }
    }).catch((error) => {
      reportNote.textContent = t("The rated result couldn't be saved: {reason}", { reason: t(error.message) });
    });
  }

  // Finished online games go into the logged-in player's history (js/game-history.js).
  function saveGameRecord() {
    if (recordSaved || opponent !== "online" || game.phase !== "over" || !onlineMeta.gameKey || !window.GoHistory) return;
    recordSaved = true;
    window.GoHistory.save({
      gameKey: onlineMeta.gameKey,
      myColor: humanColor,
      opponent: onlinePlayer(otherColor(humanColor)),
      size: game.size,
      moves: game.moves,
      result: game.result,
      ratedGameId: onlineMeta.ratedGameId,
      quick: onlineMeta.quick,
    });
  }

  // A rematch starts once both players asked. The creator's browser picks random
  // colors and tells the joiner (see HostSession.startRematch in online-lobby.js).
  function maybeStartRematch() {
    if (rematchMine && rematchFriend && link && link.isHost) link.startRematch();
  }

  // Your friend's actions arrive here.
  function receiveFromFriend(message) {
    if (message.type === "chat") return window.GoChat.receive(message.text);
    if (message.type === "rematch-offer") {
      if (game.phase !== "over") return;
      rematchFriend = true;
      if (!rematchMine) messageEl.textContent = t("{yourFriend} wants a rematch!", { yourFriend: YourFriend() });
      maybeStartRematch();
      return refresh();
    }
    const yourTurnOnly = message.type === "move" || message.type === "pass";
    if (yourTurnOnly && !isOpponentTurn()) return;
    if (message.type === "resign" && message.loser !== otherColor(humanColor)) return;
    if (!applyOnlineAction(message)) return;
    if (yourTurnOnly && typeof message.left === "number") {
      clock.run(null);
      clock.set(otherColor(humanColor), message.left);
    }

    if (message.type === "pass" && game.phase === "play") messageEl.textContent = t("{name} passed.", { name: YourFriend() });
    else if (message.type === "resume") messageEl.textContent = t("{yourFriend} wants to keep playing.", { yourFriend: YourFriend() });
    else if (message.type === "move") messageEl.textContent = "";
    refresh();
  }

  // ---- Dragon's Review (js/dragon-review.js) ----

  let review = null;     // { data, panel } once the finished game was reviewed
  let reviewing = false;
  let reviewToken = 0;   // bumped to cancel a review in progress

  function resetReview() {
    reviewToken++;
    review = null;
    reviewing = false;
    $("review-block").hidden = true;
    $("review-block").textContent = "";
  }

  async function startReview() {
    if (reviewing || review || game.phase !== "over") return;
    const token = ++reviewToken;
    reviewing = true;
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
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = t("Cancel");
    cancel.addEventListener("click", () => { resetReview(); refresh(); });
    box.append(heading, progress, cancel);
    refresh();
    try {
      const data = await window.GoReview.analyze({
        size: game.size,
        startBoard: game.boardAfter(0),
        moves: game.moves,
        onProgress: (done) => { progress.textContent = t("Dragon is reviewing the game… {n}%", { n: Math.round(done * 100) }); },
        isCancelled: () => token !== reviewToken,
      });
      if (token !== reviewToken || !data) return;
      reviewing = false;
      review = { data, panel: window.GoReview.renderPanel(box, data, (count) => viewMove(count)) };
      refresh();
    } catch (error) {
      if (token !== reviewToken) return;
      reviewing = false;
      box.textContent = t("Dragon's Review couldn't run in this browser.");
      refresh();
    }
  }

  $("btn-review").addEventListener("click", startReview);

  // ---- Starting games ----

  function beginGame(size, newOpponent, myColor, clockSettings) {
    resetReview();
    $("achievement-note").textContent = "";
    cancelBot();
    leaveOnlineGame();
    onlineActions = [];
    onlineMeta = {};
    ratedReported = false;
    $("rated-note").textContent = "";
    clock = new GameClock(clockSettings.minutes, clockSettings.bonus);
    viewCount = null;
    game = new GoGame(size);
    gameNumber++;
    opponent = newOpponent;
    humanColor = myColor;
    botLevel = setup.botLevel;
  }

  function pickedColor() {
    if (setup.color === "white") return WHITE;
    if (setup.color === "random") return Math.random() < 0.5 ? BLACK : WHITE;
    return BLACK;
  }

  const clockSetup = () => ({ minutes: setup.clockMinutes, bonus: setup.bonusSeconds });

  function startLocalGame() {
    beginGame(setup.size, setup.mode === "bot" ? "bot" : "friend", pickedColor(), clockSetup());
    messageEl.textContent = opponent === "bot" ? sentences(youAre(humanColor), t("Black moves first.")) : "";
    refresh();
  }

  const youAre = (color) => (color === BLACK ? t("You are Black.") : t("You are White."));

  // Phones show the menus below the board, so jump up to the board when a game starts.
  function showBoardOnPhone() {
    if (!window.matchMedia("(max-width: 1000px)").matches) return;
    document.querySelector(".board-column").scrollIntoView({ block: "start" });
  }

  // Nothing to lose yet: no move of yours (a bot may have opened), or the game is over.
  const gameUntouched = () => game.phase === "over"
    || (opponent === "friend" ? game.moves.length === 0 : !game.moves.some((m) => m.color === humanColor));

  // Play from a position made in the position editor (js/position-editor.js).
  function startFromPosition(board, turn) {
    beginGame(setup.size, setup.mode === "bot" ? "bot" : "friend", pickedColor(), clockSetup());
    game.setPosition(board, turn);
    markUnfair();
    const parts = [t("Playing from your position.")];
    if (opponent === "bot") parts.push(youAre(humanColor));
    parts.push(turn === BLACK ? t("Black moves first.") : t("White moves first."));
    messageEl.textContent = sentences(...parts);
    refresh();
    showBoardOnPhone();
  }

  function pickOne(container, button) {
    for (const b of container.querySelectorAll("button")) b.classList.toggle("selected", b === button);
  }

  function setMode(mode) {
    setup.mode = mode;
    $("bot-options").hidden = mode !== "bot";
    $("color-options").hidden = mode === "friend";
    $("online-options").hidden = mode !== "online";
    $("btn-new").hidden = mode === "online";
    $("btn-setup").hidden = mode === "online";
    pickOne($("mode-picker"), $("mode-picker").querySelector(`[data-mode="${mode}"]`));
    for (const item of $("nav").querySelectorAll("button")) item.classList.toggle("active", item.dataset.mode === mode);
  }

  // ---- Buttons and clicks ----

  $("bot-list").innerHTML = BOT_LEVELS.map((b) => `
    <button data-level="${b.level}" class="${b.level === setup.botLevel ? "selected" : ""}">
      <img class="bot-avatar" src="${botPicture(b)}" alt="">
      <span><span class="bot-name">${t(b.name)} <span class="bot-level-tag">${t("Level {n}", { n: b.level })}</span></span><span class="bot-blurb">${t(b.blurb)}</span></span>
    </button>`).join("");

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    const x = Number(spot.dataset.x), y = Number(spot.dataset.y);
    if (viewCount !== null) {
      messageEl.textContent = t("You're looking at an earlier move. Press » to go back to the game.");
      return;
    }

    const online = opponent === "online";
    if (game.phase === "scoring") {
      if (opponent === "bot") {
        messageEl.textContent = t("Against a bot, the bot decides which stones are dead. If you disagree, press Keep playing and capture them.");
        return;
      }
      if (online) doOnline({ type: "toggle-dead", x, y });
      else game.toggleDead(x, y);
    } else if (game.phase === "play" && !isOpponentTurn()) {
      const check = game.checkMove(x, y);
      messageEl.textContent = check.ok ? "" : ILLEGAL_MOVE_TEXT[check.reason] || "";
      if (check.ok && online) doOnline({ type: "move", x, y });
      else if (check.ok) {
        pressClock(game.turn);
        game.play(x, y);
      }
    }
    refresh();
  });

  $("nav").addEventListener("click", (event) => {
    const item = event.target.closest("button[data-mode]");
    if (item) setMode(item.dataset.mode);
  });

  $("mode-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) setMode(button.dataset.mode);
  });

  $("bot-list").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.botLevel = Number(button.dataset.level);
    pickOne(event.currentTarget, button);
  });

  $("color-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.color = button.dataset.color;
    pickOne(event.currentTarget, button);
  });

  $("size-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.size = Number(button.dataset.size);
    pickOne(event.currentTarget, button);
    // The board changes right away, unless that would throw away a game in progress.
    if (opponent === "online" || (window.GoEditor && window.GoEditor.isOpen())) return;
    if (gameUntouched()) startLocalGame();
    else messageEl.textContent = t("The {n}×{n} board starts with your next game.", { n: setup.size });
  });

  $("clock-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.clockMinutes = Number(button.dataset.minutes);
    pickOne(event.currentTarget, button);
    $("bonus-options").hidden = setup.clockMinutes === 0;
  });

  $("bonus-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.bonusSeconds = Number(button.dataset.bonus);
    pickOne(event.currentTarget, button);
  });

  $("rated-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    setup.rated = button.dataset.rated === "yes";
    pickOne(event.currentTarget, button);
    updateRatedHint();
  });

  // Rated games need both players logged in; say so next to the choice.
  function updateRatedHint() {
    const accounts = window.GoAccounts;
    const loggedIn = accounts && accounts.ready && accounts.current().profile;
    $("rated-picker").hidden = !(accounts && accounts.ready);
    $("rated-hint").textContent = !setup.rated ? ""
      : loggedIn ? t("Your friend must be logged in too, or the game will be casual.")
      : t("Log in (top right) to play rated games.");
  }

  let staleChecked = false;
  if (window.GoAccounts) {
    window.GoAccounts.onChange(({ profile }) => {
      updateRatedHint();
      // Finish rated games where your friend never confirmed the result (after 10 minutes).
      if (profile && !staleChecked && window.GoRated) {
        staleChecked = true;
        window.GoRated.finalizeStale();
      }
    });
  }
  updateRatedHint();

  $("btn-new").addEventListener("click", () => {
    startLocalGame();
    showBoardOnPhone();
  });

  hintButton.addEventListener("click", () => {
    if (hintThinking || game.phase !== "play" || isOpponentTurn() || opponent === "online") return;
    markUnfair(); // a hint is Dragon helping you, so no bot achievements this game
    hint = null;
    hintThinking = true;
    hintKey = positionKey();
    const token = ++hintToken;
    const stillWanted = () => token === hintToken;
    updatePanel();
    noteBrainDownload(HINT_LEVEL);

    chooseBotMove(game, HINT_LEVEL, () => !stillWanted()).then((choice) => {
      if (!stillWanted()) return;
      hintThinking = false;
      const move = choice.pass ? null : choice.moves.find(({ x, y }) => game.checkMove(x, y).ok);
      hint = move || { pass: true };
      messageEl.textContent = move
        ? t("Hint: try the green spot.")
        : t("Hint: nothing useful left to play. Passing is a good idea.");
      refresh();
    });
  });

  passButton.addEventListener("click", () => {
    const who = isYou(game.turn) ? null : playerName(game.turn);
    if (opponent === "online") doOnline({ type: "pass" });
    else {
      pressClock(game.turn);
      game.pass();
    }
    messageEl.textContent = game.phase !== "play" ? "" : who ? t("{name} passed.", { name: who }) : t("You passed.");
    refresh();
  });

  // Against the bot, undo takes back the bot's reply too, so it's your move again.
  undoButton.addEventListener("click", () => {
    markUnfair();
    game.undo();
    while (opponent === "bot" && game.turn !== humanColor && game.canUndo()) game.undo();
    messageEl.textContent = "";
    refresh();
  });

  // Resign asks "are you sure" right where the button is: it turns into "Yes, resign" and "No",
  // and turns back by itself after a few seconds.
  const RESIGN_ASK_MS = 6000;
  let resignAskTimer = null;
  function showResignAsk(on) {
    clearTimeout(resignAskTimer);
    resignButton.hidden = on;
    $("resign-ask").hidden = !on;
    if (on) resignAskTimer = setTimeout(() => showResignAsk(false), RESIGN_ASK_MS);
  }
  resignButton.addEventListener("click", () => {
    $("btn-resign-yes").textContent = opponent === "friend"
      ? t("{color}: yes, resign", { color: COLOR_NAME[game.turn] }) : t("Yes, resign");
    showResignAsk(true);
  });
  $("btn-resign-no").addEventListener("click", () => showResignAsk(false));
  $("btn-resign-yes").addEventListener("click", () => {
    showResignAsk(false);
    if (resignButton.disabled) return; // the game changed meanwhile (it ended, or it's not your turn to act)
    if (opponent === "online") doOnline({ type: "resign", loser: humanColor });
    else if (opponent === "bot") game.resign(humanColor);
    else game.resign();
    refresh();
  });

  $("btn-rematch").addEventListener("click", () => {
    if (opponent !== "online" || game.phase !== "over" || !linkOpen || rematchMine) return;
    rematchMine = true;
    sendToFriend({ type: "rematch-offer" });
    messageEl.textContent = rematchFriend ? "" : t("Rematch offered. Waiting for {yourFriend} to accept.", { yourFriend: yourFriend() });
    maybeStartRematch();
    refresh();
  });

  $("btn-finish").addEventListener("click", () => {
    if (opponent === "bot" && botScoring.busy) return; // wait for the bot to mark dead stones
    if (opponent === "online") doOnline({ type: "finish" });
    else game.finishScoring();
    refresh();
  });

  $("btn-resume").addEventListener("click", () => {
    if (opponent === "online") doOnline({ type: "resume" });
    else game.resumePlay();
    messageEl.textContent = t("Back to playing.");
    refresh();
  });

  // What online-lobby.js needs from this page.
  window.GoPage = {
    getSetup: () => ({ mode: setup.mode, size: setup.size, color: pickedColor(), clock: clockSetup(), rated: setup.rated }),
    setMode,
    startFromPosition,
    redraw: () => refresh(),
    friendWord,
    YourFriend,
    yourFriend,
    guestName,
    // kind: "new" (first connection), "reconnect" (rebuild from the creator's list) or "rematch".
    // clockSettings come from the creator; times (after a reconnect) are both players' time left.
    // meta: names, ratings and the rated game id (see HostSession.prepareMeta).
    startOnlineGame(size, myColor, actions, session, kind, clockSettings, times, meta) {
      const settings = clockSettings || { minutes: 0, bonus: 0 };
      if (kind === "new") {
        beginGame(size, "online", myColor, settings);
        window.GoChat.clear();
      } else {
        cancelBot();
        onlineActions = [];
        clock = new GameClock(settings.minutes, settings.bonus);
        if (kind === "rematch") viewCount = null;
        if (kind === "rematch") resetReview();
        game = new GoGame(size);
        gameNumber++;
        humanColor = myColor;
      }
      link = session;
      linkOpen = true;
      rematchMine = rematchFriend = false;
      const sameRatedGame = kind === "reconnect" && meta && meta.ratedGameId === onlineMeta.ratedGameId;
      if (!(kind === "reconnect" && meta && meta.gameKey === onlineMeta.gameKey)) recordSaved = false;
      onlineMeta = meta || {};
      if (!sameRatedGame) {
        ratedReported = false;
        $("rated-note").textContent = "";
      }
      for (const action of actions) applyOnlineAction(action);
      if (times) for (const color of [BLACK, WHITE]) clock.set(color, times[color]);
      const colorNote = sentences(youAre(myColor), t("Black moves first."));
      const typeNote = onlineMeta.ratedGameId ? t("Rated game!") : casualNote(onlineMeta, session.isHost);
      messageEl.textContent = kind === "reconnect" ? t("Reconnected!")
        : sentences(kind === "rematch" ? t("Rematch!") : t("Connected!"), typeNote, colorNote);
      // The joiner confirms the rated game in the database (the creator already created it).
      if (onlineMeta.ratedGameId && !session.isHost && kind !== "reconnect") joinRatedGame(onlineMeta.ratedGameId, myColor);
      refresh();
      if (kind !== "reconnect") showBoardOnPhone();
    },
    onlineActions: () => onlineActions.slice(),
    clockTimes: () => clock.snapshot(),
    sendChat(text) {
      if (opponent !== "online" || !linkOpen) return false;
      sendToFriend({ type: "chat", text });
      return true;
    },
    receiveFromFriend,
    setConnection(open, note) {
      if (opponent !== "online") return;
      linkOpen = open;
      messageEl.textContent = note;
      refresh();
    },
    leaveOnlineGame,
  };

  // Changing the language reloads the page, which would end an online game.
  window.GoI18n.beforeChange(() => !(opponent === "online" && linkOpen && game.phase !== "over")
    || confirm(t("Changing the language reloads the page and ends your online game. Continue?")));

  // Links from the Puzzles page open a mode directly, e.g. index.html?mode=bot.
  const startMode = new URLSearchParams(window.location.search).get("mode");
  if (["friend", "bot", "online"].includes(startMode)) setMode(startMode);

  refresh();
})();
