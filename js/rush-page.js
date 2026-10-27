// Puzzle Rush (puzzle-rush.html): solve as many capture puzzles as you can. 3 minutes, 5 minutes,
// or Survival (no clock); 3 mistakes and the run is over. Puzzles start easy (capture in 1 move)
// and get harder. White always answers with its best defense (puzzle-solver.js), and a move only
// counts if it still wins. Puzzles come from js/rush-puzzles.js plus the normal puzzles.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { FastBoard } = window.GoBot;
  const { renderBoard, COLUMN_LETTERS } = window.GoBoardView;
  const { boardFromDiagram, moveWins, whiteReply } = window.GoPuzzleSolver;
  const { t } = window.GoI18n;
  const $ = (id) => document.getElementById(id);
  const MODES = { "3min": { seconds: 180, name: "3 minutes" }, "5min": { seconds: 300, name: "5 minutes" }, survival: { seconds: 0, name: "Survival" } };
  const MAX_MISTAKES = 3;
  const WHITE_DELAY_MS = 250;
  const BEST_KEY = "goboard-rush-best"; // guests keep their best scores in the browser

  // Every puzzle sorted into 5 steps of difficulty by how many moves it takes.
  const POOL = [...(window.GO_RUSH_PUZZLES || []), ...window.GO_PUZZLES];
  const STEPS = [1, 2, 3, 4, 5].map((n) => POOL.filter((p) => Math.min(p.moves, 5) === n));
  // Puzzle k of a run: which difficulty step (5 puzzles per step, then the hardest from then on).
  const stepFor = (k) => Math.min(Math.floor(k / 5), 4);

  let run = null; // { mode, score, mistakes, k, endsAt, used, over, results: [true/false] }
  let puzzle = null, board = null, targets = [], movesLeft = 0, busy = false, lastMove = null, marks = [];
  let timer = null, token = 0;

  function pointIndex(coord, size) {
    return (size - Number(coord.slice(1))) * size + COLUMN_LETTERS.indexOf(coord[0]);
  }

  function pickPuzzle() {
    for (let step = stepFor(run.k); step >= 0; step--) {
      const left = STEPS[step].filter((p) => !run.used.has(p));
      if (left.length) return left[Math.floor(Math.random() * left.length)];
    }
    run.used.clear(); // played them all: start over
    return STEPS[0][Math.floor(Math.random() * STEPS[0].length)];
  }

  function draw() {
    const size = board.size;
    const targetMarks = targets.filter((i) => board.cells[i] === WHITE).map((i) => ({ x: i % size, y: Math.floor(i / size), kind: "target" }));
    $("board").innerHTML = renderBoard({ size, board: Array.from(board.cells), lastMove, marks: [...targetMarks, ...marks], ghostColor: busy || !run || run.over ? null : BLACK });
  }

  function drawPanel() {
    $("rush-score").textContent = String(run ? run.score : 0);
    $("rush-mistakes").textContent = run ? "✗".repeat(run.mistakes) + "○".repeat(MAX_MISTAKES - run.mistakes) : "";
    $("rush-results").innerHTML = run ? run.results.map((ok) => `<span class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"}</span>`).join("") : "";
    if (run && MODES[run.mode].seconds) {
      const left = Math.max(0, Math.ceil((run.endsAt - Date.now()) / 1000));
      $("rush-clock").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      $("rush-clock").classList.toggle("low", left <= 15);
    } else {
      $("rush-clock").textContent = run ? "∞" : "";
    }
  }

  function nextPuzzle() {
    token++;
    puzzle = pickPuzzle();
    run.used.add(puzzle);
    board = boardFromDiagram(puzzle.rows);
    targets = puzzle.targets.map((c) => pointIndex(c, board.size));
    movesLeft = puzzle.moves;
    lastMove = null;
    marks = [];
    busy = false;
    $("rush-prompt").textContent = puzzle.moves === 1 ? t("Black to play. Capture the marked stones in 1 move.")
      : t("Black to play. Capture the marked stones in {n} moves.", { n: puzzle.moves });
    draw();
    drawPanel();
  }

  function finishPuzzle(solved) {
    run.results.push(solved);
    if (solved) {
      run.score++;
      window.GoSounds.capture(2);
    } else {
      run.mistakes++;
    }
    run.k++;
    drawPanel();
    if (run.mistakes >= MAX_MISTAKES) return endRun(t("3 mistakes: the run is over."));
    const myToken = token;
    setTimeout(() => { if (myToken === token && !run.over) nextPuzzle(); }, solved ? 400 : 900);
  }

  function playBlack(point) {
    if (!run || run.over || busy) return;
    if (!board.isLegal(point, BLACK)) return;
    const size = board.size;
    if (!moveWins(board, targets, point, movesLeft)) {
      // Not the winning move: show it with a red X, then on to the next puzzle.
      busy = true;
      board.play(point, BLACK);
      lastMove = point;
      marks = [{ x: point % size, y: Math.floor(point / size), kind: "bad" }];
      window.GoSounds.stone();
      draw();
      return finishPuzzle(false);
    }
    board.play(point, BLACK);
    lastMove = point;
    movesLeft--;
    window.GoSounds.stone();
    if (targets.some((i) => board.cells[i] !== WHITE)) {
      busy = true;
      draw();
      return finishPuzzle(true);
    }
    busy = true;
    draw();
    const myToken = token;
    setTimeout(() => {
      if (myToken !== token || run.over) return;
      const reply = whiteReply(board, targets, movesLeft);
      if (reply !== null) {
        board.play(reply, WHITE);
        lastMove = reply;
        window.GoSounds.stone();
      }
      busy = false;
      draw();
    }, WHITE_DELAY_MS);
  }

  // ---- Starting and ending a run ----

  function bestScores() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch { return {}; }
  }

  function startRun(mode) {
    clearInterval(timer);
    run = { mode, score: 0, mistakes: 0, k: 0, used: new Set(), over: false, results: [], endsAt: Date.now() + MODES[mode].seconds * 1000 };
    $("rush-start").hidden = true;
    $("rush-end").hidden = true;
    $("rush-play").hidden = false;
    $("rush-mode-name").textContent = t(MODES[mode].name);
    if (MODES[mode].seconds) {
      timer = setInterval(() => {
        drawPanel();
        if (Date.now() >= run.endsAt) endRun(t("Time's up!"));
      }, 250);
    }
    nextPuzzle();
    if (window.matchMedia("(max-width: 1000px)").matches) document.querySelector(".board-column").scrollIntoView({ block: "start" });
  }

  async function endRun(why) {
    if (run.over) return;
    run.over = true;
    token++;
    clearInterval(timer);
    busy = false;
    draw();
    drawPanel();
    const best = bestScores();
    const newBest = run.score > (best[run.mode] || 0);
    if (newBest) {
      best[run.mode] = run.score;
      try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* not saved */ }
    }
    $("rush-play").hidden = true;
    $("rush-end").hidden = false;
    $("rush-end-why").textContent = why;
    $("rush-end-score").textContent = t("Score: {n}", { n: run.score });
    $("rush-end-best").textContent = newBest ? t("🎉 New best!") : t("Your best: {n}", { n: best[run.mode] || 0 });
    $("rush-again").dataset.mode = run.mode;
    // Logged in: the score goes to your profile and the Rush top scores (supabase/16-puzzle-rush.sql).
    const accounts = window.GoAccounts;
    const profile = accounts && accounts.ready ? accounts.current().profile : null;
    $("rush-end-note").textContent = profile ? "" : t("Log in to save your best scores to your profile and the Rush top scores.");
    if (profile && run.score > 0) {
      const { data, error } = await accounts.client.rpc("submit_rush_score", {
        p_mode: run.mode, p_score: run.score, p_version: window.GoVersion ? window.GoVersion.version : 0,
      });
      if (error) $("rush-end-note").textContent = t(error.message.replace(/^.*?:\s*/, ""));
      else {
        if (data.best) $("rush-end-note").textContent = t("Saved to your profile.");
        // Rush achievements are given by the database; show the new ones.
        if (window.GoAchievements && data.new.length) window.GoAchievements.announceNew(data.new);
      }
    }
    if (window.GoAchievements) window.GoAchievements.activity(); // a Rush counts for the daily streak
  }

  $("board").addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    if (spot) playBlack(Number(spot.dataset.y) * board.size + Number(spot.dataset.x));
  });
  for (const b of document.querySelectorAll("[data-rush-mode]")) b.addEventListener("click", () => startRun(b.dataset.rushMode));
  $("rush-again").addEventListener("click", (event) => startRun(event.currentTarget.dataset.mode));
  $("rush-menu").addEventListener("click", () => {
    $("rush-end").hidden = true;
    $("rush-start").hidden = false;
    drawBests();
  });
  $("rush-quit").addEventListener("click", () => { if (run && !run.over) endRun(t("You stopped the run.")); });

  function drawBests() {
    const best = bestScores();
    for (const mode of Object.keys(MODES)) {
      const el = document.querySelector(`[data-rush-best="${mode}"]`);
      if (el) el.textContent = best[mode] ? t("Best: {n}", { n: best[mode] }) : "";
    }
  }

  // An empty board until a run starts.
  board = new FastBoard(9);
  draw();
  drawBests();
  $("rush-count").textContent = t("{n} puzzles", { n: POOL.length });
})();
