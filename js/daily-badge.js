// The "Daily" menu item shows how many daily games are waiting for your move.
(function () {
  const accounts = window.GoAccounts;
  if (!accounts || !accounts.ready) return;
  const CHECK_EVERY_MS = 60000;

  const badge = document.createElement("span");
  badge.className = "nav-badge";
  badge.hidden = true;

  async function update() {
    const link = document.querySelector(".daily-link");
    if (link && !badge.isConnected) link.append(badge);
    const me = accounts.current().profile;
    if (!me) {
      badge.hidden = true;
      return;
    }
    const { data, error } = await accounts.client.from("daily_games").select("id")
      .eq("status", "playing")
      .or(`and(black.eq.${me.id},turn.eq.black),and(white.eq.${me.id},turn.eq.white)`);
    if (error) return; // e.g. the daily games database step isn't set up yet
    badge.textContent = String(data.length);
    badge.hidden = data.length === 0;
  }

  accounts.onChange(update);
  setInterval(update, CHECK_EVERY_MS);
  window.GoDailyBadge = { update };
})();
