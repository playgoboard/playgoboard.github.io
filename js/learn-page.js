// The Learn Go page (learn.html): the list of lessons, and one lesson at a time, step by step.
// Lessons are in js/lessons-data.js. Progress is kept in the browser; logged-in players also
// get the "First lesson" and "Graduate" achievements (js/achievements.js).
(function () {
  const { BLACK } = window.Go;
  const { renderBoard, COLUMN_LETTERS } = window.GoBoardView;
  const { boardFromDiagram } = window.GoPuzzleSolver;
  const { t } = window.GoI18n;
  const LESSONS = window.GO_LESSONS;
  const DONE_KEY = "goboard-lessons-done";
  const AT_KEY = "goboard-lesson-at";
  const $ = (id) => document.getElementById(id);

  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* only for this visit */ } };
  let done = new Set(load(DONE_KEY, []));

  let lesson = null, stepIndex = 0;
  let board = null, solved = false, marks = [], lastMove = null;

  const toIndex = (coord, size) => (size - Number(coord.slice(1))) * size + COLUMN_LETTERS.indexOf(coord[0]);
  const marksFrom = (spec, size) => Object.entries(spec || {}).flatMap(([kind, list]) =>
    list.map((c) => { const i = toIndex(c, size); return { x: i % size, y: Math.floor(i / size), kind }; }));

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  // ---- The list of lessons ----

  function showList() {
    lesson = null;
    $("lesson-view").hidden = true;
    $("lesson-list").hidden = false;
    const box = $("lesson-cards");
    box.textContent = "";
    LESSONS.forEach((l, k) => {
      const card = element("button", `lesson-card${done.has(l.id) ? " done" : ""}`);
      card.type = "button";
      card.append(element("span", "lesson-number", done.has(l.id) ? "✓" : String(k + 1)),
        element("b", "", t(l.title)), element("span", "message", t("{n} steps", { n: l.steps.length })));
      card.addEventListener("click", () => openLesson(l.id, 0));
      box.append(card);
    });
    $("lesson-progress").textContent = t("{n} of {total} lessons done", { n: done.size, total: LESSONS.length });
    const at = load(AT_KEY, null);
    const resume = at && LESSONS.find((l) => l.id === at.id);
    $("btn-continue").hidden = !resume;
    if (resume) $("btn-continue").textContent = t("Continue: {title}", { title: t(resume.title) });
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* address unchanged */ }
  }

  $("btn-continue").addEventListener("click", () => {
    const at = load(AT_KEY, null);
    if (at) openLesson(at.id, at.step);
  });

  // ---- One lesson ----

  function openLesson(id, step) {
    lesson = LESSONS.find((l) => l.id === id) || LESSONS[0];
    $("lesson-list").hidden = true;
    $("lesson-view").hidden = false;
    showStep(Math.min(step || 0, lesson.steps.length - 1));
    try { history.replaceState(null, "", `#${lesson.id}`); } catch { /* address unchanged */ }
    if (window.matchMedia("(max-width: 1000px)").matches) $("lesson-view").scrollIntoView({ block: "start" });
  }

  const step = () => lesson.steps[stepIndex];

  function draw() {
    const s = step();
    $("lesson-board").innerHTML = renderBoard({
      size: board.size, board: Array.from(board.cells), lastMove, marks,
      ghostColor: s.task && s.answers && !solved ? BLACK : null,
    });
  }

  function showStep(k) {
    stepIndex = k;
    const s = step();
    board = boardFromDiagram(s.rows);
    solved = !s.task;
    lastMove = null;
    marks = marksFrom(s.marks, board.size);
    $("lesson-title").textContent = `${LESSONS.indexOf(lesson) + 1}. ${t(lesson.title)}`;
    $("lesson-step").textContent = t("Step {n} of {total}", { n: k + 1, total: lesson.steps.length });
    $("lesson-text").textContent = t(s.task || s.text);
    $("lesson-text").classList.toggle("task", Boolean(s.task));
    $("lesson-feedback").textContent = "";
    $("lesson-feedback").className = "message";
    $("btn-hint").hidden = !s.task || solved;
    const choices = $("lesson-choices");
    choices.textContent = "";
    for (const [n, label] of (s.choices || []).entries()) {
      const b = element("button", "btn", t(label));
      b.type = "button";
      b.addEventListener("click", () => pickChoice(n, b));
      choices.append(b);
    }
    $("lesson-finish").hidden = !s.finish;
    $("btn-step-back").disabled = k === 0;
    updateNext();
    draw();
    store(AT_KEY, { id: lesson.id, step: k });
  }

  function updateNext() {
    const last = stepIndex === lesson.steps.length - 1;
    $("btn-step-next").disabled = !solved;
    $("btn-step-next").textContent = last ? t("Finish lesson ✓") : t("Next ›");
  }

  function success() {
    solved = true;
    $("lesson-feedback").textContent = t(step().done);
    $("lesson-feedback").className = "message lesson-good";
    $("btn-hint").hidden = true;
    updateNext();
    draw();
  }

  function pickChoice(n, button) {
    if (solved) return;
    if (n === step().answer) {
      button.classList.add("selected");
      return success();
    }
    $("lesson-feedback").textContent = t("Not quite. Think about it once more!");
    $("lesson-feedback").className = "message lesson-bad";
  }

  $("lesson-board").addEventListener("click", (event) => {
    const spot = event.target.closest(".spot");
    const s = step();
    if (!spot || !s.task || !s.answers || solved) return;
    const size = board.size;
    const point = Number(spot.dataset.y) * size + Number(spot.dataset.x);
    const coord = `${COLUMN_LETTERS[point % size]}${size - Math.floor(point / size)}`;
    if (board.cells[point] !== 0) {
      // Tasks like "click the dead stone" point at a stone instead of playing one.
      if (s.answers.includes(coord)) {
        marks = [{ x: point % size, y: Math.floor(point / size), kind: "good" }];
        return success();
      }
      $("lesson-feedback").textContent = t("There's already a stone there.");
      $("lesson-feedback").className = "message lesson-bad";
      return;
    }
    if (!board.isLegal(point, BLACK)) {
      $("lesson-feedback").textContent = t("You can't play there: your stone would have no liberties.");
      $("lesson-feedback").className = "message lesson-bad";
      return;
    }
    if (!s.answers.includes(coord)) {
      marks = [...marksFrom(s.marks, size), { x: point % size, y: Math.floor(point / size), kind: "bad" }];
      $("lesson-feedback").textContent = t("Not quite. Try another point, or press Hint.");
      $("lesson-feedback").className = "message lesson-bad";
      draw();
      return;
    }
    const before = board.cells.filter((c) => c !== 0).length;
    board.play(point, BLACK);
    lastMove = point;
    marks = [];
    window.GoSounds.stone();
    const taken = before + 1 - board.cells.filter((c) => c !== 0).length;
    if (taken > 0) window.GoSounds.capture(taken);
    success();
  });

  $("btn-hint").addEventListener("click", () => {
    const s = step();
    const size = board.size;
    if (s.answers) {
      marks = [...marksFrom(s.marks, size), ...s.answers.map((c) => { const i = toIndex(c, size); return { x: i % size, y: Math.floor(i / size), kind: "good" }; })];
      $("lesson-feedback").textContent = t("Hint: play on a green circle.");
    } else {
      $("lesson-feedback").textContent = t("Hint: the answer is \"{answer}\".", { answer: t(s.choices[s.answer]) });
    }
    $("lesson-feedback").className = "message";
    draw();
  });

  $("btn-step-back").addEventListener("click", () => { if (stepIndex > 0) showStep(stepIndex - 1); });
  $("btn-step-next").addEventListener("click", () => {
    if (!solved) return;
    if (stepIndex < lesson.steps.length - 1) return showStep(stepIndex + 1);
    finishLesson();
  });
  $("btn-lessons").addEventListener("click", showList);

  function finishLesson() {
    done.add(lesson.id);
    store(DONE_KEY, [...done]);
    const k = LESSONS.indexOf(lesson);
    const next = LESSONS[k + 1];
    store(AT_KEY, next ? { id: next.id, step: 0 } : null);
    if (window.GoAchievements) {
      window.GoAchievements.claim("first-lesson");
      if (LESSONS.every((l) => done.has(l.id))) window.GoAchievements.claim("graduate");
      window.GoAchievements.activity(); // a lesson counts for the daily streak
    }
    if (next) openLesson(next.id, 0);
    else showList();
  }

  const fromAddress = location.hash.slice(1);
  if (LESSONS.some((l) => l.id === fromAddress)) openLesson(fromAddress, 0);
  else showList();
})();
