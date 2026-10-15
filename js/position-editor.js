// Position editor: place black and white stones, choose who moves first, then play
// from that position against yourself (Same computer) or a bot.
// While it is open it draws the board and takes the board clicks; game-page.js
// starts the game through GoPage.startFromPosition.
(function () {
  const { EMPTY, BLACK, WHITE, GoGame } = window.Go;
  const { t } = window.GoI18n;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const TOOL_COLOR = { black: BLACK, white: WHITE, erase: EMPTY };
  const HIDDEN_WHILE_EDITING = [".controls-block", ".chat-block", ".moves-block"];

  let open = false;
  let size = 19;
  let board = [];
  let tool = "black";
  let turn = BLACK;
  window.GoEditor = { isOpen: () => open };

  function pickOne(container, button) {
    for (const b of container.querySelectorAll("button")) b.classList.toggle("selected", b === button);
  }

  function say(text, isError) {
    $("editor-message").textContent = text;
    $("editor-message").classList.toggle("error", Boolean(isError));
  }

  function draw() {
    boardEl.innerHTML = window.GoBoardView.renderBoard({
      size,
      board,
      ghostColor: tool === "erase" ? null : TOOL_COLOR[tool],
    });
  }

  function emptyBoard(newSize) {
    size = newSize;
    board = new Array(size * size).fill(EMPTY);
  }

  function show(on) {
    open = on;
    $("editor-block").hidden = !on;
    for (const selector of HIDDEN_WHILE_EDITING) {
      const block = document.querySelector(selector);
      if (on) {
        block.dataset.wasHidden = block.hidden ? "yes" : "";
        block.hidden = true;
      } else if (block.dataset.wasHidden !== undefined) {
        block.hidden = block.dataset.wasHidden === "yes";
        delete block.dataset.wasHidden;
      }
    }
    $("btn-setup").hidden = on || window.GoPage.getSetup().mode === "online";
  }

  function start() {
    const wanted = window.GoPage.getSetup().size;
    if (wanted !== size || !board.length) emptyBoard(wanted);
    show(true);
    say(t("Click the board to place stones. Board size, opponent and clock are in the New game box."));
    draw();
  }

  function close() {
    if (!open) return;
    show(false);
    window.GoPage.redraw();
  }

  function play() {
    if (window.GoPage.getSetup().mode === "online") {
      say(t("Custom positions work with Same computer or Computer. Pick one in the New game box."), true);
      return;
    }
    // Stones without liberties can't exist in a real game.
    const breathless = new GoGame(size).breathlessStones(board);
    if (breathless.length) {
      say(t("Some stones have no liberties (no empty point next to their group). Remove or change them first."), true);
      return;
    }
    show(false);
    window.GoPage.startFromPosition(board, turn);
  }

  // Board clicks go to the editor while it's open (capture phase, before the game sees them).
  boardEl.addEventListener("click", (event) => {
    if (!open) return;
    event.stopPropagation();
    const spot = event.target.closest(".spot");
    if (!spot) return;
    const i = Number(spot.dataset.y) * size + Number(spot.dataset.x);
    const color = TOOL_COLOR[tool];
    board[i] = board[i] === color ? EMPTY : color; // clicking the same color again removes it
    say("");
    draw();
  }, true);

  $("editor-tools").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    tool = button.dataset.tool;
    pickOne(event.currentTarget, button);
    draw();
  });

  $("editor-turn").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    turn = button.dataset.turn === "white" ? WHITE : BLACK;
    pickOne(event.currentTarget, button);
  });

  $("btn-setup").addEventListener("click", start);
  $("btn-editor-play").addEventListener("click", play);
  $("btn-editor-cancel").addEventListener("click", close);
  $("btn-editor-clear").addEventListener("click", () => {
    emptyBoard(size);
    say("");
    draw();
  });

  // A new board size starts a fresh, empty setup.
  $("size-picker").addEventListener("click", () => {
    if (!open) return;
    emptyBoard(window.GoPage.getSetup().size);
    draw();
  });
  // Starting a normal game, or switching to Online, closes the editor.
  $("btn-new").addEventListener("click", () => { if (open) show(false); }, true);
  for (const picker of [$("mode-picker"), $("nav")]) {
    picker.addEventListener("click", () => {
      if (window.GoPage.getSetup().mode === "online") close();
      else $("btn-setup").hidden = open;
    });
  }
})();
