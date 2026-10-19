// The Puzzles page: shows one puzzle at a time, checks your moves with the
// solver, plays White's answers, and remembers which puzzles you solved.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { FastBoard } = window.GoBot;
  const { renderBoard, COLUMN_LETTERS } = window.GoBoardView;
  const { boardFromDiagram, moveWins, whiteReply } = window.GoPuzzleSolver;
  const PUZZLES = window.GO_PUZZLES;
  const { t, sentences } = window.GoI18n;
  const SOLVED_KEY = "goboard-puzzles-solved";
  const WHITE_DELAY_MS = 450;
  const WRONG_SHOW_MS = 900;

  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");

  let solved = new Set();
  try { solved = new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) || "[]")); } catch { /* starts empty */ }

  let index = 0;
  let board = null;      // FastBoard of the current position
  let targets = [];      // board indexes of the stones to capture
  let movesLeft = 0;
  let lastMove = null;
  let marks = [];
  let busy = false;      // White is answering, or a wrong move is being shown
  let done = false;
  let token = 0;         // bumped when the puzzle changes, so old timers do nothing

  function pointIndex(coord, size) {
    const x = COLUMN_LETTERS.indexOf(coord[0]);
    const y = size - Number(coord.slice(1));
    return y * size + x;
  }

  function saveSolved() {
    try { localStorage.setItem(SOLVED_KEY, JSON.stringify([...solved])); } catch { /* not saved, still works */ }
  }

  function targetCaptured() {
    return targets.some((t) => board.cells[t] !== WHITE);
  }

  function draw() {
    const size = board.size;
    const targetMarks = done ? [] : targets.filter((t) => board.cells[t] === WHITE)
      .map((t) => ({ x: t % size, y: Math.floor(t / size), kind: "target" }));
    boardEl.innerHTML = renderBoard({
      size,
      board: Array.from(board.cells),
      lastMove,
      marks: [...targetMarks, ...marks],
      ghostColor: busy || done ? null : BLACK,
    });
  }

  const LEVELS = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]];
  const daily = window.GoDailyPuzzle();

  // The puzzles in level sections; today's puzzle has a star.
  function drawList() {
    const chip = (p, i) => {
      const classes = ["puzzle-chip"];
      if (i === index) classes.push("current");
      if (solved.has(i)) classes.push("solved");
      if (i === daily) classes.push("daily");
      const title = window.GoPuzzleText(p).title + (i === daily ? ` · ${t("Today's puzzle")}` : "");
      return `<button class="${classes.join(" ")}" data-index="${i}" title="${title}">${solved.has(i) ? "✓" : i + 1}</button>`;
    };
    $("puzzle-grid").innerHTML = LEVELS.map(([level, name]) => {
      const chips = PUZZLES.map((p, i) => (p.level === level ? chip(p, i) : "")).join("");
      if (!chips) return "";
      const done = PUZZLES.filter((p, i) => p.level === level && solved.has(i)).length;
      const total = PUZZLES.filter((p) => p.level === level).length;
      return `<p class="label puzzle-level">${t(name)} <span>${done}/${total}</span></p><div class="puzzle-chips">${chips}</div>`;
    }).join("");
    $("puzzle-progress").textContent = t("Solved {n} of {total}.", { n: solved.size, total: PUZZLES.length });
  }

  function setStatus(status, message = "") {
    $("status").textContent = status;
    $("message").textContent = message;
  }

  function loadPuzzle(i) {
    index = (i + PUZZLES.length) % PUZZLES.length;
    const puzzle = PUZZLES[index];
    token++;
    board = boardFromDiagram(puzzle.rows);
    targets = puzzle.targets.map((c) => pointIndex(c, board.size));
    movesLeft = puzzle.moves;
    lastMove = null;
    marks = [];
    busy = false;
    done = false;
    const text = window.GoPuzzleText(puzzle);
    $("puzzle-title").textContent = `${index + 1}. ${text.title}${index === daily ? " ⭐" : ""}`;
    $("puzzle-count").textContent = solved.has(index) ? t("Solved ✓") : "";
    $("puzzle-prompt").textContent = text.prompt;
    setStatus(t("Black to play"), movesText());
    draw();
    drawList();
    try { history.replaceState(null, "", `#${index + 1}`); } catch { /* address bar not updated */ }
  }

  const movesText = () => (movesLeft === 1 ? t("1 move left to capture.") : t("{n} moves left to capture.", { n: movesLeft }));

  function captures(before) {
    let gone = 0;
    for (let i = 0; i < board.cells.length; i++) if (before[i] === WHITE && board.cells[i] !== WHITE) gone++;
    return gone;
  }

  function finish() {
    done = true;
    solved.add(index);
    saveSolved();
    setStatus(t("Correct! 🎉"), index + 1 < PUZZLES.length ? t("Press Next for the next puzzle.") : t("That was the last puzzle. Well done!"));
    $("puzzle-count").textContent = t("Solved ✓");
    draw();
    drawList();
  }

  function whiteTurn() {
    const myToken = token;
    busy = true;
    setStatus(t("White is answering…"), movesText());
    draw();
    setTimeout(() => {
      if (myToken !== token) return;
      const reply = whiteReply(board, targets, movesLeft);
      if (reply !== null) {
        board.play(reply, WHITE);
        lastMove = reply;
        window.GoSounds.stone();
      }
      busy = false;
      setStatus(t("Black to play"), reply === null ? sentences(t("White passed."), movesText()) : movesText());
      draw();
    }, WHITE_DELAY_MS);
  }

  function playBlack(point) {
    if (busy || done) return;
    if (!board.isLegal(point, BLACK)) {
      setStatus(t("Black to play"), t("You can't play there."));
      return;
    }
    marks = [];
    if (!moveWins(board, targets, point, movesLeft)) {
      showWrongMove(point);
      return;
    }
    const before = Array.from(board.cells);
    board.play(point, BLACK);
    lastMove = point;
    movesLeft--;
    window.GoSounds.stone();
    const taken = captures(before);
    if (taken) window.GoSounds.capture(taken);
    if (targetCaptured()) finish();
    else whiteTurn();
  }

  // Show the wrong stone for a moment with a red X, then take it back.
  function showWrongMove(point) {
    const myToken = token, saved = new FastBoard(board.size);
    saved.copyFrom(board);
    const savedLast = lastMove, size = board.size;
    board.play(point, BLACK);
    lastMove = point;
    busy = true;
    marks = [{ x: point % size, y: Math.floor(point / size), kind: "bad" }];
    window.GoSounds.stone();
    setStatus(t("Not quite"), t("That move doesn't capture in time. Try another one."));
    draw();
    setTimeout(() => {
      if (myToken !== token) return;
      board = saved;
      lastMove = savedLast;
      busy = false;
      marks = [];
      setStatus(t("Black to play"), sentences(t("Try again."), movesText()));
      draw();
    }, WRONG_SHOW_MS);
  }

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    playBlack(Number(spot.dataset.y) * board.size + Number(spot.dataset.x));
  });

  $("btn-reset").addEventListener("click", () => loadPuzzle(index));
  $("btn-daily").addEventListener("click", () => loadPuzzle(daily));
  $("btn-next-puzzle").addEventListener("click", () => loadPuzzle(index + 1));
  $("btn-prev-puzzle").addEventListener("click", () => loadPuzzle(index - 1));
  $("puzzle-grid").addEventListener("click", (event) => {
    const chip = event.target.closest(".puzzle-chip");
    if (chip) loadPuzzle(Number(chip.dataset.index));
  });

  // Sound on/off button (same as on the game page).
  const soundButton = $("btn-sound");
  function updateSoundButton() {
    const muted = window.GoSounds.isMuted();
    soundButton.textContent = muted ? "🔇" : "🔊";
    soundButton.title = muted ? t("Sound is off. Click to turn it on.") : t("Sound is on. Click to turn it off.");
    soundButton.classList.toggle("off", muted);
  }
  soundButton.addEventListener("click", () => {
    window.GoSounds.setMuted(!window.GoSounds.isMuted());
    updateSoundButton();
  });
  updateSoundButton();

  // Start where the address says (#5 = puzzle 5), otherwise at the first unsolved one.
  const fromAddress = Number(location.hash.slice(1)) - 1;
  const firstUnsolved = PUZZLES.findIndex((_, i) => !solved.has(i));
  loadPuzzle(fromAddress >= 0 && fromAddress < PUZZLES.length ? fromAddress : Math.max(0, firstUnsolved));
})();
