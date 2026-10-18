// Turns a Go position into the input the neural-network Dragon expects (KataGo's input
// version 7, as in KataGo's nninputs.cpp, MIT license: https://github.com/lightvector/KataGo).
// Our rules: area scoring, simple ko, no suicide, komi 7.5. Checked against the official
// KataGo program with tools/nn_check.py. Runs on the page and in workers (no DOM).
//
// A position is { size, board (Int8Array: 0 empty, 1 black, 2 white), toPlay (1 or 2),
//   ko (point the player to move may not take, or -1), moves ([{ color, at }], at = -1 for pass),
//   boards (the boards before the last moves, newest first: [before last move, before that]) }.
(function (root) {
  const EMPTY = 0;
  const KOMI = 7.5;
  const NUM_SPATIAL = 22;
  const NUM_GLOBAL = 19;
  const LADDER_NODE_BUDGET = 25000; // like KataGo: give up (not a ladder) after this much reading

  const neighborCache = {};
  function neighbors(size) {
    if (neighborCache[size]) return neighborCache[size];
    const list = [];
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i - x) / size, n = [];
      if (x > 0) n.push(i - 1);
      if (x < size - 1) n.push(i + 1);
      if (y > 0) n.push(i - size);
      if (y < size - 1) n.push(i + size);
      list.push(n);
    }
    return (neighborCache[size] = list);
  }

  // The stones of the group at i and its liberties.
  function group(board, size, i) {
    const nb = neighbors(size), color = board[i];
    const stones = [i], libs = [], seen = new Uint8Array(size * size);
    seen[i] = 1;
    for (let k = 0; k < stones.length; k++) {
      for (const n of nb[stones[k]]) {
        if (seen[n]) continue;
        if (board[n] === EMPTY) { seen[n] = 1; libs.push(n); }
        else if (board[n] === color) { seen[n] = 1; stones.push(n); }
      }
    }
    return { stones, libs };
  }

  // Plays a stone; returns { board, ko } or null if the move isn't allowed (taken, suicide, ko).
  function playStone(board, size, i, color, ko) {
    if (board[i] !== EMPTY || i === ko) return null;
    const nb = neighbors(size), opp = 3 - color;
    const next = board.slice();
    next[i] = color;
    let captured = 0, capturedAt = -1;
    for (const n of nb[i]) {
      if (next[n] !== opp) continue;
      const g = group(next, size, n);
      if (g.libs.length === 0) {
        for (const s of g.stones) next[s] = EMPTY;
        captured += g.stones.length;
        capturedAt = n;
      }
    }
    const own = group(next, size, i);
    if (own.libs.length === 0) return null;
    // Simple ko: a single stone took a single stone and is now alone in atari.
    const newKo = captured === 1 && own.stones.length === 1 && own.libs.length === 1 ? capturedAt : -1;
    return { board: next, ko: newKo };
  }

  // A move (point, or -1 to pass) applied to a position; null if illegal.
  function play(pos, at) {
    const moves = pos.moves.concat([{ color: pos.toPlay, at }]);
    const boards = [pos.board, pos.boards[0] || pos.board];
    if (at < 0) return { size: pos.size, board: pos.board, toPlay: 3 - pos.toPlay, ko: -1, moves, boards };
    const result = playStone(pos.board, pos.size, at, pos.toPlay, pos.ko);
    if (!result) return null;
    return { size: pos.size, board: result.board, toPlay: 3 - pos.toPlay, ko: result.ko, moves, boards };
  }

  function isLegal(pos, at) {
    return at < 0 || playStone(pos.board, pos.size, at, pos.toPlay, pos.ko) !== null;
  }

  // Area: stones plus empty regions that touch only one color. Black minus white (no komi).
  function areaOwners(board, size) {
    const nb = neighbors(size), owner = Int8Array.from(board), seen = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      if (board[i] !== EMPTY || seen[i]) continue;
      const region = [i];
      let touches = 0;
      seen[i] = 1;
      for (let k = 0; k < region.length; k++) {
        for (const n of nb[region[k]]) {
          if (board[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
          else touches |= board[n];
        }
      }
      if (touches === 1 || touches === 2) for (const s of region) owner[s] = touches;
    }
    return owner;
  }

  function areaScore(board, size) {
    let score = 0;
    for (const o of areaOwners(board, size)) score += o === 1 ? 1 : o === 2 ? -1 : 0;
    return score;
  }

  // ---- Ladders (KataGo's searchIsLadderCaptured, written as recursion) ----

  function immediateLibs(board, size, i) {
    let n = 0;
    for (const a of neighbors(size)[i]) if (board[a] === EMPTY) n++;
    return n;
  }

  // Is the group at loc captured by a ladder? defenderToMove: whose turn it is.
  function ladderCaptured(board, size, loc, defenderToMove, ko, budget, depth) {
    const g = group(board, size, loc), libs = g.libs.length;
    const pla = board[loc], opp = 3 - pla;
    if (!defenderToMove) {
      if (libs <= 1) return true;
      if (libs >= 3) return false;
    } else {
      if (libs >= 2) return false;
      if (ko >= 0) return false; // don't count ladders that depend on a ko
    }
    if (depth >= (size * size * 3) / 2) return true;
    if (budget.left <= 0) return null; // out of reading budget: treat as "not a ladder"

    const nb = neighbors(size);
    let moves;
    if (defenderToMove) {
      // Captures of attacker stones in atari next to us, then our lone liberty.
      moves = [];
      const seenHeads = new Set();
      for (const s of g.stones) {
        for (const a of nb[s]) {
          if (board[a] !== opp || seenHeads.has(a)) continue;
          const og = group(board, size, a);
          for (const st of og.stones) seenHeads.add(st);
          if (og.libs.length === 1 && !moves.includes(og.libs[0])) moves.push(og.libs[0]);
        }
      }
      const lone = g.libs[0];
      if (!moves.includes(lone)) moves.push(lone);
      // Quick answers from bounds on the liberties after extending (getBoundNumLibertiesAfterPlay).
      let immediate = 0, caps = 0, capStones = 0, conn = 0, maxConn = 0;
      for (const a of nb[lone]) {
        if (board[a] === EMPTY) immediate++;
        else if (board[a] === opp) {
          const og = group(board, size, a);
          if (og.libs.length === 1) { caps++; capStones += og.stones.length; }
        } else {
          const c = group(board, size, a).libs.length - 1;
          conn += c;
          maxConn = Math.max(maxConn, c);
        }
      }
      if (caps + Math.max(maxConn, immediate) >= 3) return false;
      if (moves.length === 1 && immediate + capStones + conn <= 1) return true;
    } else {
      moves = g.libs.slice(0, 2);
      const libs0 = immediateLibs(board, size, moves[0]), libs1 = immediateLibs(board, size, moves[1]);
      if (!nb[moves[0]].includes(moves[1])) {
        if (libs0 >= 3 && libs1 >= 3) return false;
        if (libs0 >= 3) moves = [moves[1]];
        else if (libs1 >= 3) moves = [moves[0]];
      }
    }

    for (const m of moves) {
      const color = defenderToMove ? pla : opp;
      const result = playStone(board, size, m, color, ko);
      if (!result) continue; // illegal: same as a move that fails
      budget.left--;
      const deeper = ladderCaptured(result.board, size, loc, !defenderToMove, result.ko, budget, depth + 1);
      if (deeper === null) return null;
      if (defenderToMove && !deeper) return false; // the defender found an escape
      if (!defenderToMove && deeper) return true; // the attacker found a working ladder
    }
    return defenderToMove; // defender: every escape failed; attacker: nothing worked
  }

  // Calls mark(stones, workingMoves) for every laddered group (1 or 2 liberties), like iterLadders.
  function forEachLadder(board, size, mark) {
    const done = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      if (board[i] === EMPTY || done[i]) continue;
      const g = group(board, size, i);
      for (const s of g.stones) done[s] = 1;
      const libs = g.libs.length;
      if (libs !== 1 && libs !== 2) continue;
      const budget = { left: LADDER_NODE_BUDGET };
      if (libs === 1) {
        if (ladderCaptured(board, size, i, true, -1, budget, 0) === true) mark(g.stones, []);
      } else {
        const working = [];
        for (const m of g.libs) {
          const r = playStone(board, size, m, 3 - board[i], -1);
          if (!r) continue;
          if (ladderCaptured(r.board, size, i, true, -1, budget, 1) === true) working.push(m);
        }
        if (working.length) mark(g.stones, working);
      }
    }
  }

  // ---- The input planes ----

  function encode(pos, bin, glob) {
    const size = pos.size, n = size * size, board = pos.board;
    const pla = pos.toPlay, opp = 3 - pla;
    bin = bin || new Float32Array(NUM_SPATIAL * n);
    glob = glob || new Float32Array(NUM_GLOBAL);
    bin.fill(0);
    glob.fill(0);
    const set = (feature, i) => { bin[feature * n + i] = 1; };

    const libCount = new Int16Array(n);
    const counted = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      set(0, i);
      if (board[i] === EMPTY) continue;
      set(board[i] === pla ? 1 : 2, i);
      if (!counted[i]) {
        const g = group(board, size, i);
        for (const s of g.stones) { counted[s] = 1; libCount[s] = g.libs.length; }
      }
      const libs = libCount[i];
      if (libs >= 1 && libs <= 3) set(2 + libs, i);
    }
    if (pos.ko >= 0) set(6, pos.ko);

    // Area (stones plus single-color empty regions).
    const owner = areaOwners(board, size);
    for (let i = 0; i < n; i++) {
      if (owner[i] === pla) set(18, i);
      else if (owner[i] === opp) set(19, i);
    }

    // The last 5 moves, newest first, while colors alternate as expected.
    let expect = opp, included = 0;
    for (let k = 0; k < 5 && k < pos.moves.length; k++) {
      const m = pos.moves[pos.moves.length - 1 - k];
      if (m.color !== expect) break;
      if (m.at < 0) glob[k] = 1;
      else set(9 + k, m.at);
      included = k + 1;
      expect = 3 - expect;
    }

    // Ladders now, one move ago and two moves ago.
    forEachLadder(board, size, (stones, working) => {
      for (const s of stones) set(14, s);
      if (board[stones[0]] === opp && libCount[stones[0]] > 1) for (const w of working) set(17, w);
    });
    const prev = included >= 1 && pos.boards[0] ? pos.boards[0] : board;
    forEachLadder(prev, size, (stones) => { for (const s of stones) set(15, s); });
    const prevPrev = included >= 2 && pos.boards[1] ? pos.boards[1] : prev;
    forEachLadder(prevPrev, size, (stones) => { for (const s of stones) set(16, s); });

    const selfKomi = pla === 2 ? KOMI : -KOMI;
    glob[5] = selfKomi / 20;
    const last = pos.moves[pos.moves.length - 1];
    if (last && last.at < 0) glob[14] = 1; // a pass now would end the game
    // Komi parity wave; our board areas are odd, so drawable komis are odd.
    const floor = Math.floor((selfKomi - 1) / 2) * 2 + 1;
    const delta = Math.min(Math.max(selfKomi - floor, 0), 2);
    glob[18] = delta < 0.5 ? delta : delta < 1.5 ? 1 - delta : delta - 2;
    return { bin, glob };
  }

  root.GoNN = { NUM_SPATIAL, NUM_GLOBAL, KOMI, encode, play, isLegal, areaScore, group };
})(typeof self !== "undefined" ? self : window);
