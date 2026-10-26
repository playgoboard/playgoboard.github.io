// Watching live games (supabase/13-live-games.sql). While a logged-in player plays online,
// their browser copies the game to the database, so friends (and the admin, with the admin
// code) can watch it on watch.html. Only the database decides who may watch.
(function () {
  const accounts = () => (window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts : null);
  const me = () => (accounts() ? accounts().current().profile : null);
  const HEARTBEAT_MS = 20000; // check in this often even without moves, so the game counts as live

  // ---- For the game page: send the game, hear how many are watching ----

  let sent = { key: null, moves: -1, result: null, at: 0 };
  let sending = false;
  let onWatchers = () => {};

  // game: { key, size, myColor: "black"|"white", blackName, whiteName, moves: [[x,y]|"pass"], result: "B+R"|null }
  async function report(game) {
    if (!me() || !game.key || sending) return;
    const changed = sent.key !== game.key || sent.moves !== game.moves.length || sent.result !== game.result;
    if (!changed && Date.now() - sent.at < HEARTBEAT_MS) return;
    if (!changed && game.result) return; // finished and already sent
    sending = true;
    const { data, error } = await accounts().client.rpc("live_update", {
      p_key: game.key, p_size: game.size, p_my_color: game.myColor,
      p_black_name: game.blackName.slice(0, 40), p_white_name: game.whiteName.slice(0, 40),
      p_moves: game.moves, p_result: game.result,
    });
    sending = false;
    if (error) return;
    sent = { key: game.key, moves: game.moves.length, result: game.result, at: Date.now() };
    onWatchers(game.result ? 0 : data || 0);
  }

  // ---- For the Friends window and profiles ----

  async function friendGames() {
    if (!me()) return [];
    const { data, error } = await accounts().client.rpc("live_friend_games");
    return error ? [] : data;
  }

  // { key, as: "friend" | "admin" } or null
  async function playerGame(playerId) {
    if (!me()) return null;
    const { data, error } = await accounts().client.rpc("live_player_game", { p_player: playerId });
    return error ? null : data;
  }

  const watchLink = (key, asAdmin) => `watch.html?game=${encodeURIComponent(key)}${asAdmin ? "&admin=1" : ""}`;

  window.GoLive = {
    report, friendGames, playerGame, watchLink, HEARTBEAT_MS,
    onWatchers(fn) { onWatchers = fn; },
  };
})();
