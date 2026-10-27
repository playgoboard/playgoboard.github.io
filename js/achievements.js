// Achievements and the daily streak. Only for logged-in players, and only online: everything is
// saved by the database (supabase/10-achievements.sql), which also checks the ones it can.
// Pages tell this file what happened (GoAchievements.botWin, .puzzleSolved, ...), and a banner
// with a chime pops up for each new achievement.
(function () {
  const { t } = window.GoI18n;
  const accounts = () => (window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts : null);
  const me = () => (accounts() ? accounts().current().profile : null);

  // [id, icon, title, how to get it]. The ids must match supabase/10-achievements.sql.
  const GROUPS = [
    ["Bots", [
      ["beat-pebble", "🪨", "Pebble beaten", "Beat Pebble."],
      ["beat-sprout", "🌱", "Sprout beaten", "Beat Sprout."],
      ["beat-fox", "🦊", "Outfoxed", "Beat Fox."],
      ["beat-tiger", "🐯", "Tiger tamer", "Beat Tiger."],
      ["beat-dragon", "🐉", "Dragon slayer", "Beat Dragon."],
      ["dragon-19", "🏯", "Big board Dragon", "Beat Dragon on 19×19."],
      ["flawless", "💎", "Flawless", "Beat a bot without losing a single stone."],
    ]],
    ["Puzzles", [
      ["first-puzzle", "🧩", "First puzzle", "Solve your first puzzle."],
      ["puzzles-beginner", "🟢", "Beginner done", "Solve every Beginner puzzle."],
      ["puzzles-intermediate", "🟡", "Intermediate done", "Solve every Intermediate puzzle."],
      ["puzzles-advanced", "🔴", "Advanced done", "Solve every Advanced puzzle."],
      ["daily-puzzle-7", "⭐", "Puzzle week", "Solve today's puzzle 7 days in a row."],
    ]],
    ["Online", [
      ["first-win", "🏅", "First rated win", "Win a rated game."],
      ["wins-10", "🥉", "10 wins", "Win 10 rated games."],
      ["wins-50", "🥈", "50 wins", "Win 50 rated games."],
      ["wins-100", "🥇", "100 wins", "Win 100 rated games."],
      ["rating-1400", "📈", "Rating 1400", "Reach a rating of 1400."],
      ["rating-1600", "🚀", "Rating 1600", "Reach a rating of 1600."],
      ["rating-1800", "👑", "Rating 1800", "Reach a rating of 1800."],
      ["win-streak-3", "⚡", "Hat trick", "Win 3 rated games in a row."],
      ["daily-win", "📅", "Daily winner", "Win a daily game."],
    ]],
    ["Fun", [
      ["first-friend", "🤝", "First friend", "Add your first friend."],
      ["big-capture", "💥", "Big capture", "Capture 10 or more stones with one move, against a bot or online."],
      ["half-point", "✂️", "By a hair", "Win a daily game by half a point."],
      ["all-sizes", "📐", "Every size", "Win a game on 9×9, 13×13 and 19×19."],
      ["stylist", "🎨", "Stylist", "Try 5 different boards in the Look window."],
    ]],
    ["Streak", [
      ["streak-3", "🔥", "3-day streak", "Play 3 days in a row."],
      ["streak-7", "🔥", "7-day streak", "Play 7 days in a row."],
      ["streak-30", "🔥", "30-day streak", "Play 30 days in a row."],
      ["streak-100", "🔥", "100-day streak", "Play 100 days in a row."],
    ]],
  ];
  const BY_ID = new Map();
  for (const [, list] of GROUPS) for (const [id, icon, title, how] of list) BY_ID.set(id, { id, icon, title, how });

  // ---- Banner and chime ----

  let toastBox = null;
  function chime() {
    if (!window.GoSounds || window.GoSounds.isMuted()) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = chime.ctx || (chime.ctx = new AudioContextClass());
    [784, 988, 1319].forEach((freq, k) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const start = ctx.currentTime + k * 0.11;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  function announce(id) {
    const a = BY_ID.get(id);
    if (!a) return;
    if (!toastBox) {
      toastBox = document.createElement("div");
      toastBox.className = "achievement-toasts";
      document.body.append(toastBox);
    }
    const toast = document.createElement("a");
    toast.className = "achievement-toast";
    toast.href = "achievements.html";
    const icon = document.createElement("span");
    icon.className = "achievement-icon";
    icon.textContent = a.icon;
    const words = document.createElement("span");
    const head = document.createElement("small");
    head.textContent = t("🏆 Achievement unlocked");
    const title = document.createElement("b");
    title.textContent = t(a.title);
    words.append(head, title);
    toast.append(icon, words);
    toastBox.append(toast);
    chime();
    setTimeout(() => toast.classList.add("leaving"), 5000);
    setTimeout(() => toast.remove(), 5600);
  }

  // ---- Talking to the database ----

  let mine = null; // Set of my achievement ids, once loaded
  async function loadMine() {
    const p = me();
    if (!p) return new Set();
    if (!mine) {
      const { data } = await accounts().client.from("player_achievements").select("achievement").eq("player", p.id);
      mine = new Set((data || []).map((r) => r.achievement));
    }
    return mine;
  }

  async function claim(id, proof = null) {
    if (!me()) return;
    const have = await loadMine();
    if (have.has(id)) return;
    const { data, error } = await accounts().client.rpc("claim_achievement", { p_id: id, p_proof: proof });
    if (error) return;
    have.add(id);
    if (data) announce(id);
  }

  async function check() {
    if (!me()) return;
    const { data, error } = await accounts().client.rpc("check_my_achievements");
    if (error || !data) return;
    const have = await loadMine();
    for (const id of data) { have.add(id); announce(id); }
  }

  function localDay(offset = 0) {
    const d = new Date(Date.now() + offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Played today: keeps the streak going (once per day), then looks for new achievements.
  let activeToday = false;
  async function activity() {
    if (!me()) return;
    if (!activeToday) {
      const { error } = await accounts().client.rpc("record_activity", { p_day: localDay() });
      if (!error) {
        activeToday = true;
        await accounts().refreshProfile(); // the streak next to your name
      }
    }
    await check();
  }

  // The streak to show: it only counts if you played today or yesterday.
  function currentStreak(profile) {
    if (!profile || !profile.streak || !profile.streak_day) return 0;
    return profile.streak_day >= localDay(-1) ? profile.streak : 0;
  }

  // ---- What pages report ----

  const BOT_IDS = ["beat-pebble", "beat-sprout", "beat-fox", "beat-tiger", "beat-dragon"];

  // A bot game you won, from the normal start position and without undo.
  // game: the GoGame; proof: what the admin needs to replay it.
  function botWin({ level, size, lostStones, proof }) {
    if (BOT_IDS[level - 1]) claim(BOT_IDS[level - 1], proof);
    if (level === 5 && size === 19) claim("dragon-19", proof);
    if (lostStones === 0) claim("flawless", proof);
  }

  // Any finished game against a bot or online: streak. A fair win also counts toward
  // "Every size" (a win on all three boards; resigning on purpose doesn't count).
  function gameFinished(size, online, fairWin) {
    if (!me()) return; // achievements and streaks are only for logged-in players
    activity();
    if (fairWin) {
      let sizes = [];
      try { sizes = JSON.parse(localStorage.getItem("goboard-sizes-won") || "[]"); } catch { /* starts empty */ }
      if (!sizes.includes(size)) sizes.push(size);
      try { localStorage.setItem("goboard-sizes-won", JSON.stringify(sizes)); } catch { /* not saved */ }
      if ([9, 13, 19].every((s) => sizes.includes(s))) claim("all-sizes");
    }
    if (online) setTimeout(check, 5000); // rated results take a moment to be saved
  }

  // solvedByLevel: { beginner: [done, total], ... }
  async function puzzleSolved({ isDaily, solvedByLevel }) {
    if (!me()) return;
    claim("first-puzzle");
    for (const level of ["beginner", "intermediate", "advanced"]) {
      const [done, total] = solvedByLevel[level] || [0, 1];
      if (total && done >= total) claim(`puzzles-${level}`);
    }
    if (isDaily) await accounts().client.rpc("record_daily_puzzle", { p_day: localDay() });
    activity();
  }

  function boardTried(count) {
    if (count >= 5) claim("stylist");
  }

  // Look for new database-checked achievements whenever someone logs in.
  if (accounts()) {
    let lastUser = null;
    accounts().onChange(({ profile }) => {
      const id = profile ? profile.id : null;
      if (id === lastUser) return;
      lastUser = id;
      mine = null;
      activeToday = false;
      if (id) check();
    });
  }

  window.GoAchievements = {
    GROUPS, BY_ID, claim, check, activity, botWin, gameFinished, puzzleSolved, boardTried,
    currentStreak, loggedIn: () => Boolean(me()),
  };
})();
