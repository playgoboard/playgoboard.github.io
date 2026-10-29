// Sharing a game as a link. The whole game travels inside the link (like an SGF file: two letters
// per move, a–s for each line, "tt" for a pass), so any game can be shared (bots, friends, online)
// without saving anything. The link opens the replay view on leaderboard.html.
(function () {
  const { t } = window.GoI18n;
  const LETTERS = "abcdefghijklmnopqrs";
  const MAX_NAME = 40;

  // moves: [[x, y] | "pass"] (as saved by js/game-history.js). result: "B+R", "W+3.5"… or "".
  function link({ size, moves, black, white, result }) {
    const params = new URLSearchParams({
      replay: "1", s: String(size),
      m: moves.map((m) => (m === "pass" ? "tt" : LETTERS[m[0]] + LETTERS[m[1]])).join(""),
      b: String(black || "").slice(0, MAX_NAME), w: String(white || "").slice(0, MAX_NAME),
      r: result || "", d: new Date().toISOString().slice(0, 10),
    });
    const base = new URL("leaderboard.html", window.location.href);
    return `${base.origin}${base.pathname}?${params}`;
  }

  // The game from a shared link, or null if the link is broken.
  function read(params) {
    const size = Number(params.get("s"));
    const packed = params.get("m") || "";
    if (![9, 13, 19].includes(size) || packed.length % 2 || packed.length > 3000) return null;
    const moves = [];
    for (let i = 0; i < packed.length; i += 2) {
      const pair = packed.slice(i, i + 2);
      if (pair === "tt") { moves.push("pass"); continue; }
      const x = LETTERS.indexOf(pair[0]), y = LETTERS.indexOf(pair[1]);
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      moves.push([x, y]);
    }
    const result = params.get("r") || "";
    return {
      size, moves,
      black: (params.get("b") || t("Black")).slice(0, MAX_NAME),
      white: (params.get("w") || t("White")).slice(0, MAX_NAME),
      result: /^[BW]\+(R|T|\d+(\.5)?)$/.test(result) ? result : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("d") || "") ? params.get("d") : null,
    };
  }

  // The phone's or iPad's share sheet when there is one; otherwise copy the link.
  // Resolves to a short message for the page (or "" when the share sheet handled it).
  async function share(url) {
    if (navigator.share) {
      try {
        await navigator.share({ title: t("A game of Go on GoBoard"), url });
        return "";
      } catch (error) {
        if (error && error.name === "AbortError") return ""; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      return t("Link copied! Send it to anyone: it opens the whole game.");
    } catch {
      return t("Copy this link: {link}", { link: url });
    }
  }

  window.GoShare = { link, read, share };
})();
