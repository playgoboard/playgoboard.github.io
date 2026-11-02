// Rated puzzles (rated-puzzles.html): a puzzle rating that goes up and down, and each next puzzle is
// picked near your rating by the database (supabase/24-puzzle-rating.sql). One try per puzzle: the
// try starts when the puzzle is handed out, so reloading the page brings the same puzzle back.
// The puzzles are Rush's (js/rush-puzzles.js); the database knows them by their place in that list.
(function () {
  const { t } = window.GoI18n;
  const $ = (id) => document.getElementById(id);
  const accounts = window.GoAccounts;

  let current = null;   // { index, puzzle } while it can be played
  let startedFor = null; // the account this page has started for
  const play = window.GoPuzzlePlay.create({
    boardEl: $("board"),
    canPlay: () => current !== null,
    onFinish: finish,
  });

  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));

  function showRating(rating, games) {
    $("rp-rating").textContent = String(rating);
    $("rp-games").textContent = t("Puzzles played: {n}", { n: games });
  }

  function showNote(text) {
    $("rp-prompt").textContent = text;
    $("rp-result").hidden = true;
    $("rp-next").hidden = true;
    $("rp-answer").hidden = true;
  }

  async function next() {
    current = null;
    $("rp-result").hidden = true;
    $("rp-next").hidden = true;
    $("rp-answer").hidden = true;
    $("rp-prompt").textContent = t("Loading…");
    const { data, error } = await accounts.client.rpc("puzzle_next");
    if (error) {
      showNote(errorText(error));
      $("rp-next").hidden = false;
      return;
    }
    showRating(data.my_rating, data.games);
    if (data.done) {
      showNote(t("You've played every rated puzzle. Amazing! More are coming."));
      return;
    }
    const puzzle = window.GO_RUSH_PUZZLES[data.puzzle];
    if (!puzzle) { // the database knows newer puzzles than this copy of the page
      showNote(t("Please refresh the page to get the newest version of GoBoard"));
      return;
    }
    current = { index: data.puzzle, puzzle };
    play.load(puzzle);
    $("rp-prompt").textContent = puzzle.moves === 1 ? t("Black to play. Capture the marked stones in 1 move.")
      : t("Black to play. Capture the marked stones in {n} moves.", { n: puzzle.moves });
    if (window.matchMedia("(max-width: 1000px)").matches) document.querySelector(".board-column").scrollIntoView({ block: "start" });
  }

  async function finish(solved) {
    const { index } = current;
    current = null;
    play.draw();
    if (solved) window.GoSounds.capture(2);
    $("rp-prompt").textContent = t("Saving…");
    const { data, error } = await accounts.client.rpc("puzzle_finish", { p_puzzle: index, p_solved: solved });
    $("rp-next").hidden = false;
    if (error) {
      $("rp-prompt").textContent = errorText(error);
      return;
    }
    showRating(data.my_rating, data.games);
    const signed = `${data.change >= 0 ? "+" : ""}${data.change}`;
    $("rp-prompt").textContent = solved ? t("Solved!") : t("Not this time.");
    const result = $("rp-result");
    result.hidden = false;
    result.className = `rp-result ${solved ? "ok" : "bad"}`;
    result.textContent = signed;
    $("rp-puzzle-rating").textContent = t("This puzzle's rating: {n}", { n: data.puzzle_rating });
    $("rp-answer").hidden = solved;
    if (window.GoAchievements) window.GoAchievements.activity(); // counts for the daily streak
  }

  $("rp-next").addEventListener("click", () => {
    $("rp-puzzle-rating").textContent = "";
    next();
  });
  $("rp-answer").addEventListener("click", () => {
    $("rp-answer").hidden = true;
    play.showAnswer();
  });

  if (!accounts || !accounts.ready) {
    showNote(t("The leaderboard couldn't load. Check your internet connection and reload the page."));
    return;
  }
  showNote(t("Loading…"));
  accounts.onChange(({ profile }) => {
    if (!profile) {
      startedFor = null;
      current = null;
      showNote(t("Log in to get a puzzle rating. It goes up when you solve a puzzle and down when you miss one."));
      return;
    }
    if (startedFor === profile.id) return;
    startedFor = profile.id;
    next();
  });
})();
