// Game history: saves finished online games to the logged-in player's own history,
// and turns saved games back into something the Leaderboard page can replay.
// The database rules are in supabase/05-game-history.sql.
(function () {
  const { BLACK, WHITE } = window.Go;
  const colorName = (color) => (color === BLACK ? "black" : "white");
  const accounts = () => (window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts : null);

  // "B+R" = Black won by resignation, "W+T" = White won on time, "B+3.5" = Black won by 3.5 points.
  function resultCode(result) {
    const winner = result.winner === BLACK ? "B" : "W";
    if (result.byResignation) return `${winner}+R`;
    if (result.byTimeout) return `${winner}+T`;
    return `${winner}+${result.margin}`;
  }

  function resultWords(code) {
    const [who, how] = code.split("+");
    const winner = who === "B" ? "Black" : "White";
    if (how === "R") return `${winner} won by resignation`;
    if (how === "T") return `${winner} won on time`;
    return `${winner} won by ${how} points`;
  }

  // game: { gameKey, myColor, opponent, size, moves, result, ratedGameId, quick }
  async function save(game) {
    const acc = accounts();
    if (!acc || !acc.current().profile || !game.result) return;
    const opponent = game.opponent || {};
    const name = opponent.id ? opponent.username : opponent.level ? `Guest (${opponent.level})` : "Guest";
    const { error } = await acc.client.rpc("save_game_record", {
      p_game_key: game.gameKey,
      p_my_color: colorName(game.myColor),
      p_opponent: opponent.id || null,
      p_opponent_name: name,
      p_size: game.size,
      p_moves: game.moves.map((m) => (m.pass ? "pass" : [m.x, m.y])),
      p_winner: colorName(game.result.winner),
      p_result: resultCode(game.result),
      p_rated_game_id: game.ratedGameId || null,
      p_quick: Boolean(game.quick),
    });
    if (error) console.warn("This game couldn't be saved to your history:", error.message);
  }

  // Rebuild a saved game so it can be stepped through. Passes, and play that went on
  // after both players passed ("Keep playing"), are replayed the same way as in the game.
  function rebuild(size, savedMoves) {
    const game = new window.Go.GoGame(size);
    for (const m of savedMoves) {
      if (game.phase === "scoring") game.resumePlay();
      if (m === "pass") game.pass();
      else game.play(m[0], m[1]);
    }
    return game;
  }

  window.GoHistory = { save, rebuild, resultWords, colorName, BLACK, WHITE };
})();
