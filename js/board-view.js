// Draws a Go board as SVG. Used by the game page and the puzzle page.
(function () {
  const { EMPTY, BLACK } = window.Go;
  const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go boards skip the letter I
  const STAR_POINTS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };

  function stoneSvg(x, y, color, extraAttrs = "") {
    const fill = color === BLACK ? "url(#stone-black)" : "url(#stone-white)";
    return `<circle cx="${x + 1}" cy="${y + 1}" r="0.47" fill="${fill}" ${extraAttrs}/>`;
  }

  // view: { size, board, dead?, territory?, lastMove?, hint?, ghostColor? (null = no hover stones), marks? }
  // marks: [{ x, y, kind: "target" | "good" | "bad" }] small symbols drawn on points.
  function renderBoard(view) {
    const s = view.size, end = s, parts = [];
    const dead = view.dead || new Set();
    parts.push(`<svg viewBox="0 0 ${s + 1} ${s + 1}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="stone-black" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#5a5a5a"/><stop offset="1" stop-color="#050505"/>
        </radialGradient>
        <radialGradient id="stone-white" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c8c8c8"/>
        </radialGradient>
      </defs>
      <rect width="${s + 1}" height="${s + 1}" fill="var(--wood)"/>`);

    for (let k = 1; k <= s; k++) {
      parts.push(`<line x1="1" y1="${k}" x2="${end}" y2="${k}" stroke="var(--line)" stroke-width="0.04"/>`);
      parts.push(`<line x1="${k}" y1="1" x2="${k}" y2="${end}" stroke="var(--line)" stroke-width="0.04"/>`);
    }
    for (const sx of STAR_POINTS[s]) for (const sy of STAR_POINTS[s]) {
      parts.push(`<circle cx="${sx + 1}" cy="${sy + 1}" r="0.1" fill="var(--line)"/>`);
    }

    const label = (x, y, text) =>
      `<text x="${x}" y="${y}" font-size="0.33" fill="var(--line)" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${text}</text>`;
    for (let k = 0; k < s; k++) {
      parts.push(label(k + 1, 0.4, COLUMN_LETTERS[k]), label(k + 1, s + 0.6, COLUMN_LETTERS[k]));
      parts.push(label(0.4, k + 1, s - k), label(s + 0.6, k + 1, s - k));
    }

    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = y * s + x, color = view.board[i];
      if (color !== EMPTY) parts.push(stoneSvg(x, y, color, dead.has(i) ? 'opacity="0.35"' : ""));
      const owner = view.territory ? view.territory[i] : EMPTY;
      if (owner !== EMPTY && (color === EMPTY || dead.has(i))) {
        const fill = owner === BLACK ? "#000" : "#fff";
        parts.push(`<rect x="${x + 0.8}" y="${y + 0.8}" width="0.4" height="0.4" fill="${fill}" stroke="#555" stroke-width="0.02"/>`);
      }
    }

    if (view.lastMove !== null && view.lastMove !== undefined) {
      const lx = view.lastMove % s, ly = Math.floor(view.lastMove / s);
      const ring = view.board[view.lastMove] === BLACK ? "#fff" : "#000";
      parts.push(`<circle cx="${lx + 1}" cy="${ly + 1}" r="0.22" fill="none" stroke="${ring}" stroke-width="0.06"/>`);
    }

    for (const mark of view.marks || []) {
      const cx = mark.x + 1, cy = mark.y + 1;
      if (mark.kind === "target") {
        parts.push(`<rect x="${cx - 0.13}" y="${cy - 0.13}" width="0.26" height="0.26" fill="#c0504d"/>`);
      } else if (mark.kind === "good") {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="0.42" fill="none" stroke="#81b64c" stroke-width="0.09"/>`);
      } else if (mark.kind === "bad") {
        parts.push(`<path d="M${cx - 0.22} ${cy - 0.22}L${cx + 0.22} ${cy + 0.22}M${cx + 0.22} ${cy - 0.22}L${cx - 0.22} ${cy + 0.22}" stroke="#c0504d" stroke-width="0.09"/>`);
      }
    }

    if (view.hint) {
      parts.push(`<circle cx="${view.hint.x + 1}" cy="${view.hint.y + 1}" r="0.42" fill="rgba(129,182,76,0.45)" stroke="#5d8a32" stroke-width="0.07"/>`);
    }

    // Invisible click targets, one per point, with a see-through "ghost" stone on hover.
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const showGhost = view.ghostColor && view.board[y * s + x] === EMPTY;
      parts.push(`<g class="spot" data-x="${x}" data-y="${y}">
        <rect x="${x + 0.5}" y="${y + 0.5}" width="1" height="1" fill="transparent"/>
        ${showGhost ? stoneSvg(x, y, view.ghostColor, 'class="ghost"') : ""}
      </g>`);
    }

    parts.push("</svg>");
    return parts.join("");
  }

  window.GoBoardView = { renderBoard, COLUMN_LETTERS };
})();
