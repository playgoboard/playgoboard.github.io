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
})();
