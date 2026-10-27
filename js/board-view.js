// Draws a Go board as SVG. Used by the game page and the puzzle page.
(function () {
  const { EMPTY, BLACK } = window.Go;
  const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go boards skip the letter I
  const STAR_POINTS = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };

  // Stone colors come from CSS variables (css/style.css), so the Look window can restyle
  // every board at once. White stones also get an edge (flat style) and shell lines.
  function stoneSvg(x, y, color, extraAttrs = "") {
    const cx = x + 1, cy = y + 1;
    // A small shine on top (only seen with glassy styles; --stone-shine is see-through otherwise).
    const shine = `<ellipse cx="${cx - 0.15}" cy="${cy - 0.18}" rx="0.17" ry="0.1" transform="rotate(-35 ${cx - 0.15} ${cy - 0.18})" style="fill: var(--stone-shine)"/>`;
    if (color === BLACK) return `<g ${extraAttrs}><circle cx="${cx}" cy="${cy}" r="0.47" fill="url(#stone-black)"/>${shine}</g>`;
    const lines = [-0.18, 0, 0.18].map((dy) =>
      `<path d="M${cx - 0.36} ${cy + dy - 0.06} Q${cx} ${cy + dy + 0.1} ${cx + 0.36} ${cy + dy - 0.06}" fill="none" style="stroke: var(--shell-line)" stroke-width="0.025"/>`).join("");
    return `<g ${extraAttrs}><circle cx="${cx}" cy="${cy}" r="0.47" fill="url(#stone-white)" style="stroke: var(--board-stone-edge, var(--stone-white-edge))" stroke-width="0.04"/>${lines}${shine}</g>`;
  }

  // view: { size, board, dead?, territory?, lastMove?, hint?, ghostColor? (null = no hover stones), marks? }
  // marks: [{ x, y, kind: "target" | "good" | "bad" }] small symbols drawn on points.
  function renderBoard(view) {
    const s = view.size, end = s, parts = [];
    const dead = view.dead || new Set();
    parts.push(`<svg viewBox="0 0 ${s + 1} ${s + 1}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="stone-black" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" style="stop-color: var(--stone-black-1)"/><stop offset="1" style="stop-color: var(--stone-black-2)"/>
        </radialGradient>
        <radialGradient id="stone-white" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" style="stop-color: var(--stone-white-1)"/><stop offset="1" style="stop-color: var(--stone-white-2)"/>
        </radialGradient>
        <pattern id="tex-bamboo" width="1.5" height="9" patternUnits="userSpaceOnUse">
          <rect width="0.05" height="9" fill="rgba(90,60,10,0.28)"/><rect x="0.55" width="0.35" height="9" fill="rgba(255,255,255,0.13)"/>
          <rect y="3.2" width="1.5" height="0.07" fill="rgba(90,60,10,0.25)"/>
        </pattern>
        <pattern id="tex-marble" width="7" height="7" patternUnits="userSpaceOnUse">
          <path d="M-1 1.5 C1 0.8 2 2.8 4 2 S6.5 0.5 8 1.4" fill="none" stroke="rgba(110,110,125,0.35)" stroke-width="0.06"/>
          <path d="M-1 4.6 C1.5 5.6 3 3.6 5 4.4 S7 6.2 8 5.6" fill="none" stroke="rgba(110,110,125,0.25)" stroke-width="0.04"/>
          <path d="M2 -1 C2.6 1 1.6 3 2.8 5 S3.2 7 2.6 8" fill="none" stroke="rgba(110,110,125,0.15)" stroke-width="0.03"/>
        </pattern>
        <radialGradient id="tex-golden" cx="0.3" cy="0.25" r="0.9">
          <stop offset="0" stop-color="#fff6c8" stop-opacity="0.75"/><stop offset="0.45" stop-color="#fff6c8" stop-opacity="0"/><stop offset="1" stop-color="#8a5a08" stop-opacity="0.35"/>
        </radialGradient>
        <radialGradient id="tex-neon" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0" stop-color="#3fd0d6" stop-opacity="0.16"/><stop offset="1" stop-color="#c040e0" stop-opacity="0.18"/>
        </radialGradient>
        <linearGradient id="tex-fire" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ffb030" stop-opacity="0.65"/><stop offset="0.55" stop-color="#ff6a1a" stop-opacity="0.15"/><stop offset="1" stop-color="#4a0a04" stop-opacity="0.55"/>
        </linearGradient>
      </defs>
      <rect width="${s + 1}" height="${s + 1}" fill="var(--wood)"/>
      <rect width="${s + 1}" height="${s + 1}" style="fill: var(--board-texture)"/>`);

    for (let k = 1; k <= s; k++) {
      parts.push(`<line x1="1" y1="${k}" x2="${end}" y2="${k}" stroke="var(--line)" stroke-width="0.04"/>`);
      parts.push(`<line x1="${k}" y1="1" x2="${k}" y2="${end}" stroke="var(--line)" stroke-width="0.04"/>`);
    }
    for (const sx of STAR_POINTS[s] || []) for (const sy of STAR_POINTS[s] || []) {
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
