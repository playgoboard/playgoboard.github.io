// The puzzles. Each one is a 9x9 position (rows from top = 9 to bottom = 1;
// X = Black, O = White, . = empty). Black always plays first and must capture
// at least one of the target groups within `moves` Black moves. The solver in
// puzzle-solver.js checks answers, so any move that really works counts.
// Every puzzle here was checked with the solver to have exactly one correct first move.
(function () {
  const E = "........."; // an empty row

  window.GO_PUZZLES = [
    // ---- Captures in one move ----
    {
      title: "First capture",
      prompt: "Black to play. The white stone has one liberty left. Capture it!",
      moves: 1, targets: ["E5"],
      rows: [E, E, E, "....X....", "...XOX...", E, E, E, E],
    },
    {
      title: "On the edge",
      prompt: "Black to play. Stones on the edge have fewer liberties. Capture the white stone.",
      moves: 1, targets: ["E1"],
      rows: [E, E, E, E, E, E, E, E, "...XOX..."],
    },
    {
      title: "In the corner",
      prompt: "Black to play. A corner stone has only two liberties. Capture it.",
      moves: 1, targets: ["A1"],
      rows: [E, E, E, E, E, E, E, E, "OX......."],
    },
    {
      title: "Two at once",
      prompt: "Black to play. Connected stones share their liberties. Capture both white stones.",
      moves: 1, targets: ["E5"],
      rows: [E, E, E, "....XX...", "...XOOX..", "....X....", E, E, E],
    },
    {
      title: "Three on the edge",
      prompt: "Black to play. Find the last liberty of the three white stones.",
      moves: 1, targets: ["C1"],
      rows: [E, E, E, E, E, E, E, "..XX.....", ".XOOOX..."],
    },

    // ---- Chasing ----
    {
      title: "Into the corner",
      prompt: "Black to play. Chase the white stone the right way and capture it in 3 moves.",
      moves: 3, targets: ["A3"],
      rows: [E, E, E, E, E, E, "OX.......", E, E],
    },
    {
      title: "Along the edge",
      prompt: "Black to play. Push the white stone toward the corner and capture it in 3 moves.",
      moves: 3, targets: ["C1"],
      rows: [E, E, E, E, E, E, E, "..X......", "..O......"],
    },

    // ---- Atari from the correct side ----
    {
      title: "Toward your wall",
      prompt: "Black to play. Put White in atari so it runs into your stones. Capture in 3 moves.",
      moves: 3, targets: ["E6"],
      rows: [E, "....XX...", E, "...XO....", "....X....", E, E, E, E],
    },
    {
      title: "Which side?",
      prompt: "Black to play. White has two liberties. Take the right one and capture in 3 moves.",
      moves: 3, targets: ["D7"],
      rows: ["..X......", E, "...OX....", "..XX.....", E, E, E, E, E],
    },
    {
      title: "Use your wall",
      prompt: "Black to play. Drive the white stone toward your strong stones. Capture in 3 moves.",
      moves: 3, targets: ["C4"],
      rows: [E, E, E, E, "XXX......", "..O......", "..X......", E, E],
    },
    {
      title: "Down to the edge",
      prompt: "Black to play. Chase the white stone toward the edge and capture it in 3 moves.",
      moves: 3, targets: ["E3"],
      rows: [E, E, E, E, E, "....X....", "....OX...", "..X......", "....X...."],
    },

    // ---- Double atari ----
    {
      title: "Double atari",
      prompt: "Black to play. One move can threaten both white stones. White can only save one.",
      moves: 2, targets: ["C4", "E4"],
      rows: [E, E, E, E, E, ".XO.OX...", "..X.X....", E, E],
    },
    {
      title: "Cut and attack",
      prompt: "Black to play. Find the point that puts two white stones in atari at once.",
      moves: 2, targets: ["D7", "E6"],
      rows: [E, E, "..XOX....", "....O....", "....X....", E, E, E, E],
    },
    {
      title: "Two threats",
      prompt: "Black to play. Attack both white stones with one move, then capture the one White doesn't save.",
      moves: 2, targets: ["D8", "E7"],
      rows: [E, "..XO.....", "...XOX...", E, E, E, E, E, E],
    },
    {
      title: "Double atari on the edge",
      prompt: "Black to play. Use the edge to put two white stones in atari at once.",
      moves: 2, targets: ["E3", "E1"],
      rows: [E, E, E, E, E, "..X......", "..X.O....", "...X.....", "....OX..."],
    },

    // ---- Ladders ----
    {
      title: "Ladder",
      prompt: "Black to play. Keep putting White in atari (a 'ladder') until the stones run into the edge. Capture in 4 moves.",
      moves: 4, targets: ["G6"],
      rows: [E, E, E, ".....XO..", "......XX.", E, E, E, E],
    },
    {
      title: "Ladder the other way",
      prompt: "Black to play. Another ladder. Which side should you attack from? Capture in 4 moves.",
      moves: 4, targets: ["C4"],
      rows: [E, E, E, E, ".XX......", "..OX.....", E, E, E],
    },

    // ---- Nets ----
    {
      title: "The net",
      prompt: "Black to play. Atari doesn't work here. Play a 'net' move that leaves White no way out. Capture in 3 moves.",
      moves: 3, targets: ["C6"],
      rows: [E, "..X......", E, "..OX.....", ".XX......", E, E, E, E],
    },
    {
      title: "Loose net",
      prompt: "Black to play. Don't chase the stone directly. Block its escape from a distance. Capture in 3 moves.",
      moves: 3, targets: ["E5"],
      rows: [E, E, E, ".....X...", "....OX...", "...XX....", E, E, E],
    },
    {
      title: "Net in the corner",
      prompt: "Black to play. Find the net that traps the white stone. Capture in 3 moves.",
      moves: 3, targets: ["G7"],
      rows: [E, "......X..", "....X.OX.", ".......X.", E, E, E, E, E],
    },
  ];

  // ---- Intermediate and Advanced: found in Dragon's self-play games ----
  // (tools/puzzle-maker.html). Each has exactly one correct first move (checked by the solver),
  // and Dragon rates that move among its top choices. Their titles and hints come from `kind`.
  window.GO_PUZZLES.push(...[
    // ---- Intermediate ----
    { kind: "double-atari", level: "intermediate", moves: 3, targets: ["G7"], rows: ["....X....", ".X.XOXXX.", ".OXOOXOO.", "...OXO.X.", ".OOOX.O..", ".OXXOO...", "OX.......", ".X.X.O...", "........."] }, // answer G6
    { kind: "double-atari", level: "intermediate", moves: 3, targets: ["D8"], rows: [".........", "..XOXX...", ".OXO.OX..", "..OXO.OX.", "..OX.O.O.", ".OX.XOO..", ".X..X....", ".........", "........."] }, // answer E7
    { kind: "double-atari", level: "intermediate", moves: 2, targets: ["C7"], rows: [".....X...", "..XXXO...", ".XO.XOOO.", ".XOXOX.X.", ".X.OOXOO.", "..O.OOX..", "...OXXO..", "..OX.X...", "....X...."] }, // answer C5
    { kind: "atari", level: "intermediate", moves: 3, targets: ["F3"], rows: [".........", "...O.....", "..X...OO.", "....OO..O", "XOOOOXOO.", ".X.XXXXOX", "..X..OOX.", "......X..", "........."] }, // answer F2
    { kind: "atari", level: "intermediate", moves: 3, targets: ["D4"], rows: ["...X.....", "..OXOXX..", "..OXXOX..", "..XOOO...", "..XX.O...", "..XOO.O..", ".OOXXXO..", ".OX......", "........."] }, // answer F4
    { kind: "atari", level: "intermediate", moves: 3, targets: ["E8"], rows: [".........", "...XO....", "...XOXO..", "...XXO...", "...XOO...", ".......O.", "..X.O.X..", "...O.....", "........."] }, // answer F8
    { kind: "atari", level: "intermediate", moves: 3, targets: ["G5"], rows: [".X.......", ".XOO.OOX.", "..X.OOX..", "XX.XOX.X.", "XO.OXXOO.", ".O.OOOXX.", "......O..", ".........", "........."] }, // answer G6
    { kind: "atari", level: "intermediate", moves: 2, targets: ["H7"], rows: ["....OO.O.", "...OXXXXO", "....O.XO.", "...OOXXOO", "...OXOOOX", "....XXO.X", "..O...XOX", ".....X.X.", "........."] }, // answer H4
    { kind: "atari", level: "intermediate", moves: 2, targets: ["D5"], rows: [".........", "....OXO..", "..OOXOO..", "..OXXXOX.", "...OXXX..", "...OOOX..", "..XOXX...", "..OX.X...", "....X...."] }, // answer C5
    { kind: "atari", level: "intermediate", moves: 2, targets: ["B2"], rows: ["..X......", ".X.X.....", ".OXOXXX..", "..OOXO...", "..O.O.O..", "....O.O..", "XXXXOXXO.", "XOOOXXOO.", ".O.X....."] }, // answer A1
    { kind: "atari", level: "intermediate", moves: 2, targets: ["G7"], rows: ["....O....", "...O.OXXX", "....OXOOO", ".XXXXX.O.", "X.XO.XXXO", ".XOO...O.", ".OXOO.XO.", ".....OO..", "........."] }, // answer G6
    { kind: "atari", level: "intermediate", moves: 2, targets: ["E4"], rows: [".........", ".........", "..O......", "....OO...", "...XXO.O.", "...XOX.X.", "OOXXOXXO.", "XX.XO....", ".OXO....."] }, // answer F2
    { kind: "atari", level: "intermediate", moves: 2, targets: ["B5"], rows: [".....XXO.", ".....XO.O", "..X..XO..", ".X.XXXO..", ".OOOXOXX.", ".XXXOOO..", ".OX.O....", "O.OO.....", ".O......."] }, // answer A5
    { kind: "atari", level: "intermediate", moves: 2, targets: ["E7"], rows: [".........", ".OX..XOX.", ".OX.OOX..", ".OXXXOX..", "..OOOXXX.", ".O..OXXO.", ".XX.XOOO.", "....XO...", "....O...."] }, // answer E8
    { kind: "atari", level: "intermediate", moves: 2, targets: ["H9"], rows: [".......O.", "......XOX", "......OX.", "..OOO.OX.", "..XOXX.O.", ".O.X.X...", ".OXX.XX..", "OXOOX....", "........."] }, // answer G9
    { kind: "atari", level: "intermediate", moves: 2, targets: ["E7"], rows: [".........", "....XX...", "..O.OXO..", "....OXO..", "..XXXOXO.", "...OXO...", "....XO...", ".........", "........."] }, // answer D7
    { kind: "atari", level: "intermediate", moves: 2, targets: ["G8"], rows: ["..OOX....", "..OXX.OX.", ".OXOXXOX.", "...OOOX..", "...OOXX..", "....X.XO.", "..O.X..X.", ".....X.X.", "......X.."] }, // answer G9
    { kind: "atari", level: "intermediate", moves: 2, targets: ["H2"], rows: [".........", ".X.XXOO..", ".OXXOX...", "OXX.OO...", ".O.O.XOO.", "...OXXOX.", "...OOXOX.", "....X.XOX", ".....X.O."] }, // answer G1
    { kind: "atari", level: "intermediate", moves: 2, targets: ["C3"], rows: [".........", ".OO......", ".XXOOOX..", ".OOXXXX..", ".OXX.OXX.", ".OXOO..O.", ".XOX.OO..", ".XO.XXO..", "........."] }, // answer C1
    { kind: "atari", level: "intermediate", moves: 2, targets: ["F3"], rows: [".........", "..XO.....", "..XXO.OO.", "....O.OX.", "..X...X..", ".X..XX...", ".OO.XOO..", "...OOXX..", "........."] }, // answer H3

    // ---- Advanced ----
    { kind: "double-atari", level: "advanced", moves: 4, targets: ["E3"], rows: [".........", "....O....", "XOOO.OOO.", ".XOXO.OX.", "X.XXXOX.X", ".X..X..X.", ".O.XOOX..", ".O..OXX..", "...OX...."] }, // answer F4
    { kind: "sacrifice", level: "advanced", moves: 4, targets: ["G9"], rows: ["......OX.", "...XOOOXO", "..OXX.OX.", "....XXOXX", "..XXXOXXO", ".XO.OOOO.", ".XO.....O", ".XO......", "........."] }, // answer J4
    { kind: "sacrifice", level: "advanced", moves: 3, targets: ["A9"], rows: ["OO.O.....", ".OOXO....", "OXXXOOX..", ".X.XXO.O.", "X..XOO...", "...XXO...", "...X.XO..", "...X.XO..", "....X.O.."] }, // answer E9
    { kind: "sacrifice", level: "advanced", moves: 3, targets: ["G4"], rows: [".........", "...OOXO..", ".OO..OX..", ".X..X..XX", "..X.XXXOO", ".X.XXXO.O", "..OOXOOO.", "...OOXXXO", "........."] }, // answer J1
    { kind: "sacrifice", level: "advanced", moves: 3, targets: ["D3"], rows: [".........", "OX..O....", ".OXX.....", ".O.XOO...", ".OOOX....", ".XOXX.X..", "XXXOXXO..", "OXOOOX...", ".O..X...."] }, // answer A1
    { kind: "sacrifice", level: "advanced", moves: 2, targets: ["F9"], rows: ["...O.O.OX", ".XOXOOOX.", "...XXXOOX", "..X.XOXX.", "..XO.OX..", ".XO.O.X..", ".....OO..", ".........", "........."] }, // answer G9
    { kind: "sacrifice", level: "advanced", moves: 2, targets: ["B3"], rows: ["......X..", "....XXOX.", ".....OOOX", "..XXX.OX.", "XO.O..OO.", "OXXOO....", ".OOX.O...", "O.OX.....", ".XX......"] }, // answer A3
    { kind: "chase", level: "advanced", moves: 5, targets: ["D6"], rows: ["...O.....", ".OOXXX...", ".XOXXOO..", "..XOOX.X.", "..XOXXXO.", ".O.OX.O.O", ".XO.X.OO.", ".........", "........."] }, // answer C4
    { kind: "chase", level: "advanced", moves: 5, targets: ["E5"], rows: [".........", "..XOOX...", "..XXXOO..", ".OXXXXO..", ".OOXOO...", "...OX....", "...OX....", "..OXX....", "........."] }, // answer G5
    { kind: "chase", level: "advanced", moves: 5, targets: ["D4"], rows: [".........", ".........", ".....OX..", "..O.O....", ".XOX..O..", ".OXOX....", "..XO..X..", ".........", "........."] }, // answer D2
    { kind: "chase", level: "advanced", moves: 4, targets: ["C4"], rows: [".........", "....XO...", "OOOOOXOO.", "XXXOOXOX.", "X.XOXXXO.", ".XOXXXXO.", "..OX...XO", ".........", "........."] }, // answer C2
    { kind: "chase", level: "advanced", moves: 4, targets: ["C7"], rows: [".........", "..X......", "..OOX.OX.", "..XXO.X..", "...O.X...", "....OXO..", "...OXX...", "..OXOO...", "........."] }, // answer B7
    { kind: "chase", level: "advanced", moves: 4, targets: ["C3"], rows: [".........", ".........", "..O.X.O..", ".......X.", "..OOOX...", ".XXXO....", "..OOXX...", "...XO....", "........."] }, // answer C2
    { kind: "chase", level: "advanced", moves: 4, targets: ["G4"], rows: ["...O.O...", "...XOX...", "...XOXX.O", "...OX....", "..OO.XX..", "..OXXXOO.", "...OOOXXO", "...O.OX.O", "....XX.X."] }, // answer H5
    { kind: "quiet", level: "advanced", moves: 5, targets: ["H7"], rows: [".......OX", "..OXOOXX.", "..OXXOXOX", "..X.XOXO.", "...OXXOO.", ".XO..XO..", ".OXOOOXX.", ".........", "........."] }, // answer G9
    { kind: "quiet", level: "advanced", moves: 5, targets: ["B5"], rows: [".........", ".........", "..X.OOO..", "O..XOX.X.", ".OOOXX...", ".XOXO.OX.", ".XXXO.X.X", "...OO.OX.", "........."] }, // answer B7
    { kind: "quiet", level: "advanced", moves: 5, targets: ["G7"], rows: ["...X.....", ".OX.X....", ".OOXXXO..", "..XOXOO..", "...OOXX..", "...OX.X..", "..XO.X...", "....O....", "........."] }, // answer G8
    { kind: "quiet", level: "advanced", moves: 5, targets: ["F7"], rows: ["....X....", "...X.XX..", ".X.OXOO..", "...OXXO..", ".OO.OOXX.", "XXOO..OX.", ".XOX.O.O.", "X.XOO....", ".OX......"] }, // answer E8
    { kind: "quiet", level: "advanced", moves: 5, targets: ["F7"], rows: [".........", "..XX.....", "..O.XOO..", "....XOX..", "..OOOXX..", "..X.O....", "...XO.O..", "...XXO...", "........."] }, // answer H7
    { kind: "quiet", level: "advanced", moves: 5, targets: ["B6"], rows: [".........", "...O.....", "..XO.....", ".OOXOOOO.", "O.OXOXO.O", ".OXXX.XO.", ".XX...XX.", ".........", "........."] }, // answer B7
  ]);

  for (const p of window.GO_PUZZLES) p.level = p.level || "beginner";

  const KIND_TEXT = {
    atari: ["The right atari", "Black to play. Start with the right atari and capture the marked stones in {n} moves."],
    chase: ["The chase", "Black to play. Keep the marked stones running the wrong way and capture them in {n} moves."],
    "double-atari": ["Two threats at once", "Black to play. One move can threaten two things at once. Capture the marked stones in {n} moves."],
    quiet: ["Quiet move", "Black to play. A quiet move works better than atari here. Capture the marked stones in {n} moves."],
    sacrifice: ["Sacrifice", "Black to play. Give up a stone first, then capture the marked stones in {n} moves."],
  };

  // A puzzle's title and hint in the page's language.
  window.GoPuzzleText = function (puzzle) {
    const t = window.GoI18n ? window.GoI18n.t : (s, v) => s.replace("{n}", v.n);
    if (puzzle.kind) {
      const [title, prompt] = KIND_TEXT[puzzle.kind];
      return { title: t(title), prompt: t(prompt, { n: puzzle.moves }) };
    }
    return { title: t(puzzle.title), prompt: t(puzzle.prompt) };
  };

  // Today's puzzle: the same for everyone on the same day (UTC), from Intermediate and Advanced.
  window.GoDailyPuzzle = function () {
    const pool = [];
    window.GO_PUZZLES.forEach((p, i) => { if (p.level !== "beginner") pool.push(i); });
    if (!pool.length) return 0;
    const day = Math.floor(Date.now() / 86400000);
    return pool[(day * 7919 + 13) % pool.length];
  };
})();
