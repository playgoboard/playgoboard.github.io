// The Look window: site colors (dark, light or the device's setting), accent color, page
// background, text size, board size on screen, board style, stone style and stone sound.
// Loaded in <head> so the saved look is applied before the page shows (no flash).
// The colors themselves are CSS variables in css/style.css, keyed by data-* on <html>.
(function () {
  const STORAGE_KEY = "goboard-look";
  const CHOICES = {
    board: [["classic", "Classic wood"], ["maple", "Light maple"], ["walnut", "Dark walnut"], ["green", "Green"],
      ["bamboo", "Bamboo"], ["marble", "Marble"], ["ocean", "Blue ocean"], ["night", "Night"], ["paper", "Paper"],
      ["golden", "Golden board"], ["neon", "Neon board"], ["fire", "Fire board"]],
    stones: [["classic", "Classic"], ["flat", "Flat"], ["shell", "Slate & shell"], ["glass", "Glass"],
      ["jade", "Jade & pearl"], ["yunzi", "Yunzi"], ["dragon", "Dragon stones"], ["royal", "Royal stones"]],
    sound: [["wood", "Wood"], ["soft", "Soft"], ["slate", "Slate"], ["off", "Off"]],
    theme: [["dark", "Dark"], ["light", "Light"], ["auto", "Match my device"]],
    accent: [["green", "Green"], ["blue", "Blue"], ["purple", "Purple"], ["red", "Red"], ["orange", "Orange"]],
    background: [["plain", "Plain"], ["gradient", "Soft gradient"], ["wood", "Wood"], ["pattern", "Go pattern"]],
    text: [["small", "Small"], ["normal", "Normal"], ["large", "Large"]],
    boardSize: [["compact", "Compact"], ["normal", "Normal"], ["big", "Big"]],
  };
  // Rows of the window, in order: [setting, heading]. The preview board sits above them.
  const ROWS = [["board", "Board"], ["stones", "Stones"], ["sound", "Stone sound"], ["theme", "Site"],
    ["accent", "Accent color"], ["background", "Page background"], ["text", "Text size"], ["boardSize", "Board size on screen"]];
  const SWATCH = {
    board: { classic: "#dcb35c", maple: "#f0d9a3", walnut: "#a9743f", green: "#8fbf8a", bamboo: "#d8c27c",
      marble: "#dedbd5", ocean: "#6fa8c9", night: "#3c3f45", paper: "#fbfaf6", golden: "#f1c84b", neon: "#16202e", fire: "#b8401c" },
    accent: { green: "#81b64c", blue: "#4c8fd6", purple: "#9b6bd6", red: "#d65a5a", orange: "#e08a3c" },
  };

  // Rewards: these styles unlock when the whole achievement group is finished (js/achievements.js
  // keeps the finished groups in the browser). They only change your own screen.
  const REWARD_STYLES = { board: { golden: "Puzzles", neon: "Fun", fire: "Streak" }, stones: { dragon: "Bots", royal: "Online" } };
  function finishedGroups() {
    try { return JSON.parse(localStorage.getItem("goboard-rewards") || "[]"); } catch { return []; }
  }
  const lockedBy = (key, value) => {
    const group = REWARD_STYLES[key] && REWARD_STYLES[key][value];
    return group && !finishedGroups().includes(group) ? group : null;
  };

  const look = { board: "classic", stones: "classic", sound: "wood", theme: "dark", accent: "green",
    background: "plain", text: "normal", boardSize: "normal" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const key of Object.keys(look)) {
      if (CHOICES[key].some(([value]) => value === saved[key])) look[key] = saved[key];
    }
  } catch { /* nothing saved, or storage blocked: use the default look */ }
  if (lockedBy("board", look.board)) look.board = "classic";
  if (lockedBy("stones", look.stones)) look.stones = "classic";
  // "Off" is the same as the mute button, so it is kept by sounds.js, not here.
  if (look.sound === "off") look.sound = "wood";

  const root = document.documentElement;
  function apply() {
    root.dataset.theme = look.theme;
    root.dataset.board = look.board;
    root.dataset.stones = look.stones;
    root.dataset.accent = look.accent;
    root.dataset.background = look.background;
    root.dataset.text = look.text;
    root.dataset.boardSize = look.boardSize;
  }
  apply();
  window.GoLook = { soundStyle: () => look.sound };

  // Rewards changed (logged in or out, or a group just finished): drop styles that are locked now.
  let dialog = null; // the Look window, built the first time it opens
  window.addEventListener("goboard-rewards", () => {
    let changed = false;
    for (const key of ["board", "stones"]) {
      if (lockedBy(key, look[key])) { look[key] = "classic"; changed = true; }
    }
    if (changed) { apply(); save(); }
    if (dialog && dialog.markSelected) dialog.markSelected();
  });

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

  const sounds = () => window.GoSounds;
  const selectedValue = (key) => (key === "sound" && sounds().isMuted() ? "off" : look[key]);

  function choose(key, value) {
    if (key === "sound") {
      sounds().setMuted(value === "off");
      if (value !== "off") {
        look.sound = value;
        sounds().stone(); // a sample so you hear the new sound
      }
    } else {
      look[key] = value;
    }
    apply();
    save();
    if (key === "board") noteBoardTried(value);
  }

  // For the "Stylist" achievement: how many different boards you picked.
  function noteBoardTried(board) {
    if (!window.GoAchievements || !window.GoAchievements.loggedIn()) return;
    let tried = [];
    try { tried = JSON.parse(localStorage.getItem("goboard-boards-tried") || "[]"); } catch { /* starts empty */ }
    if (!tried.includes(board)) tried.push(board);
    try { localStorage.setItem("goboard-boards-tried", JSON.stringify(tried)); } catch { /* not saved */ }
    if (window.GoAchievements) window.GoAchievements.boardTried(tried.length);
  }

  function buildWindow() {
    const t = window.GoI18n ? window.GoI18n.t : (text) => text;
    const dialog = document.createElement("dialog");
    dialog.className = "account-dialog look-dialog";
    dialog.innerHTML = `<form method="dialog" class="dialog-close-row"><button class="dialog-close" aria-label="${t("Close")}">✕</button></form>`;
    const heading = document.createElement("h2");
    heading.textContent = t("Look");
    dialog.append(heading);
    const board = preview();
    if (board) dialog.append(board);

    const rows = [];
    const lockNote = document.createElement("p");
    lockNote.className = "message small-note";
    for (const [key, label] of ROWS) {
      if (key === "sound" && !sounds()) continue; // pages without a board have no stone sounds
      const title = document.createElement("p");
      title.className = "label";
      title.textContent = t(label);
      const row = document.createElement("div");
      row.className = "choice-row wrap";
      for (const [value, name] of CHOICES[key]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.value = value;
        if (SWATCH[key]) {
          const swatch = document.createElement("span");
          swatch.className = "look-swatch";
          swatch.style.background = SWATCH[key][value];
          button.append(swatch);
        }
        button.append(t(name));
        button.addEventListener("click", () => {
          const group = lockedBy(key, value);
          if (group) {
            lockNote.textContent = t("🔒 Finish every {group} achievement to unlock this.", { group: t(group) });
            row.after(lockNote);
            return;
          }
          lockNote.remove();
          choose(key, value);
          markSelected();
        });
        row.append(button);
      }
      rows.push([key, row]);
      dialog.append(title, row);
    }
    function markSelected() {
      for (const [key, row] of rows) {
        for (const button of row.children) {
          button.classList.toggle("selected", button.dataset.value === selectedValue(key));
          button.classList.toggle("locked", Boolean(lockedBy(key, button.dataset.value)));
        }
      }
    }
    dialog.markSelected = markSelected;

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
    button.addEventListener("click", () => {
      if (!dialog) dialog = buildWindow();
      dialog.markSelected(); // the mute button may have changed since last time
      dialog.showModal();
    });
    const sound = document.getElementById("btn-sound");
    if (sound) bar.insertBefore(button, sound);
    else bar.append(button);
  });
})();
