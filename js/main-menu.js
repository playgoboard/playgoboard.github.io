// The main menu: big square buttons, two side by side, for everything on the site.
// It's what index.html shows when opened with nothing after the address (index.html?mode=bot etc.
// open the game instead), and the ☰ button in the top bar of every page leads here.
// Each square shows a little live info (games waiting, today's puzzle, streak…).
(function () {
  const menu = document.getElementById("main-menu");
  const params = new URLSearchParams(window.location.search);
  params.delete("lang"); // the language menu adds ?lang=, which still means "the start page"
  if (!menu || params.toString() || window.location.hash) return;
  const { t } = window.GoI18n;
  const accounts = window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts : null;
  const me = () => (accounts ? accounts.current().profile : null);
  const game = document.querySelector(".game-layout");

  // Show the menu instead of the game. The nav buttons on this page switch to the game.
  menu.hidden = false;
  game.hidden = true;
  for (const b of document.querySelectorAll("#nav [data-mode]")) {
    b.classList.remove("active");
    b.addEventListener("click", () => { menu.hidden = true; game.hidden = false; });
  }

  // [key, icon, name, link]
  const TILES = [
    ["learn", "🎓", "Learn Go", "learn.html"],
    ["daily", "📅", "Daily games", "daily.html"],
    ["puzzle", "⭐", "Today's puzzle", "puzzles.html"],
    ["bots", "🤖", "Bots", "index.html?mode=bot"],
    ["online", "🌐", "Play online", "index.html?mode=online"],
    ["puzzles", "🧩", "Puzzles", "puzzles.html"],
    ["rush", "⚡", "Puzzle Rush", "puzzle-rush.html"],
    ["friend", "👥", "Play a friend", "index.html?mode=friend"],
    ["leaderboard", "🏆", "Leaderboard", "leaderboard.html"],
    ["achievements", "🎖️", "Achievements", "achievements.html"],
  ];
  const info = {};
  const tiles = {};
  const grid = document.createElement("div");
  grid.className = "menu-grid";
  for (const [key, icon, name, href] of TILES) {
    const a = document.createElement("a");
    a.className = `menu-tile tile-${key}`;
    a.href = href;
    const iconEl = document.createElement("span");
    iconEl.className = "menu-icon";
    iconEl.textContent = icon;
    const nameEl = document.createElement("b");
    nameEl.textContent = t(name);
    info[key] = document.createElement("span");
    info[key].className = "menu-info";
    a.append(iconEl, nameEl, info[key]);
    tiles[key] = a;
    grid.append(a);
  }
  const heading = document.createElement("h1");
  heading.className = "menu-title";
  heading.textContent = t("What do you want to play?");
  // Install as an app (js/app-install.js): a button, or the iPhone tip.
  const install = document.createElement("div");
  install.className = "menu-install";
  function drawInstall() {
    const kind = window.GoInstall ? window.GoInstall.kind() : null;
    install.textContent = "";
    install.hidden = !kind;
    if (kind === "button") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-primary";
      b.textContent = t("📲 Install GoBoard as an app");
      b.addEventListener("click", () => window.GoInstall.install());
      install.append(b);
    } else if (kind === "ios") {
      const tip = document.createElement("p");
      tip.className = "message";
      tip.textContent = t("📲 Get GoBoard as an app: tap the Share button, then \"Add to Home Screen\".");
      install.append(tip);
    }
  }
  if (window.GoInstall) window.GoInstall.onChange(drawInstall);
  drawInstall();
  menu.append(heading, grid, install);

  function solvedPuzzles() {
    try { return new Set(JSON.parse(localStorage.getItem("goboard-puzzles-solved") || "[]")); } catch { return new Set(); }
  }

  // Info that doesn't need an account.
  function drawLocal() {
    info.bots.textContent = t("5 levels, Pebble to Dragon");
    info.online.textContent = t("Quick match or invite a friend");
    info.friend.textContent = t("Two players, one screen");
    let lessonsDone = [];
    try { lessonsDone = JSON.parse(localStorage.getItem("goboard-lessons-done") || "[]"); } catch { /* none yet */ }
    const lessonCount = window.GO_LESSONS ? window.GO_LESSONS.length : 6;
    info.learn.textContent = lessonsDone.length >= lessonCount ? t("All lessons done ✓")
      : lessonsDone.length ? t("{n} of {total} lessons done", { n: lessonsDone.length, total: lessonCount }) : t("New to Go? Start here");
    tiles.learn.classList.toggle("highlight", lessonsDone.length === 0);
    let rushBest = {};
    try { rushBest = JSON.parse(localStorage.getItem("goboard-rush-best") || "{}"); } catch { /* none yet */ }
    const top = Math.max(0, ...Object.values(rushBest));
    info.rush.textContent = top ? t("Your best: {n}", { n: top }) : t("Beat the clock");
    const puzzles = window.GO_PUZZLES || [];
    const solved = solvedPuzzles();
    info.puzzles.textContent = t("Solved {n} of {total}.", { n: solved.size, total: puzzles.length });
    if (window.GoDailyPuzzle && puzzles.length) {
      const index = window.GoDailyPuzzle();
      const p = puzzles[index];
      tiles.puzzle.href = `puzzles.html#${index + 1}`;
      const level = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" }[p.level];
      info.puzzle.textContent = solved.has(index) ? `${t(level)} · ${t("Solved ✓")}` : t(level);
      tiles.puzzle.classList.toggle("highlight", !solved.has(index));
    }
  }

  // Info for logged-in players.
  async function drawAccount() {
    const profile = me();
    info.leaderboard.textContent = profile ? t("Your rating: {n}", { n: profile.rating }) : t("The best players");
    if (!profile) {
      info.daily.textContent = t("Log in to play");
      info.achievements.textContent = t("Log in to earn them");
      tiles.daily.classList.remove("highlight");
      return;
    }
    const streak = window.GoAchievements ? window.GoAchievements.currentStreak(profile) : 0;
    const [waiting, achieved] = await Promise.all([
      accounts.client.from("daily_games").select("id").in("status", ["playing", "open"])
        .or(`and(status.eq.playing,black.eq.${profile.id},turn.eq.black),and(status.eq.playing,white.eq.${profile.id},turn.eq.white),`
          + `and(status.eq.open,invited.eq.${profile.id})`),
      accounts.client.from("player_achievements").select("achievement", { count: "exact", head: true }).eq("player", profile.id),
    ]);
    const n = waiting.error ? 0 : waiting.data.length;
    info.daily.textContent = n === 1 ? t("1 game waiting for you") : n ? t("{n} games waiting for you", { n }) : t("Nothing waiting");
    tiles.daily.classList.toggle("highlight", n > 0);
    const total = window.GoAchievements ? window.GoAchievements.BY_ID.size : 30;
    info.achievements.textContent = `${achieved.count || 0} / ${total}${streak ? ` · 🔥${streak}` : ""}`;
  }

  drawLocal();
  if (accounts) accounts.onChange(() => { drawAccount().catch(() => {}); });
  else drawAccount();
})();
