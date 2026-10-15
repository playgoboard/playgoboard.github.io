// Draws the board and wires up the buttons. All rule decisions live in go-rules.js,
// the computer's moves come from go-bot.js, and online-lobby.js connects online games
// through the small window.GoPage interface at the bottom.
(function () {
  const { GoGame, BLACK, WHITE, otherColor } = window.Go;
  const { BOT_LEVELS, chooseBotMove } = window.GoBot;
  const { GameClock, formatTime } = window.GoClock;
  const LOW_TIME_MS = 20000;      // the clock turns red below this
  const TIMEOUT_GRACE_MS = 2000;  // online: wait a moment before calling your friend's time, in case their move is on its way

  const COLOR_NAME = { [BLACK]: "Black", [WHITE]: "White" };
  const ILLEGAL_MOVE_TEXT = {
    occupied: "There's already a stone there.",
    suicide: "You can't play where your stones would have no liberties.",
    ko: "Ko rule: you can't retake right away. Play somewhere else first.",
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
  const setup = { mode: "friend", size: 19, botLevel: 1, color: "black", clockMinutes: 0, bonusSeconds: 0 };

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

  // Hints come from the strongest bot and are only valid for the position they were asked in.
  const HINT_LEVEL = 5;
  let hint = null;         // { x, y } or { pass: true }
  let hintThinking = false;
  let hintKey = "";
  let hintToken = 0;
  const positionKey = () => `${gameNumber}|${game.board.join("")}|${game.turn}|${game.phase}`;

  const botName = () => `${BOT_LEVELS[botLevel - 1].name} (Level ${botLevel})`;
  const isOpponentTurn = () => opponent !== "friend" && game.phase === "play" && game.turn !== humanColor;
  const isBotTurn = () => opponent === "bot" && isOpponentTurn();

  function playerName(color) {
    if (opponent === "friend") return COLOR_NAME[color];
    if (color === humanColor) return "You";
    return opponent === "bot" ? botName() : "Friend";
  }

  // Resignation and running out of time end the game without counting.
  const endedByScore = () => game.phase === "over" && game.result && game.result.margin !== undefined;

  function resultText(r) {
    const winner = playerName(r.winner), verb = winner === "You" ? "win" : "wins";
    if (r.byResignation) return `${winner} ${verb} by resignation`;
    if (r.byTimeout) return `${winner} ${verb} on time`;
    return `${winner} ${verb} by ${r.margin} points`;
  }

  // ---- Board drawing ----

  function drawBoard() {
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
      hint: hint && !hint.pass && !viewing ? hint : null,
      ghostColor: ghostsOn ? game.turn : null,
    });
  }

  // ---- Side panel ----

  function statusText() {
    if (game.phase === "scoring") {
      const s = game.score();
      return `Scoring — Black ${s.black}, White ${s.white}`;
    }
    if (game.phase === "over") return resultText(game.result);
    if (botThinking) return `${BOT_LEVELS[botLevel - 1].name} is thinking`;
    if (hintThinking) return "Looking for a good move";
    if (opponent === "online" && !linkOpen) return "Connection lost";
    if (opponent === "online") return isOpponentTurn() ? "Friend's move" : "Your move";
    if (opponent === "bot") return "Your move";
    return `${COLOR_NAME[game.turn]} to play`;
  }

  function updatePanel() {
    const online = opponent === "online";
    $("name-black").textContent = playerName(BLACK);
    $("name-white").textContent = playerName(WHITE);
    $("info-black").textContent = `Captured: ${game.captures[BLACK]}`;
    $("info-white").textContent = `Captured: ${game.captures[WHITE]} · Komi 7.5`;

    const bottomColor = opponent === "friend" ? BLACK : humanColor;
    for (const color of [BLACK, WHITE]) {
      const card = $(color === BLACK ? "card-black" : "card-white");
      card.classList.toggle("to-move", game.phase === "play" && game.turn === color);
      card.classList.toggle("bottom-seat", color === bottomColor);
      card.classList.toggle("top-seat", color !== bottomColor);
    }

    window.GoChat.show(online);
    const rematchButton = $("btn-rematch");
    $("rematch-row").hidden = !(online && game.phase === "over");
    rematchButton.disabled = !linkOpen || rematchMine;
    rematchButton.textContent = rematchMine ? "Waiting for your friend…" : rematchFriend ? "Accept rematch" : "Rematch";
    $("play-buttons").hidden = game.phase === "scoring";
    $("scoring-buttons").hidden = game.phase !== "scoring";
    // No takebacks or hints against an online friend: that would be cheating.
    undoButton.disabled = online || botThinking || !game.canUndo();
    hintButton.disabled = online || game.phase !== "play" || isOpponentTurn() || hintThinking;
    passButton.disabled = game.phase !== "play" || isOpponentTurn() || (online && !linkOpen);
    resignButton.disabled = game.phase !== "play" || isBotTurn() || (online && !linkOpen);
    $("btn-finish").disabled = $("btn-resume").disabled = online && !linkOpen;
    undoButton.title = online ? "Undo is off in online games" : "";

    statusEl.classList.toggle("thinking", botThinking || hintThinking);
    statusEl.textContent = statusText();
    if (game.phase === "scoring") {
      messageEl.textContent = online
        ? "Both passed. Either of you can click dead groups (you both see it), then press Count score."
        : "Both passed. Click any dead groups to remove them, then press Count score.";
    } else if (endedByScore()) {
      messageEl.textContent = `Final score: Black ${game.result.black}, White ${game.result.white}.`;
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
    button.title = muted ? "Sound is off. Click to turn it on." : "Sound is on. Click to turn it off.";
    button.classList.toggle("off", muted);
  }

  if (soundButton) soundButton.addEventListener("click", () => {
    window.GoSounds.setMuted(!window.GoSounds.isMuted());
    updateSoundButton();
    if (!window.GoSounds.isMuted()) window.GoSounds.stone(); // a sample so you hear it's on
  });
  updateSoundButton();

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
    window.GoMoveList.render($("move-list"), game.moves, game.size, shown);
    const viewing = viewCount !== null;
    $("btn-first").disabled = $("btn-prev").disabled = shown === 0;
    $("btn-next").disabled = $("btn-last").disabled = !viewing;
    $("view-note").textContent = viewing
      ? `Looking at move ${viewCount} of ${game.moves.length}. Press » to go back to the game.`
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
  }

  // ---- The computer's turn ----

  function startBotIfItsTurn() {
    if (!isBotTurn() || botThinking) return;
    botThinking = true;
    const token = ++botToken;
    updatePanel();

    chooseBotMove(game, botLevel, () => token !== botToken).then((choice) => {
      if (token !== botToken) return;
      botThinking = false;
      const placed = !choice.pass && choice.moves.some(({ x, y }) => game.play(x, y).ok);
      if (!placed) {
        game.pass();
        messageEl.textContent = game.phase === "play" ? `${BOT_LEVELS[botLevel - 1].name} passed.` : "";
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
      if (!rematchMine) messageEl.textContent = "Your friend wants a rematch!";
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

    if (message.type === "pass" && game.phase === "play") messageEl.textContent = "Your friend passed.";
    else if (message.type === "resume") messageEl.textContent = "Your friend wants to keep playing.";
    else if (message.type === "move") messageEl.textContent = "";
    refresh();
  }

  // ---- Starting games ----

  function beginGame(size, newOpponent, myColor, clockSettings) {
    cancelBot();
    leaveOnlineGame();
    onlineActions = [];
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
    messageEl.textContent = opponent === "bot" ? `You are ${COLOR_NAME[humanColor]}. Black moves first.` : "";
    refresh();
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
    pickOne($("mode-picker"), $("mode-picker").querySelector(`[data-mode="${mode}"]`));
    for (const item of $("nav").querySelectorAll("button")) item.classList.toggle("active", item.dataset.mode === mode);
  }

  // ---- Buttons and clicks ----

  $("bot-list").innerHTML = BOT_LEVELS.map((b) => `
    <button data-level="${b.level}" class="${b.level === setup.botLevel ? "selected" : ""}">
      <span class="bot-level">${b.level}</span>
      <span><span class="bot-name">${b.name}</span><span class="bot-blurb">${b.blurb}</span></span>
    </button>`).join("");

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    const x = Number(spot.dataset.x), y = Number(spot.dataset.y);
    if (viewCount !== null) {
      messageEl.textContent = "You're looking at an earlier move. Press » to go back to the game.";
      return;
    }

    const online = opponent === "online";
    if (game.phase === "scoring") {
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

  $("btn-new").addEventListener("click", startLocalGame);

  hintButton.addEventListener("click", () => {
    if (hintThinking || game.phase !== "play" || isOpponentTurn() || opponent === "online") return;
    hint = null;
    hintThinking = true;
    hintKey = positionKey();
    const token = ++hintToken;
    const stillWanted = () => token === hintToken;
    updatePanel();

    chooseBotMove(game, HINT_LEVEL, () => !stillWanted()).then((choice) => {
      if (!stillWanted()) return;
      hintThinking = false;
      const move = choice.pass ? null : choice.moves.find(({ x, y }) => game.checkMove(x, y).ok);
      hint = move || { pass: true };
      messageEl.textContent = move
        ? "Hint: try the green spot."
        : "Hint: nothing useful left to play. Passing is a good idea.";
      refresh();
    });
  });

  passButton.addEventListener("click", () => {
    const who = playerName(game.turn);
    if (opponent === "online") doOnline({ type: "pass" });
    else {
      pressClock(game.turn);
      game.pass();
    }
    messageEl.textContent = game.phase === "play" ? `${who} passed.` : "";
    refresh();
  });

  // Against the bot, undo takes back the bot's reply too, so it's your move again.
  undoButton.addEventListener("click", () => {
    game.undo();
    while (opponent === "bot" && game.turn !== humanColor && game.canUndo()) game.undo();
    messageEl.textContent = "";
    refresh();
  });

  resignButton.addEventListener("click", () => {
    const question = opponent === "friend"
      ? `${COLOR_NAME[game.turn]}: are you sure you want to resign?`
      : "Are you sure you want to resign?";
    if (!confirm(question)) return;
    if (opponent === "online") doOnline({ type: "resign", loser: humanColor });
    else if (opponent === "bot") game.resign(humanColor);
    else game.resign();
    refresh();
  });

  $("btn-rematch").addEventListener("click", () => {
    if (opponent !== "online" || game.phase !== "over" || !linkOpen || rematchMine) return;
    rematchMine = true;
    sendToFriend({ type: "rematch-offer" });
    messageEl.textContent = rematchFriend ? "" : "Rematch offered. Waiting for your friend to accept.";
    maybeStartRematch();
    refresh();
  });

  $("btn-finish").addEventListener("click", () => {
    if (opponent === "online") doOnline({ type: "finish" });
    else game.finishScoring();
    refresh();
  });

  $("btn-resume").addEventListener("click", () => {
    if (opponent === "online") doOnline({ type: "resume" });
    else game.resumePlay();
    messageEl.textContent = "Back to playing.";
    refresh();
  });

  // What online-lobby.js needs from this page.
  window.GoPage = {
    getSetup: () => ({ size: setup.size, color: pickedColor(), clock: clockSetup() }),
    setMode,
    // kind: "new" (first connection), "reconnect" (rebuild from the creator's list) or "rematch".
    // clockSettings come from the creator; times (after a reconnect) are both players' time left.
    startOnlineGame(size, myColor, actions, session, kind, clockSettings, times) {
      const settings = clockSettings || { minutes: 0, bonus: 0 };
      if (kind === "new") {
        beginGame(size, "online", myColor, settings);
        window.GoChat.clear();
      } else {
        cancelBot();
        onlineActions = [];
        clock = new GameClock(settings.minutes, settings.bonus);
        if (kind === "rematch") viewCount = null;
        game = new GoGame(size);
        gameNumber++;
        humanColor = myColor;
      }
      link = session;
      linkOpen = true;
      rematchMine = rematchFriend = false;
      for (const action of actions) applyOnlineAction(action);
      if (times) for (const color of [BLACK, WHITE]) clock.set(color, times[color]);
      const colorNote = `You are ${COLOR_NAME[myColor]}. Black moves first.`;
      messageEl.textContent = kind === "reconnect" ? "Reconnected!"
        : kind === "rematch" ? `Rematch! ${colorNote}` : `Connected! ${colorNote}`;
      refresh();
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

  // Links from the Puzzles page open a mode directly, e.g. index.html?mode=bot.
  const startMode = new URLSearchParams(window.location.search).get("mode");
  if (["friend", "bot", "online"].includes(startMode)) setMode(startMode);

  refresh();
})();
