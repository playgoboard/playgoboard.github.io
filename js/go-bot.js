// Computer opponents. Levels 1-3 score every move with Go rules of thumb (with
// random mistakes mixed in). Levels 4-5 also play thousands of quick random games
// from the current position and pick the move that wins most often
// ("Monte Carlo tree search"). The thinking is done in small time slices so the
// page never freezes.
(function () {
  const { EMPTY, BLACK, WHITE, KOMI, otherColor } = window.Go;

  const BOT_LEVELS = [
    { level: 1, name: "Pebble", blurb: "Just learned the rules.", noise: 25 },
    { level: 2, name: "Sprout", blurb: "Grabs stones when it can.", noise: 7 },
    { level: 3, name: "Fox", blurb: "Protects its stones, sets traps.", noise: 1.5 },
    { level: 4, name: "Tiger", blurb: "Reads ahead for about a second.", thinkMs: 1200 },
    { level: 5, name: "Dragon", blurb: "Thinks hard, a few seconds a move.", thinkMs: 4000 },
  ];

  // Search tuning. Prior visits let the rules of thumb steer the search early on.
  const PRIOR_VISITS = 6;
  const EXPAND_AFTER = 2;
  const EXPLORATION = 0.5;
  const SLICE_MS = 30;

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

    randomMove(color) {
      const count = this.emptyCount, start = Math.floor(Math.random() * count);
      for (let k = 0; k < count; k++) {
        const i = this.empties[(start + k) % count];
        if (!this.isEye(i, color) && this.isLegal(i, color)) return i;
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

    // Plays random moves until both sides run out, then returns black minus white (no komi).
    playout(color, last) {
      let passes = 0, moves = 0;
      const limit = this.n * 3;
      while (passes < 2 && moves < limit) {
        let move = this.captureNear(last, color);
        if (move < 0) move = this.randomMove(color);
        if (move < 0) passes++;
        else { passes = 0; this.play(move, color); }
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

  // ---- Monte Carlo tree search ----

  function expand(node, board, scratch, color, last) {
    node.children = candidateMoves(board, color, true).map((i) => {
      const prior = clamp(0.5 + evaluateMove(board, scratch, i, color, last) / 24, 0.1, 0.9);
      return { move: i, color, wins: prior * PRIOR_VISITS, visits: PRIOR_VISITS, children: null };
    });
  }

  function selectChild(node) {
    const logN = Math.log(node.visits + 1);
    let best = null, bestValue = -Infinity;
    for (const child of node.children) {
      const value = child.wins / child.visits + EXPLORATION * Math.sqrt(logN / child.visits);
      if (value > bestValue) { bestValue = value; best = child; }
    }
    return best;
  }

  function runIteration(root, rootBoard, work, scratch, rootColor, rootLast) {
    work.copyFrom(rootBoard);
    let node = root, color = rootColor, last = rootLast;
    const path = [root];
    const step = (child) => {
      work.play(child.move, color);
      last = child.move;
      color = otherColor(color);
      path.push(child);
      return child;
    };

    while (node.children && node.children.length) node = step(selectChild(node));
    if (node.children === null && node.visits >= PRIOR_VISITS + EXPAND_AFTER) {
      expand(node, work, scratch, color, last);
      if (node.children.length) node = step(selectChild(node));
    }

    const winner = work.playout(color, last) - KOMI > 0 ? BLACK : WHITE;
    for (const n of path) {
      n.visits++;
      if (n.color === winner) n.wins++;
    }
  }

  function monteCarlo(rootBoard, rootColor, rootLast, thinkMs, isCancelled) {
    const root = { move: -1, color: otherColor(rootColor), wins: 0, visits: 0, children: null };
    const work = new FastBoard(rootBoard.size), scratch = new FastBoard(rootBoard.size);
    expand(root, rootBoard, scratch, rootColor, rootLast);
    const deadline = performance.now() + thinkMs;

    return new Promise((resolve) => {
      const slice = () => {
        if (isCancelled()) return resolve({ ranked: [], winRate: 0 });
        const end = Math.min(performance.now() + SLICE_MS, deadline);
        do runIteration(root, rootBoard, work, scratch, rootColor, rootLast);
        while (performance.now() < end);
        if (performance.now() < deadline) return setTimeout(slice, 0);
        const kids = root.children.slice().sort((a, b) => b.visits - a.visits);
        resolve({ ranked: kids.map((k) => k.move), winRate: kids.length ? kids[0].wins / kids[0].visits : 0 });
      };
      setTimeout(slice, 0);
    });
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

    // If you pass and the bot is already ahead, it passes too and the game ends.
    if (opponentPassed && leadsOnCount(game, color)) return delay(300).then(() => ({ pass: true }));

    if (!level.thinkMs) {
      return delay(350).then(() => {
        if (opponentPassed && game.moveNumber > board.n / 2) return { pass: true };
        return toResult(rankByRulesOfThumb(board, color, lastMove, level.noise));
      });
    }
    return monteCarlo(board, color, lastMove, level.thinkMs, isCancelled).then(({ ranked, winRate }) => {
      // Behind and you passed with no real chance left: accept the result.
      if (opponentPassed && winRate < 0.15) return { pass: true };
      return toResult(ranked);
    });
  }

  window.GoBot = { BOT_LEVELS, chooseBotMove };
})();
