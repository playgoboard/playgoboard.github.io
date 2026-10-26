// The watch page (watch.html?game=KEY): a friend's live online game, updated every 2 seconds.
// The database decides who may watch (friends of the players, or the admin with the admin code:
// watch.html?game=KEY&admin=1). Watchers only look: they can't play or talk to the players.
(function () {
  const { t } = window.GoI18n;
  const { BLACK, WHITE } = window.Go;
  const accounts = window.GoAccounts;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const key = params.get("game");
  const asAdmin = params.get("admin") === "1";
  const POLL_MS = 2000;

  let code = null;     // the admin code, only while this page is open
  let timer = null;
  let shownMoves = -1;

  function problem(text) {
    $("watch-status").textContent = text;
    $("watch-board").hidden = true;
  }

  function draw(g) {
    $("watch-board").hidden = false;
    $("name-black").textContent = g.black_name;
    $("name-white").textContent = g.white_name;
    const game = window.GoHistory.rebuild(g.size, g.moves);
    const last = game.moves[game.moves.length - 1];
    if (g.moves.length !== shownMoves) {
      if (shownMoves >= 0 && last && !last.pass) window.GoSounds.stone();
      shownMoves = g.moves.length;
    }
    $("board").innerHTML = window.GoBoardView.renderBoard({
      size: g.size, board: game.board, ghostColor: null,
      lastMove: last && !last.pass ? last.y * g.size + last.x : null,
    });
    $("info-black").textContent = t("Captured: {n}", { n: game.captures[BLACK] });
    $("info-white").textContent = `${t("Captured: {n}", { n: game.captures[WHITE] })} · ${t("Komi 7.5")}`;
    const toMove = game.turn === BLACK ? g.black_name : g.white_name;
    $("watch-status").textContent = g.result ? window.GoHistory.resultWords(g.result)
      : g.live ? t("🔴 Live · {name} to play", { name: toMove }) : t("The players haven't moved for a while. They may have left.");
    $("watch-moves").textContent = t("Move {n}", { n: g.moves.length });
    $("watch-count").textContent = g.watching ? (g.watching === 1 ? t("👁 1 friend watching") : t("👁 {n} friends watching", { n: g.watching })) : "";
    document.title = `GoBoard — ${g.black_name} vs ${g.white_name}`;
  }

  async function poll() {
    const { data, error } = await accounts.client.rpc("watch_game", { p_key: key, p_code: code });
    if (error) {
      $("watch-status").textContent = t("Couldn't load this. Check your internet connection and try again.");
    } else if (data.error) {
      clearInterval(timer);
      return problem(t(data.error));
    } else {
      draw(data);
      if (data.result) clearInterval(timer); // the game is over: nothing more to fetch
    }
  }

  async function start({ profile }) {
    clearInterval(timer);
    if (!key) return problem(t("That game wasn't found."));
    if (!profile) return problem(t("Log in to watch your friends' games."));
    if (asAdmin && !code) {
      code = await window.GoAdminCode.ask(t("Admin code to watch this game"));
      if (!code) return problem(t("Watching needs the admin code."));
    }
    await poll();
    timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }

  if (!accounts || !accounts.ready) return problem(t("Couldn't load this. Check your internet connection and try again."));
  let started = false;
  accounts.onChange((state) => {
    if (started && state.profile) return;
    started = Boolean(state.profile);
    start(state);
  });
})();
