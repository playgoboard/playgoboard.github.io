// The rules of Go, kept separate from the drawing code so the bot and online
// play can reuse them later. Loaded as a plain script so index.html works
// when opened straight from disk (no server needed).
(function () {
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  // Area scoring (Chinese rules) uses 7.5 komi; the .5 means no draws.
  const KOMI = 7.5;

  function otherColor(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  class GoGame {
    constructor(size) {
      this.size = size;
      this.board = new Array(size * size).fill(EMPTY);
      this.turn = BLACK;
      this.captures = { [BLACK]: 0, [WHITE]: 0 };
      this.passesInRow = 0;
      this.lastMove = null;   // board index, "pass", or null
      this.moveNumber = 0;
      this.phase = "play";    // "play" -> "scoring" -> "over"
      this.dead = new Set();  // stones marked dead while scoring
      this.result = null;
      this.history = [];      // snapshots taken before each move, for undo and ko
    }

    index(x, y) {
      return y * this.size + x;
    }

    neighbors(i) {
      const s = this.size, x = i % s, y = Math.floor(i / s), out = [];
      if (x > 0) out.push(i - 1);
      if (x < s - 1) out.push(i + 1);
      if (y > 0) out.push(i - s);
      if (y < s - 1) out.push(i + s);
      return out;
    }

    // All connected stones of one color starting at i, plus their empty neighbors.
    groupAt(board, i) {
      const color = board[i], stones = [i], seen = new Set([i]), liberties = new Set();
      for (let k = 0; k < stones.length; k++) {
        for (const n of this.neighbors(stones[k])) {
          if (board[n] === EMPTY) liberties.add(n);
          else if (board[n] === color && !seen.has(n)) {
            seen.add(n);
            stones.push(n);
          }
        }
      }
      return { stones, liberties };
    }

    snapshot() {
      return {
        board: this.board.slice(),
        turn: this.turn,
        captures: { ...this.captures },
        passesInRow: this.passesInRow,
        lastMove: this.lastMove,
        moveNumber: this.moveNumber,
      };
    }

    restore(snap) {
      Object.assign(this, snap, { board: snap.board.slice(), captures: { ...snap.captures } });
    }

    // Returns { ok: true } or { ok: false, reason: "occupied" | "suicide" | "ko" | "not-playing" }.
    play(x, y) {
      if (this.phase !== "play") return { ok: false, reason: "not-playing" };
      const i = this.index(x, y);
      if (this.board[i] !== EMPTY) return { ok: false, reason: "occupied" };

      const me = this.turn, them = otherColor(me);
      const next = this.board.slice();
      next[i] = me;

      let captured = 0;
      for (const n of this.neighbors(i)) {
        if (next[n] !== them) continue;
        const group = this.groupAt(next, n);
        if (group.liberties.size === 0) {
          for (const s of group.stones) next[s] = EMPTY;
          captured += group.stones.length;
        }
      }

      if (this.groupAt(next, i).liberties.size === 0) return { ok: false, reason: "suicide" };

      // Ko: you may not recreate the position from right before your opponent's last move.
      const before = this.history[this.history.length - 1];
      if (before && before.board.join("") === next.join("")) return { ok: false, reason: "ko" };

      this.history.push(this.snapshot());
      this.board = next;
      this.captures[me] += captured;
      this.lastMove = i;
      this.passesInRow = 0;
      this.moveNumber++;
      this.turn = them;
      return { ok: true, captured };
    }

    pass() {
      if (this.phase !== "play") return;
      this.history.push(this.snapshot());
      this.passesInRow++;
      this.lastMove = "pass";
      this.moveNumber++;
      this.turn = otherColor(this.turn);
      if (this.passesInRow >= 2) this.phase = "scoring";
    }

    resign() {
      if (this.phase === "over") return;
      this.phase = "over";
      this.result = { winner: otherColor(this.turn), byResignation: true };
    }

    canUndo() {
      return this.history.length > 0 && this.phase !== "over";
    }

    undo() {
      if (!this.canUndo()) return;
      this.restore(this.history.pop());
      this.phase = "play";
      this.dead.clear();
    }

    // Scoring phase: click a group to mark it dead (or alive again).
    toggleDead(x, y) {
      if (this.phase !== "scoring") return;
      const i = this.index(x, y);
      if (this.board[i] === EMPTY) return;
      const { stones } = this.groupAt(this.board, i);
      const makeDead = !this.dead.has(i);
      for (const s of stones) makeDead ? this.dead.add(s) : this.dead.delete(s);
    }

    // Players disagree about the score: go back to playing.
    resumePlay() {
      if (this.phase !== "scoring") return;
      this.phase = "play";
      this.passesInRow = 0;
      this.dead.clear();
    }

    finishScoring() {
      if (this.phase !== "scoring") return;
      const s = this.score();
      this.phase = "over";
      this.result = { winner: s.winner, margin: s.margin, black: s.black, white: s.white };
    }

    // Area scoring: your stones on the board + empty points only you surround.
    score() {
      const n = this.board.length;
      const b = this.board.map((c, i) => (this.dead.has(i) ? EMPTY : c));
      const territory = new Array(n).fill(EMPTY);
      const seen = new Uint8Array(n);

      for (let i = 0; i < n; i++) {
        if (b[i] !== EMPTY || seen[i]) continue;
        const region = [i], borders = new Set();
        seen[i] = 1;
        for (let k = 0; k < region.length; k++) {
          for (const nb of this.neighbors(region[k])) {
            if (b[nb] === EMPTY) {
              if (!seen[nb]) { seen[nb] = 1; region.push(nb); }
            } else borders.add(b[nb]);
          }
        }
        if (borders.size === 1) {
          const owner = [...borders][0];
          for (const r of region) territory[r] = owner;
        }
      }

      let black = 0, white = KOMI;
      for (let i = 0; i < n; i++) {
        const owner = b[i] !== EMPTY ? b[i] : territory[i];
        if (owner === BLACK) black++;
        else if (owner === WHITE) white++;
      }
      const winner = black > white ? BLACK : WHITE;
      return { black, white, territory, winner, margin: Math.abs(black - white) };
    }
  }

  window.Go = { GoGame, EMPTY, BLACK, WHITE, KOMI, otherColor };
})();
