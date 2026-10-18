// The Look window: site colors (dark, light or the device's setting), board wood and stone
// style. Loaded in <head> so the saved look is applied before the page shows (no flash).
// The colors themselves are CSS variables in css/style.css, keyed by data-* on <html>.
(function () {
  const STORAGE_KEY = "goboard-look";
  const CHOICES = {
    theme: [["dark", "Dark"], ["light", "Light"], ["auto", "Match my device"]],
    board: [["classic", "Classic wood"], ["maple", "Light maple"], ["walnut", "Dark walnut"], ["green", "Green"]],
    stones: [["classic", "Classic"], ["flat", "Flat"], ["shell", "Slate & shell"]],
  };
  const SWATCH = { classic: "#dcb35c", maple: "#f0d9a3", walnut: "#a9743f", green: "#8fbf8a" };

  const look = { theme: "dark", board: "classic", stones: "classic" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const key of Object.keys(look)) {
      if (CHOICES[key].some(([value]) => value === saved[key])) look[key] = saved[key];
    }
  } catch { /* nothing saved, or storage blocked: use the default look */ }

  const root = document.documentElement;
  function apply() {
    root.dataset.theme = look.theme;
    root.dataset.board = look.board;
    root.dataset.stones = look.stones;
  }
  apply();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(look)); } catch { /* only for this visit */ }
  }

  // A tiny board in the window, so you see the choice at once.
  function preview() {
    if (!window.GoBoardView || !window.Go) return null;
    const { BLACK, WHITE, EMPTY } = window.Go;
    const size = 5, board = new Array(size * size).fill(EMPTY);
    for (const [x, y] of [[1, 1], [2, 2], [3, 1]]) board[y * size + x] = BLACK;
    for (const [x, y] of [[2, 1], [3, 3], [1, 3]]) board[y * size + x] = WHITE;
    const box = document.createElement("div");
    box.className = "board look-preview no-ghost";
    box.innerHTML = window.GoBoardView.renderBoard({ size, board, lastMove: 2 * size + 2, ghostColor: null });
    return box;
  }

  function buildWindow() {
    const t = window.GoI18n ? window.GoI18n.t : (text) => text;
    const dialog = document.createElement("dialog");
    dialog.className = "account-dialog look-dialog";
    dialog.innerHTML = `<form method="dialog" class="dialog-close-row"><button class="dialog-close" aria-label="${t("Close")}">✕</button></form>`;
    const heading = document.createElement("h2");
    heading.textContent = t("Look");
    dialog.append(heading);

    for (const [key, label] of [["theme", "Site"], ["board", "Board"], ["stones", "Stones"]]) {
      const title = document.createElement("p");
      title.className = "label";
      title.textContent = t(label);
      const row = document.createElement("div");
      row.className = "choice-row wrap";
      for (const [value, name] of CHOICES[key]) {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("selected", look[key] === value);
        if (key === "board") {
          const swatch = document.createElement("span");
          swatch.className = "look-swatch";
          swatch.style.background = SWATCH[value];
          button.append(swatch);
        }
        button.append(t(name));
        button.addEventListener("click", () => {
          look[key] = value;
          for (const other of row.children) other.classList.toggle("selected", other === button);
          apply();
          save();
        });
        row.append(button);
      }
      dialog.append(title, row);
    }
    const board = preview();
    if (board) dialog.append(board);
    const done = document.createElement("button");
    done.className = "btn btn-primary";
    done.textContent = t("Done");
    done.addEventListener("click", () => dialog.close());
    dialog.append(done);
    document.body.append(dialog);
    return dialog;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".top-bar");
    if (!bar) return;
    const t = window.GoI18n ? window.GoI18n.t : (text) => text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sound-toggle look-button";
    button.textContent = "🎨";
    button.title = t("Look: colors, board and stones");
    let dialog = null;
    button.addEventListener("click", () => {
      if (!dialog) dialog = buildWindow();
      dialog.showModal();
    });
    const sound = document.getElementById("btn-sound");
    if (sound) bar.insertBefore(button, sound);
    else bar.append(button);
  });
})();
