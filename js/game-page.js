// Draws the board and wires up the buttons. All rule decisions live in go-rules.js,
// and the computer's moves come from go-bot.js.
(function () {
  const { GoGame, EMPTY, BLACK, WHITE } = window.Go;
  const { BOT_LEVELS, chooseBotMove } = window.GoBot;

  const COLOR_NAME = { [BLACK]: "Black", [WHITE]: "White" };
  const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go boards skip the letter I
  const STAR_POINTS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
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
  const setup = { mode: "friend", size: 19, botLevel: 1, color: "black" };

  // The game being played right now.
  let game = new GoGame(setup.size);
  let vsBot = false;
  let humanColor = BLACK;
  let botLevel = 1;
  let botThinking = false;
  let botToken = 0; // bumped to cancel a bot that is still thinking

  // Hints come from the strongest bot and are only valid for the position they were asked in.
  const HINT_LEVEL = 5;
  let hint = null;        // { x, y } or { pass: true }
  let hintThinking = false;
  let hintKey = "";
  let hintToken = 0;
  let gameNumber = 0;
  const positionKey = () => `${gameNumber}|${game.board.join("")}|${game.turn}|${game.phase}`;

  const botName = () => `${BOT_LEVELS[botLevel - 1].name} (Level ${botLevel})`;
  const playerName = (color) => (!vsBot ? COLOR_NAME[color] : color === humanColor ? "You" : botName());
  const isBotTurn = () => vsBot && game.phase === "play" && game.turn !== humanColor;

  // ---- Board drawing ----

  function stoneSvg(x, y, color, extraAttrs = "") {
    const fill = color === BLACK ? "url(#stone-black)" : "url(#stone-white)";
    return `<circle cx="${x + 1}" cy="${y + 1}" r="0.47" fill="${fill}" ${extraAttrs}/>`;
  }

  function drawBoard() {
    const s = game.size, end = s, parts = [];
    const scoring = game.phase === "scoring" || (game.phase === "over" && game.result && !game.result.byResignation);
    const territory = scoring ? game.score().territory : null;

    parts.push(`<svg viewBox="0 0 ${s + 1} ${s + 1}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="stone-black" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#5a5a5a"/><stop offset="1" stop-color="#050505"/>
        </radialGradient>
        <radialGradient id="stone-white" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c8c8c8"/>
        </radialGradient>
      </defs>
      <rect width="${s + 1}" height="${s + 1}" fill="var(--wood)"/>`);

    for (let k = 1; k <= s; k++) {
      parts.push(`<line x1="1" y1="${k}" x2="${end}" y2="${k}" stroke="var(--line)" stroke-width="0.04"/>`);
      parts.push(`<line x1="${k}" y1="1" x2="${k}" y2="${end}" stroke="var(--line)" stroke-width="0.04"/>`);
    }
    for (const sx of STAR_POINTS[s]) for (const sy of STAR_POINTS[s]) {
      parts.push(`<circle cx="${sx + 1}" cy="${sy + 1}" r="0.1" fill="var(--line)"/>`);
    }

    const label = (x, y, text) =>
      `<text x="${x}" y="${y}" font-size="0.33" fill="var(--line)" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${text}</text>`;
    for (let k = 0; k < s; k++) {
      parts.push(label(k + 1, 0.4, COLUMN_LETTERS[k]), label(k + 1, s + 0.6, COLUMN_LETTERS[k]));
      parts.push(label(0.4, k + 1, s - k), label(s + 0.6, k + 1, s - k));
    }

    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = game.index(x, y), color = game.board[i];
      if (color !== EMPTY) {
        parts.push(stoneSvg(x, y, color, game.dead.has(i) ? 'opacity="0.35"' : ""));
      }
      if (territory && territory[i] !== EMPTY && (color === EMPTY || game.dead.has(i))) {
        const fill = territory[i] === BLACK ? "#000" : "#fff";
        parts.push(`<rect x="${x + 0.8}" y="${y + 0.8}" width="0.4" height="0.4" fill="${fill}" stroke="#555" stroke-width="0.02"/>`);
      }
    }

    if (typeof game.lastMove === "number" && game.phase === "play") {
      const lx = game.lastMove % s, ly = Math.floor(game.lastMove / s);
      const ring = game.board[game.lastMove] === BLACK ? "#fff" : "#000";
      parts.push(`<circle cx="${lx + 1}" cy="${ly + 1}" r="0.22" fill="none" stroke="${ring}" stroke-width="0.06"/>`);
    }

    if (hint && !hint.pass) {
      parts.push(`<circle cx="${hint.x + 1}" cy="${hint.y + 1}" r="0.42" fill="rgba(129,182,76,0.45)" stroke="#5d8a32" stroke-width="0.07"/>`);
    }

    // Invisible click targets, one per point, with a see-through "ghost" stone on hover.
    const ghostsOn = game.phase === "play" && !isBotTurn();
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const showGhost = ghostsOn && game.board[game.index(x, y)] === EMPTY;
      parts.push(`<g class="spot" data-x="${x}" data-y="${y}">
        <rect x="${x + 0.5}" y="${y + 0.5}" width="1" height="1" fill="transparent"/>
        ${showGhost ? stoneSvg(x, y, game.turn, 'class="ghost"') : ""}
      </g>`);
    }

    parts.push("</svg>");
    boardEl.innerHTML = parts.join("");
  }

  // ---- Side panel ----

  function updatePanel() {
    $("name-black").textContent = playerName(BLACK);
    $("name-white").textContent = playerName(WHITE);
    $("info-black").textContent = `Captured: ${game.captures[BLACK]}`;
    $("info-white").textContent = `Captured: ${game.captures[WHITE]} · Komi 7.5`;

    const bottomColor = vsBot ? humanColor : BLACK;
    for (const color of [BLACK, WHITE]) {
      const card = $(color === BLACK ? "card-black" : "card-white");
      card.classList.toggle("to-move", game.phase === "play" && game.turn === color);
      card.classList.toggle("bottom-seat", color === bottomColor);
      card.classList.toggle("top-seat", color !== bottomColor);
    }

    $("play-buttons").hidden = game.phase === "scoring";
    $("scoring-buttons").hidden = game.phase !== "scoring";
    undoButton.disabled = botThinking || !game.canUndo();
    passButton.disabled = resignButton.disabled = game.phase !== "play" || isBotTurn();
    hintButton.disabled = game.phase !== "play" || isBotTurn() || hintThinking;

    statusEl.classList.toggle("thinking", botThinking || hintThinking);
    if (game.phase === "play") {
      statusEl.textContent = botThinking ? `${BOT_LEVELS[botLevel - 1].name} is thinking`
        : hintThinking ? "Looking for a good move"
        : vsBot ? "Your move" : `${COLOR_NAME[game.turn]} to play`;
    } else if (game.phase === "scoring") {
      const s = game.score();
      statusEl.textContent = `Scoring — Black ${s.black}, White ${s.white}`;
      messageEl.textContent = "Both passed. Click any dead groups to remove them, then press Count score.";
    } else {
      const r = game.result, winner = playerName(r.winner);
      const verb = winner === "You" ? "win" : "wins";
      statusEl.textContent = r.byResignation
        ? `${winner} ${verb} by resignation`
        : `${winner} ${verb} by ${r.margin} points`;
      messageEl.textContent = r.byResignation ? "" : `Final score: Black ${r.black}, White ${r.white}.`;
    }
  }

  function dropStaleHint() {
    if ((hint || hintThinking) && hintKey !== positionKey()) {
      hint = null;
      hintThinking = false;
      hintToken++;
    }
  }

  function refresh() {
    dropStaleHint();
    drawBoard();
    updatePanel();
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

  // ---- Buttons and clicks ----

  function startNewGame() {
    cancelBot();
    game = new GoGame(setup.size);
    gameNumber++;
    vsBot = setup.mode === "bot";
    botLevel = setup.botLevel;
    humanColor = setup.color === "white" ? WHITE
      : setup.color === "random" ? (Math.random() < 0.5 ? BLACK : WHITE)
      : BLACK;
    messageEl.textContent = vsBot ? `You are ${COLOR_NAME[humanColor]}. Black moves first.` : "";
    refresh();
  }

  function pickOne(container, button) {
    for (const b of container.querySelectorAll("button")) b.classList.toggle("selected", b === button);
  }

  function setMode(mode) {
    setup.mode = mode;
    $("bot-options").hidden = mode !== "bot";
    pickOne($("mode-picker"), $("mode-picker").querySelector(`[data-mode="${mode}"]`));
    for (const item of $("nav").querySelectorAll("button")) item.classList.toggle("active", item.dataset.mode === mode);
  }

  $("bot-list").innerHTML = BOT_LEVELS.map((b) => `
    <button data-level="${b.level}" class="${b.level === setup.botLevel ? "selected" : ""}">
      <span class="bot-level">${b.level}</span>
      <span><span class="bot-name">${b.name}</span><span class="bot-blurb">${b.blurb}</span></span>
    </button>`).join("");

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    const x = Number(spot.dataset.x), y = Number(spot.dataset.y);

    if (game.phase === "scoring") {
      game.toggleDead(x, y);
    } else if (game.phase === "play" && !isBotTurn()) {
      const result = game.play(x, y);
      messageEl.textContent = result.ok ? "" : ILLEGAL_MOVE_TEXT[result.reason] || "";
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

  $("btn-new").addEventListener("click", startNewGame);

  hintButton.addEventListener("click", () => {
    if (hintThinking || game.phase !== "play" || isBotTurn()) return;
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
    game.pass();
    messageEl.textContent = game.phase === "play" ? `${who} passed.` : "";
    refresh();
  });

  // Against the bot, undo takes back the bot's reply too, so it's your move again.
  undoButton.addEventListener("click", () => {
    game.undo();
    while (vsBot && game.turn !== humanColor && game.canUndo()) game.undo();
    messageEl.textContent = "";
    refresh();
  });

  resignButton.addEventListener("click", () => {
    const question = vsBot ? "Are you sure you want to resign?" : `${COLOR_NAME[game.turn]}: are you sure you want to resign?`;
    if (confirm(question)) {
      game.resign();
      refresh();
    }
  });

  $("btn-finish").addEventListener("click", () => {
    game.finishScoring();
    refresh();
  });

  $("btn-resume").addEventListener("click", () => {
    game.resumePlay();
    messageEl.textContent = "Back to playing.";
    refresh();
  });

  refresh();
})();
