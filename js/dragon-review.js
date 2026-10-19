// Dragon's Review: after a game, the neural-network Dragon looks at every position and
// labels each move by how much it lowered the mover's win chance. Used on the game page
// and on Leaderboard replays. GoBoard's own names and look: Good / Slip / Mistake / Big mistake.
(function () {
  const { t } = window.GoI18n;
  const LETTERS = "ABCDEFGHJKLMNOPQRST";
  const VISITS = { 9: 40, 13: 20, 19: 12 }; // looks per position: more on small boards, where they're cheap
  const LABELS = [
    { id: "good", limit: 0.03, mark: "✓", name: "Good" },
    { id: "slip", limit: 0.10, mark: "~", name: "Slip" },
    { id: "mistake", limit: 0.20, mark: "?", name: "Mistake" },
    { id: "big", limit: Infinity, mark: "??", name: "Big mistake" },
  ];
  const labelById = Object.fromEntries(LABELS.map((l) => [l.id, l]));

  const pointName = (at, size) => (at < 0 ? t("Pass") : `${LETTERS[at % size]}${size - Math.floor(at / size)}`);
  const colorWord = (color) => (color === 1 ? t("Black") : t("White"));
  const percent = (x) => `${Math.round(x * 100)}%`;

  // The positions before each move and after the last one, as the network sees them.
  function positionsFor(size, startBoard, moves) {
    let pos = {
      size, board: Int8Array.from(startBoard), toPlay: moves.length ? moves[0].color : 1,
      ko: -1, moves: [], boards: [],
    };
    const positions = [pos], played = [];
    for (const m of moves) {
      const at = m.pass ? -1 : m.y * size + m.x;
      const next = window.GoNN.play(pos, at);
      if (!next) break; // shouldn't happen for a real game
      played.push({ color: m.color, at });
      positions.push(next);
      pos = next;
    }
    return { positions, played };
  }

  // Resolves to the review, or null if cancelled. Throws if Dragon can't run here.
  async function analyze({ size, startBoard, moves, onProgress, isCancelled }) {
    const evaluator = window.GoBot && window.GoBot.dragonEvaluator && window.GoBot.dragonEvaluator();
    if (!evaluator || !window.GoDragonSearch || !window.GoNN) throw new Error("Dragon can't think in this browser");
    const { positions, played } = positionsFor(size, startBoard, moves);
    const results = new Array(positions.length);
    const visits = VISITS[size] || 12;
    let next = 0, done = 0;
    async function reviewer() {
      while (next < positions.length && !isCancelled()) {
        const i = next++;
        const r = await window.GoDragonSearch.search(evaluator, positions[i], 600000, isCancelled, visits);
        results[i] = { win: r.rootQ, best: r.moves.length ? r.moves[0].move : null, toPlay: positions[i].toPlay };
        onProgress(++done / positions.length);
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.ceil(evaluator.size / 2)) }, reviewer));
    if (isCancelled()) return null;

    const blackWin = results.map((r) => (r.toPlay === 1 ? r.win : 1 - r.win));
    const reviewed = played.map((m, k) => {
      const before = results[k].win;
      const after = 1 - results[k + 1].win;
      const drop = Math.max(0, before - after);
      // Once a game is decided either way, small swings don't matter.
      const decided = (before > 0.97 && after > 0.97) || (before < 0.03 && after < 0.03);
      const label = decided ? LABELS[0] : LABELS.find((l) => drop < l.limit);
      return { color: m.color, at: m.at, before, after, label: label.id, best: results[k].best, agrees: results[k].best === m.at };
    });
    const summary = { 1: {}, 2: {} };
    for (const c of [1, 2]) for (const l of LABELS) summary[c][l.id] = 0;
    for (const m of reviewed) summary[m.color][m.label]++;
    return { size, blackWin, moves: reviewed, summary };
  }

  // ---- The review panel ----

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Fills box with the summary, the graph and a line about the shown move.
  // onPick(count) is called when the graph is clicked (count = moves to show).
  function renderPanel(box, review, onPick) {
    box.textContent = "";
    box.append(element("h2", "", t("Dragon's Review")));

    const summary = element("table", "review-summary");
    const head = element("tr");
    head.append(element("th", "", ""));
    for (const l of LABELS) {
      const th = element("th", `rv-${l.id}`, l.mark);
      th.title = t(l.name);
      head.append(th);
    }
    summary.append(head);
    for (const color of [1, 2]) {
      const row = element("tr");
      row.append(element("td", "", colorWord(color)));
      for (const l of LABELS) row.append(element("td", `rv-${l.id}`, String(review.summary[color][l.id])));
      summary.append(row);
    }
    const legend = element("p", "review-legend", LABELS.map((l) => `${l.mark} ${t(l.name)}`).join("  ·  "));

    // Black's win chance after each move: high = good for Black.
    const n = review.blackWin.length;
    const W = 300, H = 90;
    const x = (k) => (n <= 1 ? 0 : (k / (n - 1)) * W);
    const y = (p) => H - p * H;
    const points = review.blackWin.map((p, k) => `${x(k).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
    const dots = review.moves.map((m, k) => (m.label === "mistake" || m.label === "big")
      ? `<circle cx="${x(k + 1).toFixed(1)}" cy="${y(review.blackWin[k + 1]).toFixed(1)}" r="2.6" class="rv-dot rv-${m.label}"/>` : "").join("");
    const graph = element("div", "review-graph");
    graph.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect width="${W}" height="${H / 2}" class="rv-black-half"/>
        <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="rv-mid"/>
        <polygon points="0,${H} ${points} ${W},${H}" class="rv-area"/>
        <polyline points="${points}" class="rv-line" vector-effect="non-scaling-stroke"/>
        ${dots}
        <line class="rv-cursor" x1="0" y1="0" x2="0" y2="${H}" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="review-graph-labels"><span>${t("Black ahead")}</span><span>${t("White ahead")}</span></div>`;
    graph.addEventListener("click", (event) => {
      const rect = graph.querySelector("svg").getBoundingClientRect();
      const k = Math.round(((event.clientX - rect.left) / rect.width) * (n - 1));
      onPick(Math.max(0, Math.min(n - 1, k)));
    });
    const info = element("p", "review-info");
    box.append(summary, legend, graph, info);

    // count = how many moves the board shows; the note is about the last of them.
    function show(count) {
      const cursor = graph.querySelector(".rv-cursor");
      cursor.setAttribute("x1", x(count));
      cursor.setAttribute("x2", x(count));
      if (count < 1) {
        info.textContent = t("Click a move or the graph to see Dragon's notes. Dots on the graph mark mistakes.");
        return;
      }
      const m = review.moves[count - 1];
      if (!m) return;
      const l = labelById[m.label];
      const parts = [
        t("Move {n} ({color}, {point}): {label} {mark}", { n: count, color: colorWord(m.color), point: pointName(m.at, review.size), label: t(l.name), mark: l.mark }),
        t("{color}'s win chance: {before} → {after}.", { color: colorWord(m.color), before: percent(m.before), after: percent(m.after) }),
      ];
      if (m.agrees || m.best === null) parts.push(t("Dragon agrees with this move."));
      else if (m.best < 0) parts.push(t("Dragon would have passed."));
      else if (m.label === "good") parts.push(t("Dragon's favorite was {point} (green circle), but this move is fine too.", { point: pointName(m.best, review.size) }));
      else parts.push(t("Dragon prefers {point} (green circle).", { point: pointName(m.best, review.size) }));
      info.textContent = parts.join(" ");
    }
    return { show };
  }

  // The green circle for the move shown (Dragon's choice instead of it), or null.
  function suggestion(review, count) {
    const m = review && count >= 1 ? review.moves[count - 1] : null;
    if (!m || m.agrees || m.best === null || m.best < 0) return null;
    return { x: m.best % review.size, y: Math.floor(m.best / review.size) };
  }

  // Labels for the move list (js/move-list.js).
  const moveLabels = (review) => review.moves.map((m) => ({ id: m.label, mark: labelById[m.label].mark }));

  window.GoReview = { analyze, renderPanel, suggestion, moveLabels };
})();
