// SGF files, the usual file type for Go games: writing a game to one, and reading one back.
// Moves are [x, y] or "pass" (as saved by js/game-history.js). Only the main line of a file is read.
(function () {
  const { t } = window.GoI18n;
  const LETTERS = "abcdefghijklmnopqrs";
  const MAX_NAME = 40;

  const escapeText = (text) => String(text || "").replace(/[\\\]]/g, "\\$&");

  // game: { size, moves, black, white, result ("B+R", "W+3.5"… or ""), date ("YYYY-MM-DD" or null) }
  function write(game) {
    const head = [`GM[1]FF[4]CA[UTF-8]AP[GoBoard]SZ[${game.size}]KM[7.5]RU[Chinese]`,
      `PB[${escapeText(game.black)}]PW[${escapeText(game.white)}]`];
    if (game.result) head.push(`RE[${game.result}]`);
    if (game.date) head.push(`DT[${game.date}]`);
    const moves = game.moves.map((m, k) =>
      `;${k % 2 ? "W" : "B"}[${m === "pass" ? "" : LETTERS[m[0]] + LETTERS[m[1]]}]`);
    return `(;${head.join("")}\n${moves.join("")})\n`;
  }

  // The nodes of the main line: [{ PROPERTY: [values] }]. A game ends at the first ")", and
  // side variations come after the main line in the file, so they're never reached.
  function mainLine(text) {
    const nodes = [];
    let node = null, i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ")") break;
      if (c === ";") { node = {}; nodes.push(node); i++; continue; }
      if (/[A-Za-z]/.test(c) && node) {
        let property = "";
        while (i < text.length && /[A-Za-z]/.test(text[i])) { property += text[i]; i++; }
        property = property.replace(/[a-z]/g, ""); // old files may write "GaMe" for "GM"
        node[property] = node[property] || [];
        while (/\s/.test(text[i] || "")) i++;
        while (text[i] === "[") {
          let value = "";
          i++;
          while (i < text.length && text[i] !== "]") {
            if (text[i] === "\\") i++;
            value += text[i] || "";
            i++;
          }
          i++;
          node[property].push(value);
          while (/\s/.test(text[i] || "")) i++;
        }
        continue;
      }
      i++;
    }
    return nodes;
  }

  // "B+Resign", "W+T", "B+3.5" become the short form used by replays. Anything else is left out.
  function shortResult(text) {
    const found = /^\s*([BW])\+(R|Resign|T|Time|\d{1,3}(?:\.5|\.0)?)\s*$/i.exec(text || "");
    if (!found) return "";
    const how = found[2].toUpperCase();
    const code = how[0] === "R" ? "R" : how[0] === "T" ? "T" : how.replace(/\.0$/, "");
    return `${found[1].toUpperCase()}+${code}`;
  }

  // Returns { game: { size, moves, black, white, result, date } } or { problem: "text for the player" }.
  function read(text) {
    const start = text.indexOf("(");
    if (start < 0 || !/^\s*;/.test(text.slice(start + 1))) return { problem: t("That isn't an SGF file.") };
    const nodes = mainLine(text.slice(start + 1));
    if (!nodes.length) return { problem: t("That isn't an SGF file.") };
    const first = nodes[0];
    const value = (property) => (first[property] ? first[property][0] : "");
    if (value("GM") && value("GM") !== "1") return { problem: t("That SGF file isn't a game of Go.") };
    const size = Number(value("SZ") || 19);
    if (![9, 13, 19].includes(size)) return { problem: t("Only 9×9, 13×13 and 19×19 games can be opened.") };

    const moves = [];
    for (const node of nodes) {
      if (node.AB || node.AW || node.AE) return { problem: t("Games with handicap or setup stones can't be opened yet.") };
      const color = node.B ? "B" : node.W ? "W" : null;
      if (!color) continue;
      if ((moves.length % 2 === 0) !== (color === "B")) return { problem: t("This game's moves don't take turns, so it can't be opened.") };
      const point = node[color][0] || "";
      if (point === "" || (point === "tt" && size <= 19)) { moves.push("pass"); continue; }
      const x = LETTERS.indexOf(point[0]), y = LETTERS.indexOf(point[1]);
      if (point.length !== 2 || x < 0 || y < 0 || x >= size || y >= size) return { problem: t("This file has a move outside the board.") };
      moves.push([x, y]);
    }
    if (!moves.length) return { problem: t("This file has no moves.") };
    if (moves.length > 1000) return { problem: t("This game is too long to open.") };

    // GoBoard's rules must allow every move, or the replay would quietly skip some.
    const rebuilt = window.GoHistory.rebuild(size, moves);
    if (rebuilt.moves.length !== moves.length) return { problem: t("This game has a move GoBoard's rules don't allow, so it can't be opened.") };

    const date = /^\d{4}-\d{2}-\d{2}/.exec(value("DT"));
    return { game: {
      size, moves,
      black: value("PB").slice(0, MAX_NAME) || t("Black"),
      white: value("PW").slice(0, MAX_NAME) || t("White"),
      result: shortResult(value("RE")),
      date: date ? date[0] : null,
    } };
  }

  // Saves the game on this device.
  function download(game) {
    const blob = new Blob([write(game)], { type: "application/x-go-sgf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const part = (name) => String(name).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 20);
    a.download = `goboard_${part(game.black)}_vs_${part(game.white)}.sgf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  window.GoSgf = { write, read, download };
})();
