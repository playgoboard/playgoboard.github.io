// Quick match: play a stranger who picked the same board size, clock and game type,
// preferring a close rating. The database keeps the waiting line (supabase/04-quick-match.sql);
// the game itself uses the same online rooms as playing a friend (online-lobby.js).
//
// While searching, each player already hosts a room. When the database pairs two players,
// the one who found the match joins the other's room.
(function () {
  // Players without an account pick a level; it counts as a rating for pairing only.
  const LEVELS = [
    { name: "Beginner", rating: 400 },
    { name: "Novice", rating: 800 },
    { name: "Intermediate", rating: 1200 },
    { name: "Advanced", rating: 1600 },
    { name: "Expert", rating: 2000 },
  ];
  window.GoLevels = { isLevel: (name) => LEVELS.some((level) => level.name === name) };

  const LEVEL_KEY = "goboard-level";
  const POLL_MS = 2500;        // ask the database this often, plus up to 1 s at random
  const ARRIVE_WAIT_MS = 30000; // paired, but the opponent never arrived: search again

  const $ = (id) => document.getElementById(id);
  const accounts = window.GoAccounts;
  const lobby = window.GoLobby;
  if (!accounts || !accounts.ready || !lobby) return; // no database: Quick match stays hidden
  $("quick-section").hidden = false;

  let level = null;
  try { level = localStorage.getItem(LEVEL_KEY); } catch { /* private window: ask each time */ }
  if (!window.GoLevels.isLevel(level)) level = null;

  let search = null; // { ticket, setup, level, rating, session, room, startedAt, pairedAt, timer, clockTimer }

  const loggedIn = () => Boolean(accounts.current().profile);
  const onlineSelected = () => document.querySelector("#mode-picker [data-mode='online']").classList.contains("selected");

  // ---- Level picker (only shown when logged out) ----

  function drawLevels() {
    $("level-options").hidden = loggedIn();
    const picker = $("level-picker");
    picker.textContent = "";
    for (const { name } of LEVELS) {
      const button = document.createElement("button");
      button.textContent = name;
      button.classList.toggle("selected", name === level);
      button.addEventListener("click", () => {
        level = name;
        try { localStorage.setItem(LEVEL_KEY, name); } catch { /* remembered for this visit only */ }
        drawLevels();
      });
      picker.append(button);
    }
  }

  // ---- The "Looking for an opponent" box ----

  function showSearching(on) {
    $("quick-box").hidden = !on;
    if (on) $("online-options").hidden = true;
    else if (onlineSelected()) $("online-options").hidden = false;
  }

  function setText(text) {
    $("quick-text").textContent = text;
  }

  function drawTime() {
    if (!search) return;
    const seconds = Math.floor((Date.now() - search.startedAt) / 1000);
    $("quick-time").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function settingsText(setup) {
    const clock = setup.clock.minutes ? `${setup.clock.minutes} min${setup.clock.bonus ? ` +${setup.clock.bonus}s` : ""}` : "No clock";
    return `${setup.size}×${setup.size} · ${clock} · ${setup.rated ? "Rated" : "Casual"}`;
  }

  // ---- Searching ----

  function begin() {
    if (lobby.peerJsMissing()) return;
    const profile = accounts.current().profile;
    const setup = window.GoPage.getSetup();
    if (setup.rated && !profile) return lobby.showStatus("Log in (top right) to play rated games, or pick Casual.");
    if (!profile && !level) return lobby.showStatus("Pick your level first, so you get a fair opponent.");
    stop();
    lobby.showStatus("");
    search = {
      setup,
      level: profile ? null : level,
      rating: profile ? profile.rating : LEVELS.find((l) => l.name === level).rating,
      startedAt: Date.now(),
    };
    search.clockTimer = setInterval(drawTime, 1000);
    $("quick-settings").textContent = settingsText(setup);
    drawTime();
    showSearching(true);
    hostRoom(search);
  }

  // Wait in the line with a room of our own (a fresh ticket each time).
  function hostRoom(s) {
    s.ticket = crypto.randomUUID();
    s.room = null;
    s.pairedAt = null;
    setText("Looking for an opponent");
    const { BLACK, WHITE } = window.Go;
    const settings = { ...s.setup, color: Math.random() < 0.5 ? BLACK : WHITE };
    s.session = lobby.startHost(settings, {
      onCode: (code) => {
        if (s !== search) return;
        s.room = code;
        poll(s);
      },
      onStart: () => done(s),
      onFail: (type) => {
        if (s !== search) return;
        stop();
        lobby.showStatus(lobby.errorText(type));
      },
    }, { quick: true, level: s.level });
  }

  function later(s) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => poll(s), POLL_MS + Math.random() * 1000);
  }

  async function poll(s) {
    if (s !== search || !s.room) return;
    // Another online game replaced our room (e.g. "Create online game" was clicked).
    if (!lobby.isCurrent(s.session)) return stop();
    if (s.pairedAt) {
      if (Date.now() - s.pairedAt > ARRIVE_WAIT_MS) return searchAgain(s);
      return later(s);
    }
    const { data, error } = await accounts.client.rpc("quick_match", {
      p_ticket: s.ticket, p_room: s.room, p_size: s.setup.size, p_minutes: s.setup.clock.minutes,
      p_bonus: s.setup.clock.bonus, p_rated: s.setup.rated, p_rating: s.rating,
    });
    if (s !== search) return;
    if (error) {
      stop();
      const text = (error.message || "").replace(/^.*?:\s*/, "");
      lobby.showStatus(/fetch|network/i.test(text) ? "Can't reach the server. Check your internet connection." : text);
      return;
    }
    if (data.status === "found") return joinRoom(s, data.room);
    if (data.status === "matched") {
      s.pairedAt = Date.now();
      setText("Opponent found! Connecting");
    }
    later(s);
  }

  // The database paired us with someone who is already waiting: join their room.
  function joinRoom(s, room) {
    clearTimeout(s.timer);
    s.room = null;
    setText("Opponent found! Connecting");
    s.session = lobby.startGuest(room, {
      onStart: () => done(s),
      onFail: () => { if (s === search) searchAgain(s); },
    }, { level: s.level });
  }

  // The opponent left before the game started: back in the line.
  function searchAgain(s) {
    leaveLine(s.ticket);
    clearTimeout(s.timer);
    hostRoom(s);
  }

  function leaveLine(ticket) {
    if (ticket) accounts.client.rpc("quick_match_leave", { p_ticket: ticket }).then(() => {}, () => {});
  }

  // The game started (the online code takes over from here).
  function done(s) {
    if (s !== search) return;
    clearTimeout(s.timer);
    clearInterval(s.clockTimer);
    leaveLine(s.ticket);
    search = null;
    showSearching(false);
  }

  // Cancel, or leaving the Online screen.
  function stop() {
    const s = search;
    if (!s) return;
    search = null;
    clearTimeout(s.timer);
    clearInterval(s.clockTimer);
    leaveLine(s.ticket);
    if (lobby.isCurrent(s.session)) lobby.stop();
    showSearching(false);
  }

  $("btn-quick").addEventListener("click", begin);
  $("btn-cancel-quick").addEventListener("click", () => { stop(); lobby.showStatus(""); });
  for (const picker of [$("mode-picker"), $("nav")]) {
    picker.addEventListener("click", () => {
      if (!search) return;
      if (onlineSelected()) $("online-options").hidden = true; // keep showing the search
      else stop();
    });
  }
  accounts.onChange(drawLevels);
  drawLevels();
})();
