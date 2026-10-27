// Talks to the rated-game functions in the database (supabase/02-rated-games.sql).
// The database decides whether a result counts, so a modified page can't change ratings.
(function () {
  const { BLACK, WHITE } = window.Go;
  const colorName = (color) => (color === BLACK ? "black" : "white");
  const RESULT_WAIT_MS = 15000; // how long to wait for the friend's browser to confirm the result
  const RESULT_POLL_MS = 1500;

  const client = () => window.GoAccounts && window.GoAccounts.client;
  const me = () => (window.GoAccounts ? window.GoAccounts.current().profile : null);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function friendlyError(error) {
    const text = (error && error.message) || String(error);
    return text.replace(/^.*?:\s*/, "") || "Something went wrong.";
  }

  async function profile(id) {
    const { data } = await client().from("profiles").select("*").eq("id", id).maybeSingle();
    return data;
  }

  async function fetchGame(gameId) {
    const { data, error } = await client().from("rated_games").select("*").eq("id", gameId).maybeSingle();
    if (error) throw new Error(friendlyError(error));
    return data;
  }

  // Creator: start a rated game against the joiner. Returns the game id.
  async function start(opponentId, myColor, size) {
    const { data, error } = await client().rpc("start_rated_game", {
      opponent: opponentId, my_color: colorName(myColor), size,
    });
    if (error) throw new Error(friendlyError(error));
    return data;
  }

  // Joiner: check the game is really ours with the right color, then confirm it.
  async function join(gameId, myColor) {
    const mine = me();
    const game = await fetchGame(gameId);
    if (!mine || !game || game[colorName(myColor)] !== mine.id) throw new Error("This rated game doesn't match your account.");
    const { error } = await client().rpc("join_rated_game", { game: gameId });
    if (error) throw new Error(friendlyError(error));
    return game;
  }

  // Both players: report the winner, then wait a little for the other report so we can show the rating change.
  async function report(gameId, winnerColor) {
    let { data, error } = await client().rpc("report_result", { game: gameId, winner_color: colorName(winnerColor) });
    if (error) throw new Error(friendlyError(error));
    const deadline = Date.now() + RESULT_WAIT_MS;
    while (!data.finished_at && Date.now() < deadline) {
      await delay(RESULT_POLL_MS);
      data = await fetchGame(gameId);
    }
    return data;
  }

  async function finalizeStale() {
    if (!client() || !me()) return;
    const { data } = await client().rpc("finalize_my_stale_games");
    if (data > 0) await window.GoAccounts.refreshProfile();
  }

  window.GoRated = { start, join, report, fetchGame, profile, finalizeStale, colorName };
})();
