// The extra parts of a player's profile (leaderboard.html?player=NAME): rating graph, stats,
// "Add friend" / "Daily challenge" buttons, and the Edit profile box on your own profile.
// leaderboard-page.js builds the page and puts these in. Text from players uses textContent.
(function () {
  const { t } = window.GoI18n;
  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(text, className, onClick) {
    const b = element("button", `btn ${className || ""}`, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- Rating graph ----

  // changes: [{ when, change }] for every rated result. The rating now is known, so walk
  // backwards from it to find the rating after each game.
  function ratingPoints(rating, changes) {
    const sorted = changes.filter((c) => typeof c.change === "number")
      .sort((a, b) => new Date(a.when) - new Date(b.when));
    const points = [];
    let r = rating;
    for (let k = sorted.length - 1; k >= 0; k--) {
      points.unshift({ when: sorted[k].when, rating: r });
      r -= sorted[k].change;
    }
    if (points.length) points.unshift({ when: null, rating: r }); // the rating before the first game
    return points;
  }

  function ratingGraph(rating, changes) {
    const box = element("div", "panel-block");
    box.append(element("h2", "", t("Rating graph")));
    const points = ratingPoints(rating, changes);
    if (points.length < 2) {
      box.append(element("p", "message", t("Play rated games to see the rating graph here.")));
      return box;
    }
    const W = 600, H = 170, PAD_L = 44, PAD_R = 10, PAD_T = 10, PAD_B = 24;
    const values = points.map((p) => p.rating);
    let low = Math.min(...values), high = Math.max(...values);
    if (high - low < 40) { const mid = (high + low) / 2; low = mid - 20; high = mid + 20; }
    const x = (k) => PAD_L + (k / (points.length - 1)) * (W - PAD_L - PAD_R);
    const y = (v) => PAD_T + (1 - (v - low) / (high - low)) * (H - PAD_T - PAD_B);
    const line = points.map((p, k) => `${x(k).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
    const area = `${PAD_L},${H - PAD_B} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD_B}`;
    const firstDate = points[1].when, lastDate = points[points.length - 1].when;
    const label = (lx, ly, text, anchor) =>
      `<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="rg-label">${text}</text>`;
    box.insertAdjacentHTML("beforeend", `<svg class="rating-graph" viewBox="0 0 ${W} ${H}" role="img">
      <line x1="${PAD_L}" y1="${y(high)}" x2="${W - PAD_R}" y2="${y(high)}" class="rg-grid"/>
      <line x1="${PAD_L}" y1="${y(low)}" x2="${W - PAD_R}" y2="${y(low)}" class="rg-grid"/>
      <polygon points="${area}" class="rg-area"/>
      <polyline points="${line}" class="rg-line"/>
      <circle cx="${x(points.length - 1)}" cy="${y(rating)}" r="4" class="rg-dot"/>
      ${label(PAD_L - 6, y(high) + 4, Math.round(high), "end")}
      ${label(PAD_L - 6, y(low) + 4, Math.round(low), "end")}
      ${label(PAD_L, H - 6, new Date(firstDate).toLocaleDateString(), "start")}
      ${label(W - PAD_R, H - 6, new Date(lastDate).toLocaleDateString(), "end")}
    </svg>`);
    const best = Math.max(...values);
    box.append(element("p", "message", t("{n} rated games · Highest rating: {best}", { n: points.length - 1, best })));
    return box;
  }

  // ---- Stats ----

  // games: [{ when, won, size, rated, daily }] (newest first), from leaderboard-page.js.
  function stats(games) {
    const box = element("div", "panel-block");
    box.append(element("h2", "", t("Stats")));
    if (!games.length) {
      box.append(element("p", "message", t("No saved games yet.")));
      return box;
    }
    const wins = games.filter((g) => g.won).length;
    let streak = 0, best = 0;
    for (const g of [...games].reverse()) { streak = g.won ? streak + 1 : 0; best = Math.max(best, streak); }
    const daily = games.filter((g) => g.daily).length;
    const rated = games.filter((g) => !g.daily && g.rated).length;
    const row = element("div", "stat-row");
    for (const [label, value] of [[t("Games"), games.length], [t("Win %"), `${Math.round((wins / games.length) * 100)}%`],
      [t("Longest win streak"), best], [t("Rated"), rated], [t("Casual"), games.length - rated - daily], [t("Daily"), daily]]) {
      const stat = element("div", "stat");
      stat.append(element("b", "", String(value)), element("span", "", label));
      row.append(stat);
    }
    box.append(row);
    const sizes = element("div", "stat-row size-stats");
    for (const size of [9, 13, 19]) {
      const played = games.filter((g) => g.size === size);
      const won = played.filter((g) => g.won).length;
      const stat = element("div", "stat");
      stat.append(element("b", "", played.length ? `${won} / ${played.length - won}` : "–"),
        element("span", "", t("{size} won / lost", { size: `${size}×${size}` })));
      sizes.append(stat);
    }
    box.append(sizes);
    return box;
  }

  // ---- Buttons on someone else's profile ----

  async function actions(client, me, player) {
    const box = element("div", "profile-actions");
    const note = element("p", "message");
    if (!me) {
      note.textContent = t("Log in to add friends or send daily challenges.");
      box.append(note);
      return box;
    }
    const { data } = await client.from("friendships").select("requester, addressee, status")
      .or(`and(requester.eq.${me.id},addressee.eq.${player.id}),and(requester.eq.${player.id},addressee.eq.${me.id})`);
    const link = (data || [])[0];
    let friendButton;
    if (link && link.status === "accepted") {
      friendButton = element("span", "friend-state", t("Friends ✓"));
    } else if (link && link.requester === me.id) {
      friendButton = element("span", "friend-state", t("Friend request sent"));
    } else {
      friendButton = button(link ? t("Accept friend request") : t("Add friend"), "btn-primary", async () => {
        friendButton.disabled = true;
        const { data: answer, error } = await client.rpc("send_friend_request", { friend_name: player.username });
        if (error) {
          friendButton.disabled = false;
          note.textContent = errorText(error);
          return;
        }
        const state = element("span", "friend-state", answer === "accepted" ? t("Friends ✓") : t("Friend request sent"));
        friendButton.replaceWith(state);
      });
    }
    const challenge = element("a", "btn", t("Daily challenge"));
    challenge.href = `daily.html?challenge=${encodeURIComponent(player.id)}`;
    box.append(friendButton, challenge, note);
    return box;
  }

  // ---- Edit profile (your own) ----

  function editBox(client, player, onSaved) {
    const box = element("div", "panel-block profile-edit");
    box.hidden = true;
    box.append(element("h2", "", t("Edit profile")), element("p", "label", t("Picture")));
    let avatar = player.avatar || null;
    const grid = element("div", "avatar-grid");
    for (const key of [null, ...window.GoAvatars.names]) {
      const b = element("button", key === avatar ? "selected" : "");
      b.type = "button";
      b.title = key ? "" : t("No picture");
      b.append(window.GoAvatars.element(key, player.username, 36));
      b.addEventListener("click", () => {
        avatar = key;
        for (const other of grid.children) other.classList.toggle("selected", other === b);
      });
      grid.append(b);
    }
    const about = element("textarea", "about-input");
    about.maxLength = 160;
    about.rows = 3;
    about.value = player.about || "";
    about.placeholder = t("A few words about you (English or Chinese)");
    const count = element("p", "message char-count");
    const updateCount = () => { count.textContent = `${about.value.length} / 160`; };
    about.addEventListener("input", updateCount);
    updateCount();
    const note = element("p", "message");
    const save = button(t("Save"), "btn-primary", async () => {
      const text = about.value.replace(/\s+/g, " ").trim();
      if (!window.GoChatFilter.isAllowedText(text)) {
        note.textContent = t("About me can only use English and Chinese");
        return;
      }
      save.disabled = true;
      const clean = window.GoChatFilter.cleanMessage(text);
      const { error } = await client.rpc("set_my_profile", { p_avatar: avatar, p_about: clean });
      save.disabled = false;
      if (error) {
        note.textContent = errorText(error);
        return;
      }
      onSaved();
    });
    box.append(grid, element("p", "label", t("About me")), about, count, save, note);
    return box;
  }

  window.GoProfileExtras = { ratingGraph, stats, actions, editBox };
})();
