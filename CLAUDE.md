# CLAUDE.md — Go Website (GoBoard)

## About me
- I'm a gamer, not a software engineer. This is my first website.
- Talk to me in plain language. Short explanations. No jargon unless I ask.
  If you must use a technical word, explain it in one simple sentence.
- Be honest. If something is hard, risky, or won't work well, say so.
- Don't push extra features I didn't ask for. One suggestion at the end of a task, once.

## Project facts
- Goal: a chess.com-style site for Go. Built in small steps.
- Plain HTML/CSS/JavaScript, no build tools and no libraries. Open `index.html` to play.
- Scripts are plain `<script>` files (not modules) so the page works when opened straight from disk.
- `js/go-rules.js`: the game rules only (no drawing). Reuse it for bots and online play.
- `js/go-bot.js`: the computer player. Levels 1-3 = rules-of-thumb scoring plus random noise;
  levels 4-5 = Monte Carlo tree search (1.2 s / 4 s per move) run in small time slices so the page stays responsive.
  Has its own fast board copy (FastBoard) for speed. Bot names and descriptions are in BOT_LEVELS.
- `js/game-page.js`: draws the board (SVG), handles the buttons, the bot's turn and online moves.
  Exposes `window.GoPage` for the lobby.
- `js/online-lobby.js`: online play via PeerJS (loaded from unpkg, peerjs@1.5.4, the user approved it).
  Room code = 6 chars, peer id `goboard-v2-<code>` (bump the version when the message rules change).
  HostSession keeps the code registered all game; GuestSession sends {hello, token} until it gets
  {sync, size, yourColor, actions}. Ping every 3 s, 12 s of silence = dropped. Guest redials for up to
  2 min; host re-sends the full action list (game-page `onlineActions`) and the guest rebuilds.
  A hello with a different token gets {busy}. Game actions: move, pass, resign{loser}, toggle-dead,
  finish, resume, all applied through applyOnlineAction. Undo/Hint disabled online.
- Testing: Node and Python aren't installed. Use Java's `jwebserver.exe` (JDK 21 bin) on 127.0.0.1
  and the browser pane, but always ask me yes/no before starting it.
- `js/sounds.js`: stone/capture sounds made with Web Audio (no files); mute saved in localStorage.
  game-page.js plays them when a new stone appears (not on undo/new game).
- index.html loads css/js with `?v=N`. Bump N in every upload that changes css/js, so browsers
  never mix old and new files.
- `js/chat-filter.js` (word lists + cleanMessage) and `js/online-chat.js` (chat box UI): chat only in
  online games, message {type:"chat", text}, filtered on send AND receive, shown via textContent only.
- Rematch: both send {type:"rematch-offer"}; when the host has both, HostSession.startRematch picks
  RANDOM colors (the user asked: not just swapped) and sends {type:"rematch", size, yourColor}.
  GoPage.startOnlineGame(size, color, actions, session, kind) with kind "new" | "reconnect" | "rematch".
- Link preview: Open Graph tags in index.html + preview.png (1200x630), drawn by
  `java -Djava.awt.headless=true tools/MakePreviewImage.java` (run from the project folder).
- Planned next (user picked, in this order): game clock (with an Off option), move list + replay,
  puzzles. Later: accounts + ratings, stronger 19×19 bots.
- `css/style.css`: the look (dark chess.com-like theme, colors at the top).
- Rules: area scoring, komi 7.5, simple ko, suicide not allowed.

## How we work
1. One feature at a time. Before bigger changes, explain the plan in 2–4 sentences and wait for OK.
2. After each step, check it works, tell me what changed and how to test it.
3. Never say something is done without checking it.
4. Use git. Commit after each working step with a plain-English message.
5. Don't add outside libraries or paid services without asking me first.

## Roadmap
1. Local 2-player board — done
2. Play vs computer — done (5 levels; weak on 19×19)
3. Online play with friends — done (PeerJS room codes). Live at https://reinj-bot.github.io/goboard/
   (GitHub Pages from `main`). Commits use the GitHub private email. Never push the local
   `backup-before-email-change` branch. Ask me yes/no before every push.
   Also on Netlify at https://playgoboard.netlify.app/ (visitor protection turned off), which deploys from a copy repo `reinj-bot/goboard-8506c` (made by Netlify's
   deploy link). `git push` goes to BOTH repos (two push URLs on origin), so both sites update.
4. Accounts, ratings, game history, puzzles

## Features so far
- Board sizes 9/13/19, captures, ko, suicide check, pass, undo, resign, dead-stone marking and score count.
- Bots: 5 levels (Pebble, Sprout, Fox, Tiger, Dragon), color choice Black/White/Random, human sits at the
  bottom, undo takes back two moves. Bot passes when you pass and it's ahead on the count (or clearly lost).
- Hint button: asks the Level 5 bot (HINT_LEVEL in game-page.js), draws a green circle; the hint is tied to the
  exact position (positionKey) and vanishes or cancels when anything changes. GoGame.checkMove tests a move without playing it.
- Site name is "GoBoard" for now (placeholder; the user may rename it).
