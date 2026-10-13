// Draws the board and wires up the buttons. All rule decisions live in go-rules.js.
(function () {
  const { GoGame, EMPTY, BLACK, WHITE } = window.Go;

  const COLOR_NAME = { [BLACK]: "Black", [WHITE]: "White" };
  const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go boards skip the letter I
  const STAR_POINTS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
  const ILLEGAL_MOVE_TEXT = {
    occupied: "There's already a stone there.",
    suicide: "You can't play where your stones would have no liberties.",
    ko: "Ko rule: you can't retake right away. Play somewhere else first.",
  };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const messageEl = document.getElementById("message");
  const playButtons = document.getElementById("play-buttons");
  const scoringButtons = document.getElementById("scoring-buttons");
  const undoButton = document.getElementById("btn-undo");
  const passButton = document.getElementById("btn-pass");
  const resignButton = document.getElementById("btn-resign");

  let chosenSize = 19;
  let game = new GoGame(chosenSize);

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

    // Invisible click targets, one per point, with a see-through "ghost" stone on hover.
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const showGhost = game.phase === "play" && game.board[game.index(x, y)] === EMPTY;
      parts.push(`<g class="spot" data-x="${x}" data-y="${y}">
        <rect x="${x + 0.5}" y="${y + 0.5}" width="1" height="1" fill="transparent"/>
        ${showGhost ? stoneSvg(x, y, game.turn, 'class="ghost"') : ""}
      </g>`);
    }

    parts.push("</svg>");
    boardEl.innerHTML = parts.join("");
  }

  function updatePanel() {
    document.getElementById("info-black").textContent = `Captured: ${game.captures[BLACK]}`;
    document.getElementById("info-white").textContent = `Captured: ${game.captures[WHITE]} · Komi 7.5`;
    document.getElementById("card-black").classList.toggle("to-move", game.phase === "play" && game.turn === BLACK);
    document.getElementById("card-white").classList.toggle("to-move", game.phase === "play" && game.turn === WHITE);

    playButtons.hidden = game.phase === "scoring";
    scoringButtons.hidden = game.phase !== "scoring";
    undoButton.disabled = !game.canUndo();
    passButton.disabled = resignButton.disabled = game.phase !== "play";

    if (game.phase === "play") {
      statusEl.textContent = `${COLOR_NAME[game.turn]} to play`;
    } else if (game.phase === "scoring") {
      const s = game.score();
      statusEl.textContent = `Scoring — Black ${s.black}, White ${s.white}`;
      messageEl.textContent = "Both passed. Click any dead groups to remove them, then press Count score.";
    } else {
      const r = game.result;
      statusEl.textContent = r.byResignation
        ? `${COLOR_NAME[r.winner]} wins by resignation`
        : `${COLOR_NAME[r.winner]} wins by ${r.margin} points`;
      messageEl.textContent = r.byResignation ? "" : `Final score: Black ${r.black}, White ${r.white}.`;
    }
  }

  function refresh() {
    drawBoard();
    updatePanel();
  }

  function startNewGame() {
    game = new GoGame(chosenSize);
    messageEl.textContent = "";
    refresh();
  }

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    const x = Number(spot.dataset.x), y = Number(spot.dataset.y);

    if (game.phase === "scoring") {
      game.toggleDead(x, y);
    } else if (game.phase === "play") {
      const result = game.play(x, y);
      messageEl.textContent = result.ok ? "" : ILLEGAL_MOVE_TEXT[result.reason] || "";
    }
    refresh();
  });

  document.getElementById("size-picker").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    chosenSize = Number(button.dataset.size);
    for (const b of event.currentTarget.children) b.classList.toggle("selected", b === button);
  });

  document.getElementById("btn-new").addEventListener("click", startNewGame);

  passButton.addEventListener("click", () => {
    const who = COLOR_NAME[game.turn];
    game.pass();
    messageEl.textContent = game.phase === "play" ? `${who} passed.` : "";
    refresh();
  });

  undoButton.addEventListener("click", () => {
    game.undo();
    messageEl.textContent = "";
    refresh();
  });

  resignButton.addEventListener("click", () => {
    if (confirm(`${COLOR_NAME[game.turn]}: are you sure you want to resign?`)) {
      game.resign();
      refresh();
    }
  });

  document.getElementById("btn-finish").addEventListener("click", () => {
    game.finishScoring();
    refresh();
  });

  document.getElementById("btn-resume").addEventListener("click", () => {
    game.resumePlay();
    messageEl.textContent = "Back to playing.";
    refresh();
  });

  refresh();
})();
