// Computer opponents. Levels 1-3 score every move with Go rules of thumb (with
// random mistakes mixed in). Levels 4-5 also play thousands of quick practice games
// from the current position and pick the move that wins most often
// ("Monte Carlo tree search", with RAVE). The thinking runs in background workers,
// one per spare processor core (js/bot-worker.js), so the page never freezes.
(function () {
  const { EMPTY, BLACK, WHITE, KOMI, otherColor } = window.Go;

  const BOT_LEVELS = [
    { level: 1, name: "Pebble", blurb: "Just learned the rules.", noise: 25 },
    { level: 2, name: "Sprout", blurb: "Grabs stones when it can.", noise: 7 },
    { level: 3, name: "Fox", blurb: "Protects its stones, sets traps.", noise: 1.5 },
    { level: 4, name: "Tiger", blurb: "Reads ahead for about a second.", thinkMs: 1200 },
    { level: 5, name: "Dragon", blurb: "A neural network that learned Go from millions of games.", thinkMs: 10000, neural: true },
  ];

  // Search tuning. Prior visits let the rules of thumb steer the search early on.
  const PRIOR_VISITS = 6;
  const PRIOR_RAVE = 20;
  const RAVE_EQUIVALENCE = 1000; // after about this many real visits, RAVE stops mattering much
  const EXPAND_AFTER = 2;
  const EXPLORATION = 0.15;      // RAVE already explores, so less blind exploring is needed
  const SLICE_MS = 30;
  const MAX_WORKERS = 8;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Neighbor lists and scratch buffers, built once per board size.
  const geometries = {};
  function geometry(size) {
    if (geometries[size]) return geometries[size];
    const n = size * size, nbrs = [], diags = [], edge = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = i % size, y = Math.floor(i / size), nb = [], dg = [];
      if (x > 0) nb.push(i - 1);
      if (x < size - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - size);
      if (y < size - 1) nb.push(i + size);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ax = x + dx, ay = y + dy;
        if (ax >= 0 && ay >= 0 && ax < size && ay < size) dg.push(ay * size + ax);
      }
      nbrs.push(nb);
      diags.push(dg);
      edge[i] = dg.length < 4 ? 1 : 0;
    }
    return (geometries[size] = {
      n, nbrs, diags, edge,
      mark: new Int32Array(n), stamp: 0, stack: new Int16Array(n),
    });
  }

  // A fast, throwaway copy of the board for the bot to experiment on.
  class FastBoard {
    constructor(size, cells) {
      const g = geometry(size);
      this.size = size;
      this.n = g.n;
      this.g = g;
      this.nbrs = g.nbrs;
      this.cells = new Int8Array(g.n);
      this.empties = new Int16Array(g.n);
      this.emptyPos = new Int16Array(g.n);
      this.emptyCount = 0;
      this.ko = -1;
      this.groupSize = 0;
      this.lastLib = -1;
      if (cells) this.cells.set(cells);
      for (let i = 0; i < g.n; i++) if (this.cells[i] === EMPTY) this.addEmpty(i);
    }

    static fromGame(game) {
      const board = new FastBoard(game.size, game.board);
      board.ko = koPointOf(game);
      return board;
    }

    copyFrom(other) {
      this.cells.set(other.cells);
      this.empties.set(other.empties);
      this.emptyPos.set(other.emptyPos);
      this.emptyCount = other.emptyCount;
      this.ko = other.ko;
    }

    addEmpty(i) {
      this.emptyPos[i] = this.emptyCount;
      this.empties[this.emptyCount++] = i;
    }

    removeEmpty(i) {
      const pos = this.emptyPos[i], last = this.empties[--this.emptyCount];
      this.empties[pos] = last;
      this.emptyPos[last] = pos;
    }

    // Counts the liberties of the group at `start`, stopping once `limit` is reached.
    // Pretends `except` is not a liberty (used to test a move there).
    // When the count is below `limit`, groupSize and g.stack hold the whole group.
    scanGroup(start, limit = Infinity, except = -1) {
      const g = this.g, mark = g.mark, stack = g.stack, cells = this.cells, color = cells[start];
      const stamp = ++g.stamp;
      let len = 0, libs = 0;
      stack[len++] = start;
      mark[start] = stamp;
      if (except >= 0) mark[except] = stamp;
      for (let k = 0; k < len; k++) {
        for (const nb of this.nbrs[stack[k]]) {
          if (mark[nb] === stamp) continue;
          const c = cells[nb];
          if (c === EMPTY) {
            mark[nb] = stamp;
            this.lastLib = nb;
            if (++libs >= limit) { this.groupSize = len; return libs; }
          } else if (c === color) {
            mark[nb] = stamp;
            stack[len++] = nb;
          }
        }
      }
      this.groupSize = len;
      return libs;
    }

    removeGroup(start) {
      this.scanGroup(start);
      const len = this.groupSize, stack = this.g.stack;
      for (let k = 0; k < len; k++) {
        this.cells[stack[k]] = EMPTY;
        this.addEmpty(stack[k]);
      }
      return len;
    }

    isLegal(i, color) {
      if (this.cells[i] !== EMPTY || i === this.ko) return false;
      const opp = otherColor(color);
      for (const nb of this.nbrs[i]) if (this.cells[nb] === EMPTY) return true;
      for (const nb of this.nbrs[i]) {
        const c = this.cells[nb];
        if (c === color && this.scanGroup(nb, 1, i) >= 1) return true;
        if (c === opp && this.scanGroup(nb, 1, i) === 0) return true;
      }
      return false;
    }

    // A point surrounded by our own stones that we should never fill in.
    isEye(i, color) {
      for (const nb of this.nbrs[i]) if (this.cells[nb] !== color) return false;
      let enemyCorners = 0;
      for (const d of this.g.diags[i]) if (this.cells[d] === otherColor(color)) enemyCorners++;
      return this.g.edge[i] ? enemyCorners === 0 : enemyCorners <= 1;
    }

    // Assumes the move is legal. Returns how many stones were captured.
    play(i, color) {
      const opp = otherColor(color);
      this.cells[i] = color;
      this.removeEmpty(i);
      let captured = 0, capturedAt = -1;
      for (const nb of this.nbrs[i]) {
        if (this.cells[nb] === opp && this.scanGroup(nb, 1) === 0) {
          captured += this.removeGroup(nb);
          capturedAt = nb;
        }
      }
      this.ko = -1;
      if (captured === 1) {
        let alone = true, libs = 0;
        for (const nb of this.nbrs[i]) {
          if (this.cells[nb] === color) alone = false;
          else if (this.cells[nb] === EMPTY) libs++;
        }
        if (alone && libs === 1) this.ko = capturedAt;
      }
      return captured;
    }

    // Would a stone at i (legal, empty) end up in atari without capturing anything?
    // Practice games avoid these moves; real players rarely make them on purpose.
    isSelfAtari(i, color) {
      const opp = otherColor(color);
      for (const nb of this.nbrs[i]) {
        if (this.cells[nb] === opp && this.scanGroup(nb, 2) === 1) return false; // it captures
      }
      const g = this.g, mark = g.mark, stack = g.stack, cells = this.cells;
      const stamp = ++g.stamp;
      mark[i] = stamp;
      let libs = 0, len = 0;
      for (const nb of this.nbrs[i]) {
        if (mark[nb] === stamp) continue;
        if (cells[nb] === EMPTY) {
          mark[nb] = stamp;
          if (++libs >= 2) return false;
        } else if (cells[nb] === color) {
          mark[nb] = stamp;
          stack[len++] = nb;
        }
      }
      // Liberties of the friendly groups the stone joins.
      for (let k = 0; k < len; k++) {
        for (const nb of this.nbrs[stack[k]]) {
          if (mark[nb] === stamp) continue;
          mark[nb] = stamp;
          if (cells[nb] === EMPTY) {
            if (++libs >= 2) return false;
          } else if (cells[nb] === color) {
            stack[len++] = nb;
          }
        }
      }
      return true;
    }

    // A random move that is legal, doesn't fill our own eye and isn't self-atari.
    randomMove(color) {
      const count = this.emptyCount, start = Math.floor(Math.random() * count);
      for (let k = 0; k < count; k++) {
        const i = this.empties[(start + k) % count];
        if (!this.isEye(i, color) && this.isLegal(i, color) && !this.isSelfAtari(i, color)) return i;
      }
      return -1;
    }

    // If the last move left its own stones with one liberty, take them.
    captureNear(last, color) {
      if (last < 0 || this.cells[last] !== otherColor(color)) return -1;
      if (this.scanGroup(last, 2) !== 1) return -1;
      const lib = this.lastLib;
      return this.isLegal(lib, color) ? lib : -1;
    }

    // If the last move put one of our groups next to it in atari, run away by
    // extending at its last liberty (when that really gives it more room).
    escapeAtari(last, color) {
      if (last < 0) return -1;
      for (const nb of this.nbrs[last]) {
        if (this.cells[nb] !== color || this.scanGroup(nb, 2) !== 1) continue;
        const lib = this.lastLib;
        if (this.isLegal(lib, color) && !this.isSelfAtari(lib, color)) return lib;
      }
      return -1;
    }

    // Plays sensible random moves until both sides run out, then returns black minus white (no komi).
    // `record` (optional) collects the moves for RAVE: record.moves / record.colors / record.length.
    playout(color, last, record) {
      let passes = 0, moves = 0;
      const limit = this.n * 3;
      while (passes < 2 && moves < limit) {
        let move = this.captureNear(last, color);
        if (move < 0) move = this.escapeAtari(last, color);
        if (move < 0) move = this.randomMove(color);
        if (move < 0) passes++;
        else {
          passes = 0;
          this.play(move, color);
          if (record) {
            record.moves[record.length] = move;
            record.colors[record.length++] = color;
          }
        }
        last = move;
        color = otherColor(color);
        moves++;
      }
      return this.areaScore();
    }

    areaScore() {
      let score = 0;
      for (let i = 0; i < this.n; i++) {
        const c = this.cells[i];
        if (c === BLACK) score++;
        else if (c === WHITE) score--;
        else {
          const first = this.cells[this.nbrs[i][0]];
          if (first !== EMPTY && this.nbrs[i].every((nb) => this.cells[nb] === first)) {
            score += first === BLACK ? 1 : -1;
          }
        }
      }
      return score;
    }
  }

  // The game itself doesn't store a ko point, so work it out from the last move.
  function koPointOf(game) {
    const prev = game.history[game.history.length - 1];
    if (!prev || typeof game.lastMove !== "number") return -1;
    let capturedAt = -1, count = 0;
    for (let i = 0; i < game.board.length; i++) {
      if (prev.board[i] !== EMPTY && game.board[i] === EMPTY) { count++; capturedAt = i; }
    }
    if (count !== 1) return -1;
    const mover = game.board[game.lastMove];
    let libs = 0;
    for (const nb of geometry(game.size).nbrs[game.lastMove]) {
      if (game.board[nb] === mover) return -1;
      if (game.board[nb] === EMPTY) libs++;
    }
    return libs === 1 ? capturedAt : -1;
  }

  function chebyshev(size, a, b) {
    return Math.max(Math.abs((a % size) - (b % size)), Math.abs(Math.floor(a / size) - Math.floor(b / size)));
  }

  function hasStoneNear(board, x, y, radius) {
    const s = board.size;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(s - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(s - 1, x + radius); xx++) {
        if (board.cells[yy * s + xx] !== EMPTY) return true;
      }
    }
    return false;
  }

  // Rules of thumb: capture, escape from atari, don't put yourself in atari,
  // threaten stones, start on the 3rd/4th line, play near the action.
  function evaluateMove(board, scratch, i, color, lastMove) {
    const opp = otherColor(color), size = board.size;
    let score = 0, inDanger = 0;

    for (const nb of board.nbrs[i]) {
      if (board.cells[nb] === color && board.scanGroup(nb, 2) === 1) inDanger += board.groupSize;
    }

    scratch.copyFrom(board);
    const captured = scratch.play(i, color);
    const libs = scratch.scanGroup(i, 3);
    const groupSize = scratch.groupSize;

    if (captured > 0) score += 4 + captured * 3;
    if (inDanger > 0 && libs >= 2) score += 3 + inDanger * 3;
    if (libs === 1 && captured === 0) score -= 6 + groupSize * 3;
    for (const nb of scratch.nbrs[i]) {
      if (scratch.cells[nb] === opp && scratch.scanGroup(nb, 2) === 1) {
        score += 1.5 + Math.min(scratch.groupSize, 6) * 0.5;
      }
    }

    const x = i % size, y = Math.floor(i / size);
    const edgeX = Math.min(x, size - 1 - x), edgeY = Math.min(y, size - 1 - y);
    const edge = Math.min(edgeX, edgeY);
    const goodLine = (d) => d === 2 || d === 3;
    const stones = board.n - board.emptyCount;

    // Opening: corners first, then sides, spread out instead of touching stones.
    if (stones < size) {
      if (goodLine(edge)) score += 2;
      else if (edge <= 1) score -= 3;
      if (goodLine(edgeX) && goodLine(edgeY)) score += 2;
      if (!hasStoneNear(board, x, y, 3)) score += 2;
      return score;
    }

    if (edge === 0) score -= 1;
    if (hasStoneNear(board, x, y, 2)) score += 1;
    if (lastMove >= 0 && chebyshev(size, i, lastMove) <= 2) score += 1;
    return score;
  }

  // On big boards the search only looks near existing stones (plus the 3rd/4th
  // lines early on), otherwise it would spread its thinking too thin.
  function nearbyMask(board) {
    const s = board.size, mask = new Uint8Array(board.n);
    let stones = 0;
    for (let i = 0; i < board.n; i++) {
      if (board.cells[i] === EMPTY) continue;
      stones++;
      const x = i % s, y = Math.floor(i / s);
      for (let yy = Math.max(0, y - 2); yy <= Math.min(s - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(s - 1, x + 2); xx++) mask[yy * s + xx] = 1;
      }
    }
    if (stones < 10) {
      for (let i = 0; i < board.n; i++) {
        const x = i % s, y = Math.floor(i / s), edge = Math.min(x, y, s - 1 - x, s - 1 - y);
        if (edge === 2 || edge === 3) mask[i] = 1;
      }
    }
    return mask;
  }

  function candidateMoves(board, color, nearbyOnly) {
    const mask = nearbyOnly && board.size > 9 ? nearbyMask(board) : null;
    const out = [];
    for (let k = 0; k < board.emptyCount; k++) {
      const i = board.empties[k];
      if (mask && !mask[i]) continue;
      if (!board.isEye(i, color) && board.isLegal(i, color)) out.push(i);
    }
    return out;
  }

  function rankByRulesOfThumb(board, color, lastMove, noise) {
    const scratch = new FastBoard(board.size);
    return candidateMoves(board, color, false)
      .map((i) => ({ i, score: evaluateMove(board, scratch, i, color, lastMove) + (Math.random() * 2 - 1) * noise }))
      .sort((a, b) => b.score - a.score)
      .map((c) => c.i);
  }

  // ---- Monte Carlo tree search with RAVE ----
  //
  // RAVE ("all moves as first"): when a practice game is won, every move the winner
  // played anywhere in it gets a little credit, not only the first one. That makes the
  // search learn which points matter much faster; real visits take over as they add up.

  function expand(node, board, scratch, color, last) {
    node.children = candidateMoves(board, color, true).map((i) => {
      const prior = clamp(0.5 + evaluateMove(board, scratch, i, color, last) / 24, 0.1, 0.9);
      return {
        move: i, color, children: null,
        wins: prior * PRIOR_VISITS, visits: PRIOR_VISITS,
        raveWins: prior * PRIOR_RAVE, raveVisits: PRIOR_RAVE,
      };
    });
  }

  function selectChild(node) {
    const logN = Math.log(node.visits + 1);
    let best = null, bestValue = -Infinity;
    for (const child of node.children) {
      const beta = Math.sqrt(RAVE_EQUIVALENCE / (3 * child.visits + RAVE_EQUIVALENCE));
      const value = (1 - beta) * (child.wins / child.visits) + beta * (child.raveWins / child.raveVisits)
        + EXPLORATION * Math.sqrt(logN / child.visits);
      if (value > bestValue) { bestValue = value; best = child; }
    }
    return best;
  }

  // One search: everything one thread needs, reused for every practice game.
  function newSearch(rootBoard, rootColor, rootLast) {
    const size = rootBoard.size, n = rootBoard.n;
    const search = {
      rootBoard, rootColor, rootLast,
      root: { move: -1, color: otherColor(rootColor), wins: 0, visits: 0, children: null },
      work: new FastBoard(size), scratch: new FastBoard(size),
      record: { moves: new Int16Array(n * 4), colors: new Int8Array(n * 4), length: 0 },
      amaf: new Int8Array(n),
    };
    expand(search.root, rootBoard, search.scratch, rootColor, rootLast);
    return search;
  }

  function runIteration(search) {
    const { work, record, amaf } = search;
    work.copyFrom(search.rootBoard);
    record.length = 0;
    let node = search.root, color = search.rootColor, last = search.rootLast;
    const path = [node];
    const step = (child) => {
      work.play(child.move, color);
      record.moves[record.length] = child.move;
      record.colors[record.length++] = color;
      last = child.move;
      color = otherColor(color);
      path.push(child);
      return child;
    };

    while (node.children && node.children.length) node = step(selectChild(node));
    if (node.children === null && node.visits >= PRIOR_VISITS + EXPAND_AFTER) {
      expand(node, work, search.scratch, color, last);
      if (node.children.length) node = step(selectChild(node));
    }

    const winner = work.playout(color, last, record) - KOMI > 0 ? BLACK : WHITE;
    for (const p of path) {
      p.visits++;
      if (p.color === winner) p.wins++;
    }

    // RAVE: walk the game backwards so amaf[] holds who played each point first
    // from move k onwards; the children of path[k] are the choices at move k.
    amaf.fill(0);
    for (let k = record.length - 1; k >= 0; k--) {
      amaf[record.moves[k]] = record.colors[k];
      if (k >= path.length || !path[k].children) continue;
      for (const child of path[k].children) {
        if (amaf[child.move] !== child.color) continue;
        child.raveVisits++;
        if (child.color === winner) child.raveWins++;
      }
    }
  }

  // [move, visits, wins] for every first move, so several searches can be added up.
  const rootStats = (search) => search.root.children.map((c) => [c.move, c.visits, c.wins]);

  // Runs without breaks: used inside a background worker (js/bot-worker.js).
  function searchInWorker(cells, size, ko, color, last, thinkMs) {
    const board = new FastBoard(size, cells);
    board.ko = ko;
    const search = newSearch(board, color, last);
    const deadline = performance.now() + thinkMs;
    let k = 0;
    while ((k++ & 15) !== 0 || performance.now() < deadline) runIteration(search);
    return rootStats(search);
  }

  // Best first, from summed stats; the win rate is the best move's.
  function rankStats(statLists) {
    const totals = new Map();
    for (const list of statLists) {
      for (const [move, visits, wins] of list) {
        const t = totals.get(move) || { move, visits: 0, wins: 0 };
        t.visits += visits;
        t.wins += wins;
        totals.set(move, t);
      }
    }
    const kids = [...totals.values()].sort((a, b) => b.visits - a.visits);
    return { ranked: kids.map((k) => k.move), winRate: kids.length ? kids[0].wins / kids[0].visits : 0 };
  }

  // Fallback without workers (e.g. the page opened straight from disk): think on the
  // page itself in small time slices so it never freezes.
  function searchOnPage(rootBoard, rootColor, rootLast, thinkMs, isCancelled) {
    const search = newSearch(rootBoard, rootColor, rootLast);
    const deadline = performance.now() + thinkMs;
    return new Promise((resolve) => {
      const slice = () => {
        if (isCancelled()) return resolve({ ranked: [], winRate: 0 });
        const end = Math.min(performance.now() + SLICE_MS, deadline);
        do runIteration(search);
        while (performance.now() < end);
        if (performance.now() < deadline) return setTimeout(slice, 0);
        resolve(rankStats([rootStats(search)]));
      };
      setTimeout(slice, 0);
    });
  }

  // ---- Background workers: one search per spare processor core ----

  // The worker loads the same versions of the scripts as the page (same ?v=).
  const SCRIPT_URL = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : "";
  let pool = null;          // { workers, busy }
  let workersBroken = false;

  function stopPool() {
    if (pool) for (const w of pool.workers) w.terminate();
    pool = null;
  }

  function getPool() {
    if (workersBroken || typeof Worker !== "function" || !SCRIPT_URL || location.protocol === "file:") return null;
    if (pool && pool.busy) stopPool(); // an old search is still running: start fresh
    if (pool) return pool;
    try {
      const url = new URL("bot-worker.js", SCRIPT_URL);
      url.search = new URL(SCRIPT_URL).search;
      const count = clamp((navigator.hardwareConcurrency || 2) - 1, 1, MAX_WORKERS);
      pool = { workers: Array.from({ length: count }, () => new Worker(url)), busy: false };
    } catch {
      workersBroken = true;
      pool = null;
    }
    return pool;
  }

  function searchWithWorkers(current, board, color, last, thinkMs, isCancelled) {
    current.busy = true;
    return new Promise((resolve) => {
      const results = [];
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearInterval(watch);
        current.busy = false;
        resolve(value);
      };
      const watch = setInterval(() => {
        if (!isCancelled()) return;
        if (pool === current) stopPool();
        finish({ ranked: [], winRate: 0 });
      }, 100);
      for (const worker of current.workers) {
        worker.onmessage = (event) => {
          results.push(event.data);
          if (results.length === current.workers.length) finish(rankStats(results));
        };
        worker.onerror = () => {
          // Workers can't start here: remember that and think on the page instead.
          workersBroken = true;
          if (pool === current) stopPool();
          finish(null);
        };
        worker.postMessage({ cells: board.cells, size: board.size, ko: board.ko, color, last, thinkMs });
      }
    });
  }

  // ---- The neural-network Dragon (js/dragon-worker.js + models/) ----
  // Dragon and Hint use a KataGo network when the browser can run it; otherwise they fall
  // back to the search above. The network (~6 MB) and its runtime (~12 MB) download the
  // first time Dragon thinks, then the browser keeps them.

  let evaluator = null;      // the helpers that run the network (kept between moves)
  let nnBroken = false;
  let nnReady = false;      // the network answered at least once on this page

  function getEvaluator() {
    if (nnBroken || typeof Worker !== "function" || !SCRIPT_URL || location.protocol === "file:" || !window.GoDragonSearch) return null;
    if (evaluator && !evaluator.broken) return evaluator;
    try {
      const url = new URL("dragon-worker.js", SCRIPT_URL);
      url.search = new URL(SCRIPT_URL).search;
      evaluator = new window.GoDragonSearch.Evaluator(url, new URL("../models/dragon-b10c128.onnx", SCRIPT_URL).href);
    } catch {
      nnBroken = true;
      evaluator = null;
    }
    return evaluator;
  }

  // What the network needs to know about the game: the board, whose turn, the ko point,
  // the moves so far and the boards before the last two moves (for its ladder inputs).
  function positionFromGame(game) {
    const size = game.size, n = game.moves.length;
    return {
      size,
      board: Int8Array.from(game.board),
      toPlay: game.turn,
      ko: koPointOf(game),
      moves: game.moves.slice(-6).map((m) => ({ color: m.color, at: m.pass ? -1 : m.y * size + m.x })),
      boards: [n >= 1 ? game.boardAfter(n - 1) : game.board, n >= 2 ? game.boardAfter(n - 2) : game.board].map((b) => Int8Array.from(b)),
    };
  }

  // Resolves to { ranked, winRate, lead } (ranked: points best first, -1 = pass), or null
  // if the network can't run here (then the caller uses the old search).
  async function nnSearch(game, thinkMs, isCancelled) {
    const current = getEvaluator();
    if (!current) return null;
    try {
      const result = await window.GoDragonSearch.search(current, positionFromGame(game), thinkMs, isCancelled);
      nnReady = true;
      if (isCancelled()) return { ranked: [], winRate: 0, cancelled: true };
      return { ranked: result.moves.map((m) => m.move), winRate: result.moves.length ? result.moves[0].win : 0, lead: result.rootLead };
    } catch {
      nnBroken = true;
      return null;
    }
  }

  function monteCarlo(board, color, last, thinkMs, isCancelled) {
    const current = getPool();
    if (!current) return searchOnPage(board, color, last, thinkMs, isCancelled);
    return searchWithWorkers(current, board, color, last, thinkMs, isCancelled)
      .then((result) => result || searchOnPage(board, color, last, thinkMs, isCancelled));
  }

  function leadsOnCount(game, color) {
    const s = game.score();
    return color === BLACK ? s.black > s.white : s.white > s.black;
  }

  // Resolves to { pass: true } or { moves: [{x, y}, ...] } best first.
  // The page tries them in order, in case the game's rules reject one.
  function chooseBotMove(game, levelNumber, isCancelled) {
    const level = BOT_LEVELS[levelNumber - 1], color = game.turn;
    const board = FastBoard.fromGame(game);
    const lastMove = typeof game.lastMove === "number" ? game.lastMove : -1;
    const opponentPassed = game.lastMove === "pass";
    const toResult = (ranked) => ranked.length
      ? { moves: ranked.map((i) => ({ x: i % game.size, y: Math.floor(i / game.size) })) }
      : { pass: true };

    // Dragon (and Hint) think with the neural network when it can run here; its search
    // decides about passing itself. If the network can't run, use the old search below.
    if (level.neural) {
      return nnSearch(game, level.thinkMs, isCancelled).then((result) => {
        if (!result) return chooseWithoutNetwork();
        if (result.cancelled) return { moves: [] };
        const { ranked } = result;
        if (!ranked.length || ranked[0] === -1) return { pass: true };
        return toResult(ranked.filter((i) => i >= 0));
      });
    }
    return chooseWithoutNetwork();

    function chooseWithoutNetwork() {
      // If you pass and the bot is already ahead, it passes too and the game ends.
      if (opponentPassed && leadsOnCount(game, color)) return delay(300).then(() => ({ pass: true }));
      return level.thinkMs ? searchMove() : thumbMove();
    }

    function thumbMove() {
      return delay(350).then(() => {
        if (opponentPassed && game.moveNumber > board.n / 2) return { pass: true };
        return toResult(rankByRulesOfThumb(board, color, lastMove, level.noise));
      });
    }

    function searchMove() {
      return monteCarlo(board, color, lastMove, level.thinkMs, isCancelled).then(({ ranked, winRate }) => {
        // Behind and you passed with no real chance left: accept the result.
        if (opponentPassed && winRate < 0.15) return { pass: true };
        return toResult(ranked);
      });
    }
  }

  // True until Dragon's network has answered once on this page (it may still be downloading).
  const brainLoading = () => !nnReady && !nnBroken;

  window.GoBot = { BOT_LEVELS, chooseBotMove, FastBoard, searchInWorker, brainLoading, dragonEvaluator: getEvaluator };
})();
