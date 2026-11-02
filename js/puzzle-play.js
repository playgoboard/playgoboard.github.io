// Playing one capture puzzle on the board, shared by Puzzle Rush and Rated puzzles. White always
// answers with its best defense (puzzle-solver.js), and a move only counts if it still wins.
(function () {
  const { BLACK, WHITE } = window.Go;
  const { FastBoard } = window.GoBot;
  const { renderBoard, COLUMN_LETTERS } = window.GoBoardView;
  const { boardFromDiagram, moveWins, whiteReply } = window.GoPuzzleSolver;
  const WHITE_DELAY_MS = 250;

  function pointIndex(coord, size) {
    return (size - Number(coord.slice(1))) * size + COLUMN_LETTERS.indexOf(coord[0]);
  }

  // boardEl: where to draw. canPlay(): may the player move now? onFinish(solved): the puzzle is decided.
  function create({ boardEl, canPlay, onFinish }) {
    let board = new FastBoard(9);
    let puzzle = null, targets = [], movesLeft = 0, busy = false, lastMove = null, marks = [], hint = null;
    let token = 0; // a newer token cancels White's waiting reply

    function draw() {
      const size = board.size;
      const targetMarks = targets.filter((i) => board.cells[i] === WHITE).map((i) => ({ x: i % size, y: Math.floor(i / size), kind: "target" }));
      boardEl.innerHTML = renderBoard({
        size, board: Array.from(board.cells), lastMove, hint,
        marks: [...targetMarks, ...marks], ghostColor: busy || !canPlay() ? null : BLACK,
      });
    }

    function setUp(next) {
      token++;
      puzzle = next;
      board = boardFromDiagram(next.rows);
      targets = next.targets.map((c) => pointIndex(c, board.size));
      movesLeft = next.moves;
      lastMove = null;
      marks = [];
      hint = null;
      busy = false;
    }

    function load(next) {
      setUp(next);
      draw();
    }

    // Stop waiting for White, for when a run ends.
    function stop() {
      token++;
      busy = false;
      draw();
    }

    // Back to the start of the puzzle, with a green circle on the winning first move.
    function showAnswer() {
      setUp(puzzle);
      const size = board.size;
      for (let point = 0; point < size * size; point++) {
        if (board.isLegal(point, BLACK) && moveWins(board, targets, point, movesLeft)) {
          hint = { x: point % size, y: Math.floor(point / size) };
          break;
        }
      }
      draw();
    }

    function playBlack(point) {
      if (!canPlay() || busy || !puzzle) return;
      if (!board.isLegal(point, BLACK)) return;
      const size = board.size;
      if (!moveWins(board, targets, point, movesLeft)) {
        // Not the winning move: show it with a red X.
        busy = true;
        board.play(point, BLACK);
        lastMove = point;
        marks = [{ x: point % size, y: Math.floor(point / size), kind: "bad" }];
        window.GoSounds.stone();
        draw();
        onFinish(false);
        return;
      }
      board.play(point, BLACK);
      lastMove = point;
      movesLeft--;
      window.GoSounds.stone();
      busy = true;
      if (targets.some((i) => board.cells[i] !== WHITE)) {
        draw();
        onFinish(true);
        return;
      }
      draw();
      const myToken = token;
      setTimeout(() => {
        if (myToken !== token || !canPlay()) return;
        const reply = whiteReply(board, targets, movesLeft);
        if (reply !== null) {
          board.play(reply, WHITE);
          lastMove = reply;
          window.GoSounds.stone();
        }
        busy = false;
        draw();
      }, WHITE_DELAY_MS);
    }

    boardEl.addEventListener("click", (event) => {
      const spot = event.target.closest(".spot");
      if (spot) playBlack(Number(spot.dataset.y) * board.size + Number(spot.dataset.x));
    });
    draw();
    return { load, stop, showAnswer, draw };
  }

  window.GoPuzzlePlay = { create };
})();
