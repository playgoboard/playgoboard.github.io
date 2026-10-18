// The neural-network Dragon's search (used by go-bot.js for Dragon and Hint).
// One search tree on the page; the slow part, running the network, is spread over helpers
// (js/dragon-worker.js), one per spare processor core. The search looks ahead the
// AlphaZero/KataGo way (PUCT): moves the network likes and moves that worked get more looks.
(function () {
  const C_PUCT = 1.1;
  const FPU_REDUCTION = 0.2;  // a move nobody looked at yet counts as a bit worse than its parent
  const BATCH = 4;            // positions sent to a helper together
  const CACHE_LIMIT = 50000;
  const MAX_HELPERS = 8;

  // ---- Helpers ----

  class Evaluator {
    constructor(scriptUrl, modelUrl) {
      const count = Math.max(1, Math.min(MAX_HELPERS, (navigator.hardwareConcurrency || 2) - 1));
      this.modelUrl = modelUrl;
      this.idle = Array.from({ length: count }, () => new Worker(scriptUrl));
      this.size = count;
      this.queue = [];
      this.waiting = new Map();
      this.nextId = 1;
      this.broken = false;
      this.cache = new Map();
      for (const worker of this.idle) {
        worker.onmessage = (event) => this.answer(worker, event.data);
        worker.onerror = () => this.fail("A Dragon helper stopped");
      }
    }

    fail(reason) {
      this.broken = true;
      for (const { reject } of this.waiting.values()) reject(new Error(reason));
      this.waiting.clear();
      for (const job of this.queue) job.reject(new Error(reason));
      this.queue = [];
    }

    answer(worker, data) {
      const job = this.waiting.get(data.id);
      this.waiting.delete(data.id);
      this.idle.push(worker);
      if (job) {
        if (data.error) {
          this.fail(data.error);
          return;
        }
        job.resolve(data.results);
      }
      this.pump();
    }

    pump() {
      while (this.idle.length && this.queue.length) {
        const worker = this.idle.pop(), job = this.queue.shift();
        const id = this.nextId++;
        this.waiting.set(id, job);
        worker.postMessage({ id, modelUrl: this.modelUrl, positions: job.positions.map(pack) });
      }
    }

    // Answers come from the cache when we've seen the position before.
    async evaluate(positions) {
      if (this.broken) throw new Error("Dragon's helpers aren't working");
      const results = new Array(positions.length), todo = [], todoIdx = [];
      positions.forEach((pos, k) => {
        const hit = this.cache.get(positionKey(pos));
        if (hit) results[k] = hit;
        else { todo.push(pos); todoIdx.push(k); }
      });
      if (todo.length) {
        const fresh = await new Promise((resolve, reject) => {
          this.queue.push({ positions: todo, resolve, reject });
          this.pump();
        });
        fresh.forEach((r, j) => {
          if (this.cache.size > CACHE_LIMIT) this.cache.clear();
          this.cache.set(positionKey(todo[j]), r);
          results[todoIdx[j]] = r;
        });
      }
      return results;
    }
  }

  const pack = (pos) => ({
    size: pos.size, board: Array.from(pos.board), toPlay: pos.toPlay, ko: pos.ko,
    moves: pos.moves.slice(-6), boards: pos.boards.map((b) => Array.from(b)),
  });

  function positionKey(pos) {
    const last = pos.moves.slice(-5).map((m) => m.at).join(",");
    return `${pos.size}|${pos.toPlay}|${pos.ko}|${last}|${pos.board.join("")}`;
  }

  // ---- The search tree ----
  // A node's value is the average result (1 = win) for the player who made the move into it.

  const makeNode = (move, prior) => ({ move, prior, visits: 0, valueSum: 0, virtual: 0, children: null, terminal: null });

  function expand(node, evaluation) {
    node.children = evaluation.moves.map((m, j) => makeNode(m, evaluation.priors[j]));
  }

  function select(node) {
    const parentQ = node.visits > 0 ? 1 - node.valueSum / node.visits : 0.5;
    const sqrtN = Math.sqrt(Math.max(1, node.visits + node.virtual));
    let best = null, bestScore = -Infinity;
    for (const child of node.children) {
      const n = child.visits + child.virtual;
      // Virtual visits (paths still waiting for the network) count as losses, so the
      // next path tries something else meanwhile.
      const q = n > 0 ? child.valueSum / n : parentQ - FPU_REDUCTION;
      const score = q + C_PUCT * child.prior * sqrtN / (1 + n);
      if (score > bestScore) { bestScore = score; best = child; }
    }
    return best;
  }

  // Both players passed: count the board as it is.
  function finalResult(pos) {
    const blackWins = window.GoNN.areaScore(pos.board, pos.size) - window.GoNN.KOMI > 0;
    return (pos.toPlay === 1) === blackWins ? 1 : 0; // for the player to move
  }

  // Resolves to { moves: [{ move, visits, win }] best first, rootWin, rootLead }.
  async function search(evaluator, rootPos, thinkMs, isCancelled) {
    const GoNN = window.GoNN;
    const deadline = performance.now() + thinkMs;
    const root = makeNode(null, 1);
    const [rootEval] = await evaluator.evaluate([rootPos]);
    expand(root, rootEval);
    root.visits = 1;
    root.valueSum = 1 - rootEval.win;

    const stillThinking = () => performance.now() < deadline && !isCancelled();

    async function descendBatch() {
      const leaves = [];
      for (let b = 0; b < BATCH; b++) {
        let node = root, pos = rootPos;
        const path = [root];
        while (node.children && node.children.length && node.terminal === null) {
          const child = select(node);
          const next = GoNN.play(pos, child.move);
          if (!next) { child.prior = 0; break; }
          node = child;
          pos = next;
          path.push(node);
          const m = pos.moves;
          if (m.length >= 2 && m[m.length - 1].at < 0 && m[m.length - 2].at < 0) {
            node.terminal = 1 - finalResult(pos);
            break;
          }
        }
        for (const p of path) p.virtual++;
        leaves.push({ node, pos, path });
      }
      const needEval = leaves.filter((l) => l.node.terminal === null && !l.node.children);
      let evals = [];
      try {
        evals = needEval.length ? await evaluator.evaluate(needEval.map((l) => l.pos)) : [];
      } finally {
        if (evals.length !== needEval.length) for (const l of leaves) for (const p of l.path) p.virtual--;
      }
      needEval.forEach((l, j) => {
        if (!l.node.children) expand(l.node, evals[j]);
        l.value = 1 - evals[j].win;
      });
      for (const leaf of leaves) {
        let value = leaf.node.terminal !== null ? leaf.node.terminal
          : leaf.value !== undefined ? leaf.value : leaf.node.valueSum / Math.max(1, leaf.node.visits);
        for (let k = leaf.path.length - 1; k >= 0; k--) {
          const p = leaf.path[k];
          p.virtual--;
          p.visits++;
          p.valueSum += value;
          value = 1 - value;
        }
      }
    }

    // One loop per helper keeps every helper busy.
    await Promise.all(Array.from({ length: evaluator.size }, async () => {
      while (stillThinking()) await descendBatch();
    }));

    const moves = root.children.filter((c) => c.visits > 0)
      .map((c) => ({ move: c.move, visits: c.visits, win: c.valueSum / c.visits }))
      .sort((a, b) => b.visits - a.visits);
    return { moves, rootWin: rootEval.win, rootLead: rootEval.lead, visits: root.visits };
  }

  window.GoDragonSearch = { Evaluator, search };
})();
