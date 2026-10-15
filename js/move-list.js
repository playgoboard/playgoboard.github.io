// The "Moves" box: every move of the game in Black/White pairs, like a chess move list.
// Clicking a move asks the page to show the board as it was after that move.
(function () {
  const { t } = window.GoI18n;
  const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go boards skip the letter I

  function moveName(move, size) {
    return move.pass ? t("Pass") : `${COLUMN_LETTERS[move.x]}${size - move.y}`;
  }

  // `shown` = how many moves the board is showing right now (moves.length when live).
  function render(container, moves, size, shown) {
    if (!moves.length) {
      container.innerHTML = `<p class="move-empty">${t("No moves yet.")}</p>`;
      return;
    }
    const rows = [];
    for (let i = 0; i < moves.length; i += 2) {
      const cell = (k) => {
        if (k >= moves.length) return "<span></span>";
        const current = k + 1 === shown ? " current" : "";
        return `<button class="move${current}" data-count="${k + 1}">${moveName(moves[k], size)}</button>`;
      };
      rows.push(`<div class="move-row"><span class="move-number">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</div>`);
    }
    container.innerHTML = rows.join("");
    // Keep the current move visible by scrolling only the list, never the whole page.
    const current = container.querySelector(".current");
    if (!current) return;
    const top = current.offsetTop, bottom = top + current.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top - 4;
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight + 4;
  }

  window.GoMoveList = { render, moveName };
})();
