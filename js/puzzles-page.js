// The Puzzles page: shows one puzzle at a time, checks your moves with the
// solver, plays White's answers, and remembers which puzzles you solved.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { FastBoard } = window.GoBot;
  const { renderBoard, COLUMN_LETTERS } = window.GoBoardView;
  const { boardFromDiagram, moveWins, whiteReply } = window.GoPuzzleSolver;
  const PUZZLES = window.GO_PUZZLES;
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

  function drawList() {
    $("puzzle-grid").innerHTML = PUZZLES.map((p, i) => {
      const classes = ["puzzle-chip"];
      if (i === index) classes.push("current");
      if (solved.has(i)) classes.push("solved");
      return `<button class="${classes.join(" ")}" data-index="${i}" title="${p.title}">${solved.has(i) ? "✓" : i + 1}</button>`;
    }).join("");
    $("puzzle-progress").textContent = `Solved ${solved.size} of ${PUZZLES.length}.`;
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
    $("puzzle-title").textContent = `${index + 1}. ${puzzle.title}`;
    $("puzzle-count").textContent = solved.has(index) ? "Solved ✓" : "";
    $("puzzle-prompt").textContent = puzzle.prompt;
    setStatus("Black to play", movesText());
    draw();
    drawList();
    try { history.replaceState(null, "", `#${index + 1}`); } catch { /* address bar not updated */ }
  }

  const movesText = () => `${movesLeft} move${movesLeft === 1 ? "" : "s"} left to capture.`;

  function captures(before) {
    let gone = 0;
    for (let i = 0; i < board.cells.length; i++) if (before[i] === WHITE && board.cells[i] !== WHITE) gone++;
    return gone;
  }

  function finish() {
    done = true;
    solved.add(index);
    saveSolved();
    setStatus("Correct! 🎉", index + 1 < PUZZLES.length ? "Press Next for the next puzzle." : "That was the last puzzle. Well done!");
    $("puzzle-count").textContent = "Solved ✓";
    draw();
    drawList();
  }

  function whiteTurn() {
    const myToken = token;
    busy = true;
    setStatus("White is answering…", movesText());
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
      setStatus("Black to play", reply === null ? `White passed. ${movesText()}` : movesText());
      draw();
    }, WHITE_DELAY_MS);
  }

  function playBlack(point) {
    if (busy || done) return;
    if (!board.isLegal(point, BLACK)) {
      setStatus("Black to play", "You can't play there.");
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
    setStatus("Not quite", "That move doesn't capture in time. Try another one.");
    draw();
    setTimeout(() => {
      if (myToken !== token) return;
      board = saved;
      lastMove = savedLast;
      busy = false;
      marks = [];
      setStatus("Black to play", `Try again. ${movesText()}`);
      draw();
    }, WRONG_SHOW_MS);
  }

  boardEl.addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (!spot) return;
    playBlack(Number(spot.dataset.y) * board.size + Number(spot.dataset.x));
  });

  $("btn-reset").addEventListener("click", () => loadPuzzle(index));
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
    soundButton.title = muted ? "Sound is off. Click to turn it on." : "Sound is on. Click to turn it off.";
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
