// The Achievements page: your streak and every achievement, locked ones in gray.
(function () {
  const { t } = window.GoI18n;
  const box = document.getElementById("achievements-view");
  const accounts = window.GoAccounts;
  const ach = window.GoAchievements;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  async function draw({ profile }) {
    box.textContent = "";
    const head = element("div", "panel-block");
    head.append(element("h1", "", t("Achievements")));
    let unlocked = new Map();
    if (!profile) {
      head.append(element("p", "message", t("Log in to earn achievements and a daily streak. They are saved on your account.")));
      const login = element("button", "btn btn-primary", t("Log in"));
      login.addEventListener("click", () => accounts.showView("login"));
      head.append(login);
    } else {
      const { data } = await accounts.client.from("player_achievements").select("achievement, unlocked_at").eq("player", profile.id);
      unlocked = new Map((data || []).map((r) => [r.achievement, r.unlocked_at]));
      const streak = ach.currentStreak(profile);
      const streakBox = element("div", "streak-box");
      streakBox.append(element("span", "streak-fire", "🔥"),
        element("b", "", t("{n}-day streak", { n: streak })),
        element("span", "message", t("Best: {n} days", { n: profile.streak_best || 0 })));
      head.append(streakBox,
        element("p", "message", t("Solve a puzzle, finish a game against a bot or online, or make a daily move every day to keep your streak. Miss a day and it starts again.")),
        element("p", "message", t("{n} of {total} unlocked", { n: unlocked.size, total: ach.BY_ID.size })));
    }
    head.append(element("p", "message small-note", t("Bot achievements only count for games from the normal start, without Undo or Hint. The admin checks them: faking one means a 7-day ban and losing every achievement.")));
    box.append(head);

    for (const [group, list] of ach.GROUPS) {
      const section = element("div", "panel-block");
      const done = list.filter(([id]) => unlocked.has(id)).length;
      section.append(element("h2", "", `${t(group)} · ${done}/${list.length}`));
      const reward = window.GoAvatars && window.GoAvatars.REWARDS[group];
      if (reward) {
        // What finishing the whole group gives (js/avatars.js, supabase/14-rewards.sql).
        const earned = done === list.length;
        const box = element("div", `reward-box${earned ? " earned" : ""}`);
        const words = element("div");
        words.append(element("b", "", earned ? t("🎁 Reward unlocked!") : t("🎁 Reward: {n} left", { n: list.length - done })),
          element("span", "", t("Picture, title \"{title}\", {frame} frame and {look}", {
            title: t(reward.title), frame: t(reward.frame), look: t(reward.look[2]) })));
        if (earned) words.append(element("small", "", t("Pick them in Edit profile and the Look window.")));
        box.append(window.GoAvatars.element(reward.picture, "", 52, earned ? reward.frame : null), words);
        section.append(box);
      }
      const grid = element("div", "achievement-grid");
      for (const [id, icon, title, how] of list) {
        const when = unlocked.get(id);
        const card = element("div", `achievement-card${when ? "" : " locked"}`);
        const words = element("div");
        words.append(element("b", "", t(title)), element("span", "", t(how)));
        if (when) words.append(element("small", "", new Date(when).toLocaleDateString()));
        card.append(element("span", "achievement-icon", icon), words);
        grid.append(card);
      }
      section.append(grid);
      box.append(section);
    }
  }

  if (!accounts || !accounts.ready || !ach) {
    box.append(element("p", "message", t("Couldn't load this. Check your internet connection and try again.")));
    return;
  }
  accounts.onChange(draw);
})();
