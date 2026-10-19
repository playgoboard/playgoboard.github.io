// "Today's puzzle" on the main page: a small picture of the day's puzzle and a Solve button.
// The puzzle is the same for everyone on the same day (GoDailyPuzzle in puzzles-data.js).
(function () {
  const box = document.getElementById("daily-puzzle-box");
  if (!box || !window.GO_PUZZLES || !window.GoBoardView) return;
  const { t } = window.GoI18n;
  const { BLACK, WHITE, EMPTY } = window.Go;
  const LETTERS = "ABCDEFGHJKLMNOPQRST";

  const index = window.GoDailyPuzzle();
  const puzzle = window.GO_PUZZLES[index];
  const size = puzzle.rows.length;
  const board = [];
  for (const row of puzzle.rows) for (const ch of row) board.push(ch === "X" ? BLACK : ch === "O" ? WHITE : EMPTY);
  const marks = puzzle.targets.map((c) => ({ x: LETTERS.indexOf(c[0]), y: size - Number(c.slice(1)), kind: "target" }));

  let solved = false;
  try { solved = JSON.parse(localStorage.getItem("goboard-puzzles-solved") || "[]").includes(index); } catch { /* not known */ }

  const levelName = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" }[puzzle.level];
  const heading = document.createElement("h2");
  heading.textContent = `⭐ ${t("Today's puzzle")}`;
  const row = document.createElement("div");
  row.className = "daily-puzzle-row";
  const picture = document.createElement("a");
  picture.className = "board no-ghost";
  picture.href = `puzzles.html#${index + 1}`;
  picture.innerHTML = window.GoBoardView.renderBoard({ size, board, marks, ghostColor: null });
  const side = document.createElement("div");
  const name = document.createElement("p");
  name.innerHTML = "<b></b>";
  name.firstChild.textContent = window.GoPuzzleText(puzzle).title;
  const level = document.createElement("p");
  level.className = "message";
  level.textContent = solved ? `${t(levelName)} · ${t("Solved ✓")}` : t(levelName);
  const solve = document.createElement("a");
  solve.className = "btn btn-primary";
  solve.href = `puzzles.html#${index + 1}`;
  solve.textContent = solved ? t("Look again") : t("Solve it");
  side.append(name, level, solve);
  row.append(picture, side);
  box.append(heading, row);
  box.hidden = false;
})();
