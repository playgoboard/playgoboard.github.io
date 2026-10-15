// A small reading engine for capture puzzles: "can Black capture one of the target
// groups within N moves, whatever White does?" It looks only at moves that matter
// in a fight (liberties, points next to liberties, saving or counter-capturing), which
// is how people read ladders, nets and races too.
(function () {
  const { EMPTY, BLACK, WHITE } = window.Go;
  const { FastBoard } = window.GoBot;
  const NODE_LIMIT = 200000; // safety stop so the page can never freeze

  // Everything about the group at `point`: its stones and its liberties.
  function groupInfo(board, point) {
    const color = board.cells[point], stones = [point], libs = new Set(), seen = new Set([point]);
    for (let k = 0; k < stones.length; k++) {
      for (const nb of board.nbrs[stones[k]]) {
        if (board.cells[nb] === EMPTY) libs.add(nb);
        else if (board.cells[nb] === color && !seen.has(nb)) { seen.add(nb); stones.push(nb); }
      }
    }
    return { color, stones, libs: [...libs] };
  }

  // Target groups still on the board (each target is one stone of a white group).
  function liveTargets(board, targets) {
    const groups = [], counted = new Set();
    for (const t of targets) {
      if (board.cells[t] !== WHITE || counted.has(t)) continue;
      const info = groupInfo(board, t);
      info.stones.forEach((s) => counted.add(s));
      groups.push(info);
    }
    return groups;
  }

  class Reader {
    constructor(targets) {
      this.targets = targets;
      this.nodes = 0;
      this.memo = new Map();
    }

    key(board, blackToMove, movesLeft) {
      return `${blackToMove ? "b" : "w"}${movesLeft}${board.ko}|${board.cells.join("")}`;
    }

    // True if Black can force a capture. Black has `movesLeft` moves to do it.
    blackWins(board, blackToMove, movesLeft) {
      if (this.targetCaptured(board)) return true;
      const groups = liveTargets(board, this.targets);
      if (++this.nodes > NODE_LIMIT) return false;
      const memoKey = this.key(board, blackToMove, movesLeft);
      if (this.memo.has(memoKey)) return this.memo.get(memoKey);
      const result = blackToMove ? this.blackTurn(board, groups, movesLeft) : this.whiteTurn(board, groups, movesLeft);
      this.memo.set(memoKey, result);
      return result;
    }

    targetCaptured(board) {
      return this.targets.some((t) => board.cells[t] !== WHITE);
    }

    blackCandidates(board, groups, movesLeft) {
      const moves = new Set();
      for (const g of groups) {
        if (g.libs.length > movesLeft) continue; // can't be caught in time
        for (const lib of g.libs) {
          moves.add(lib);
          if (g.libs.length !== 2) continue;
          for (const nb of board.nbrs[lib]) if (board.cells[nb] === EMPTY) moves.add(nb); // net-style moves
        }
        // Rescue Black stones next to the target that are about to be captured.
        for (const s of g.stones) for (const nb of board.nbrs[s]) {
          if (board.cells[nb] !== BLACK) continue;
          const mine = groupInfo(board, nb);
          if (mine.libs.length === 1) moves.add(mine.libs[0]);
        }
      }
      return [...moves].filter((m) => board.isLegal(m, BLACK));
    }

    blackTurn(board, groups, movesLeft) {
      if (movesLeft <= 0) return false;
      // A target with one liberty can simply be taken.
      for (const g of groups) if (g.libs.length === 1 && board.isLegal(g.libs[0], BLACK)) return true;
      // Each Black move takes away at most one liberty, so more liberties than moves left means escape.
      if (groups.every((g) => g.libs.length > movesLeft)) return false;
      for (const move of this.blackCandidates(board, groups, movesLeft)) {
        const next = new FastBoard(board.size);
        next.copyFrom(board);
        next.play(move, BLACK);
        if (this.blackWins(next, false, movesLeft - 1)) return true;
      }
      return false;
    }

    whiteCandidates(board, groups) {
      const moves = new Set();
      for (const g of groups) {
        g.libs.forEach((lib) => moves.add(lib)); // run away
        for (const s of g.stones) for (const nb of board.nbrs[s]) {
          if (board.cells[nb] !== BLACK) continue;
          const attacker = groupInfo(board, nb);
          if (attacker.libs.length <= 2) attacker.libs.forEach((lib) => moves.add(lib)); // fight back
        }
      }
      return [...moves].filter((m) => board.isLegal(m, WHITE));
    }

    whiteTurn(board, groups, movesLeft) {
      for (const move of this.whiteCandidates(board, groups)) {
        const next = new FastBoard(board.size);
        next.copyFrom(board);
        next.play(move, WHITE);
        if (!this.blackWins(next, true, movesLeft)) return false; // White found an escape
      }
      // White can't help: if passing doesn't help either, Black wins.
      return this.blackWins(board, true, movesLeft);
    }

    // The defence that holds out longest (used for White's reply in the puzzle).
    bestWhiteReply(board, movesLeft) {
      const groups = liveTargets(board, this.targets);
      let best = null, bestNeeded = -1;
      for (const move of this.whiteCandidates(board, groups)) {
        const next = new FastBoard(board.size);
        next.copyFrom(board);
        next.play(move, WHITE);
        let needed = movesLeft + 1;
        for (let n = 1; n <= movesLeft; n++) {
          this.memo.clear();
          if (this.blackWins(next, true, n)) { needed = n; break; }
        }
        if (needed > bestNeeded) { bestNeeded = needed; best = move; }
      }
      return best; // null = White has nothing useful (the puzzle answer just takes)
    }
  }

  function boardFromDiagram(rows) {
    const size = rows.length, cells = [];
    for (const row of rows) for (const ch of row) cells.push(ch === "X" ? BLACK : ch === "O" ? WHITE : EMPTY);
    return new FastBoard(size, cells);
  }

  // Does Black's move at `point` (on `board`) still force the capture within movesLeft moves (this one included)?
  function moveWins(board, targets, point, movesLeft) {
    if (!board.isLegal(point, BLACK)) return false;
    const next = new FastBoard(board.size);
    next.copyFrom(board);
    next.play(point, BLACK);
    const reader = new Reader(targets);
    return reader.blackWins(next, false, movesLeft - 1);
  }

  function whiteReply(board, targets, movesLeft) {
    return new Reader(targets).bestWhiteReply(board, movesLeft);
  }

  window.GoPuzzleSolver = { boardFromDiagram, moveWins, whiteReply, groupInfo };
})();
