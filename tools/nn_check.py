"""Checks a converted network on a few positions and prints its answers, so they can be
compared with the official KataGo program (kata-raw-nn). Test helper, not used by the site.

Usage: python tools/nn_check.py MODEL.onnx
Positions are lists of moves like "D4" (Black first, alternating); "pass" passes.
The input features follow KataGo's input version 7 (nninputs.cpp, fillRowV7) for our rules
(area scoring, simple ko, no suicide, komi 7.5). Ladder features are left empty here.
"""
import sys

import numpy as np
import onnxruntime as ort

LETTERS = "ABCDEFGHJKLMNOPQRST"
KOMI = 7.5


def neighbors(i, size):
    x, y = i % size, i // size
    if x > 0: yield i - 1
    if x < size - 1: yield i + 1
    if y > 0: yield i - size
    if y < size - 1: yield i + size


def group(board, i, size):
    color, stones, libs, stack, seen = board[i], [], set(), [i], {i}
    while stack:
        s = stack.pop()
        stones.append(s)
        for n in neighbors(s, size):
            if board[n] == 0:
                libs.add(n)
            elif board[n] == color and n not in seen:
                seen.add(n)
                stack.append(n)
    return stones, libs


def play(board, i, color, size):
    """Returns the new board and the ko point (or -1)."""
    board = board.copy()
    board[i] = color
    captured = []
    for n in neighbors(i, size):
        if board[n] == 3 - color:
            stones, libs = group(board, n, size)
            if not libs:
                for s in stones:
                    board[s] = 0
                captured += stones
    ko = -1
    stones, libs = group(board, i, size)
    if len(captured) == 1 and len(stones) == 1 and len(libs) == 1:
        ko = captured[0]
    return board, ko


def area(board, size):
    """Stones plus empty regions touching only one color (a close stand-in for KataGo's area)."""
    owner = board.copy()
    seen = set()
    for i in range(size * size):
        if board[i] != 0 or i in seen:
            continue
        region, touches, stack = [], set(), [i]
        seen.add(i)
        while stack:
            s = stack.pop()
            region.append(s)
            for n in neighbors(s, size):
                if board[n] == 0 and n not in seen:
                    seen.add(n)
                    stack.append(n)
                elif board[n] != 0:
                    touches.add(board[n])
        if len(touches) == 1:
            for s in region:
                owner[s] = touches.pop() if False else list(touches)[0]
    return owner


def features(size, moves):
    board = np.zeros(size * size, np.int8)
    ko = -1
    history = []  # (color, index or -1 for pass)
    color = 1
    for m in moves:
        if m == "pass":
            history.append((color, -1))
            ko = -1
        else:
            i = (size - int(m[1:])) * size + LETTERS.index(m[0])
            board, ko = play(board, i, color, size)
            history.append((color, i))
        color = 3 - color
    pla, opp = color, 3 - color
    spatial = np.zeros((22, size, size), np.float32)
    glob = np.zeros(19, np.float32)
    flat = spatial.reshape(22, -1)
    flat[0, :] = 1
    for i in range(size * size):
        if board[i] == 0:
            continue
        flat[1 if board[i] == pla else 2, i] = 1
        libs = len(group(board, i, size)[1])
        if libs in (1, 2, 3):
            flat[2 + libs, i] = 1
    if ko >= 0:
        flat[6, ko] = 1
    owner = area(board, size)
    for i in range(size * size):
        if owner[i] == pla: flat[18, i] = 1
        elif owner[i] == opp: flat[19, i] = 1
    # Last 5 moves, newest first, while the colors alternate as expected.
    expect = opp
    for k, (c, i) in enumerate(reversed(history[-5:])):
        if c != expect:
            break
        if i < 0: glob[k] = 1
        else: flat[9 + k, i] = 1
        expect = 3 - expect
    self_komi = KOMI if pla == 2 else -KOMI
    glob[5] = self_komi / 20
    if history and history[-1][1] < 0:
        glob[14] = 1  # a pass now would end the game
    # Komi parity wave (board areas 81/169/361 are odd, so drawable komis are odd).
    floor = np.floor((self_komi - 1) / 2) * 2 + 1
    delta = min(max(self_komi - floor, 0), 2)
    glob[18] = delta if delta < 0.5 else (1 - delta if delta < 1.5 else delta - 2)
    return spatial[None], glob[None], pla


def main():
    session = ort.InferenceSession(sys.argv[1])
    tests = [(19, []), (19, ["Q16", "D4"]), (9, []), (9, ["E5", "C3", "G7"]), (13, ["D4", "K10", "C3"])]
    for size, moves in tests:
        spatial, glob, pla = features(size, moves)
        policy, value, misc, own = session.run(None, {"bin_input": spatial, "global_input": glob})
        p = np.exp(policy[0] - policy[0].max())
        p /= p.sum()
        top = np.argsort(-p)[:5]
        names = ["pass" if t == size * size else f"{LETTERS[t % size]}{size - t // size}" for t in top]
        v = np.exp(value[0] - value[0].max())
        v /= v.sum()
        who = "Black" if pla == 1 else "White"
        print(f"{size}x{size} after {moves or 'nothing'}: {who} to play, win {v[0]:.3f}, "
              f"lead {misc[0][2] * 20:+.1f}, top moves " + ", ".join(f"{n} {p[t]:.3f}" for n, t in zip(names, top)))


if __name__ == "__main__":
    main()
