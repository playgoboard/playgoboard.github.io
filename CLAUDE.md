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
  levels 4-5 + Hint = MCTS with RAVE, playouts with capture/escape-atari/no-self-atari, run in
  `js/bot-worker.js` workers (one per spare core, max 8; root parallel, stats summed; falls back to
  time slices on the page). Dragon/Hint think 10 s, Tiger 1.2 s. Old notes:
  levels 4-5 = Monte Carlo tree search (1.2 s / 4 s per move) run in small time slices so the page stays responsive.
  Has its own fast board copy (FastBoard) for speed. Bot names and descriptions are in BOT_LEVELS.
- `js/game-page.js`: draws the board (SVG), handles the buttons, the bot's turn and online moves.
  Exposes `window.GoPage` for the lobby.
- `js/online-lobby.js`: online play via PeerJS (peerjs@1.5.4, stored in js/vendor; PEER_OPTIONS adds
  China-reachable STUN servers next to Google's).
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
- `js/game-clock.js`: GameClock (run/press/set/snapshot). game-page: clockRunner() decides whose clock
  runs (none for bots, none while an online link is down); pressClock() adds the bonus after a move/pass.
  Online: move/pass actions carry `left` (mover's time), {type:"timeout", loser} ends the game
  (you call your own time at 0, your friend's after a 2 s grace). Host sends clock settings in
  sync/rematch, plus `times` in sync for reconnects. GoGame.loseOnTime gives result.byTimeout.
- Move list/replay: GoGame.moves + GoGame.boardAfter(count) (uses history snapshots). `js/move-list.js`
  renders the list; game-page `viewCount` (null = live) drives drawBoard; board clicks are blocked
  while viewing; ← → keys step (ignored while typing).
- `js/board-view.js`: renderBoard(view) draws the SVG board for both pages.
- Puzzles: `puzzles.html` + `js/puzzles-page.js`; data in `js/puzzles-data.js` (9x9 diagrams, targets,
  moves). `js/puzzle-solver.js` reads capture fights (liberties, net moves, counter-captures) using
  GoBot.FastBoard: moveWins() judges the player's move, whiteReply() picks the toughest defence.
  When adding puzzles, check with the solver that exactly one first move wins. Solved list is in
  localStorage "goboard-puzzles-solved". index.html?mode=bot|online|friend opens that mode.
- Accounts: Supabase project `iosvimeihfhpxsztqkkv` (free tier; pauses after ~1 week idle, the user
  restores it in the dashboard). URL + publishable key in `js/supabase-config.js` (public by design;
  NEVER the secret/service_role key). supabase-js 2.115.0 stored in js/vendor (no CDN, for China). `js/accounts.js` adds the
  top-bar button + dialog and exposes window.GoAccounts. Database SQL lives in `supabase/NN-*.sql`;
  the USER runs it in the Supabase SQL Editor (I can't). profiles table is read-only to clients;
  ratings must only change through security-definer functions. Claude must not create real
  accounts itself (sends email/password to an outside host); the user does sign-up tests.
- Rated games: `supabase/02-rated-games.sql` (start_rated_game → join_rated_game → report_result,
  apply_rating is internal, finalize_my_stale_games after 10 min). `js/rated-games.js` = GoRated.
  Guest hello carries its user id; HostSession.prepareMeta looks up names/ratings and creates the
  rated game; meta {ratedGameId, players, casualReason} rides along in sync/rematch.
- Friends: `supabase/03-friends.sql` (friendships table, select-only RLS for your own rows; send_friend_request,
  answer_friend_request, remove_friend). `js/friends.js` fills the "friends" view of the account dialog
  (GoAccounts.onView) and sets the bell badge (GoAccounts.setBadge), re-checking every 60 s.
- Quick match: `supabase/04-quick-match.sql` (quick_match_queue, no client access; quick_match() polled every
  ~2.5 s returns waiting | found{room} | matched; quick_match_leave()). Rows expire after 15 s without a check-in.
  `js/quick-match.js`: each searcher HOSTS a room while waiting; whoever gets "found" joins the other's room
  (GoLobby.startHost/startGuest from online-lobby.js). Guests pick a level (GoLevels, 400-2000) stored in
  localStorage "goboard-level"; meta.quick=true makes texts say "opponent" (GoPage.friendWord).
- Game history: `supabase/05-game-history.sql` (game_records, public read, one row per player per game,
  unique (player, game_key); save_game_record validates moves [[x,y]|"pass"] and result "B+R|W+T|B+3.5").
  HostSession.prepareMeta adds meta.gameKey and player ids. game-page saveGameRecord() -> `js/game-history.js`
  (GoHistory.save/rebuild/resultWords). `leaderboard.html` + `js/leaderboard-page.js`: ?player=NAME, ?game=ID.
  Usernames are shown with textContent only.
- Accounts plan: step 1 accounts (done) → 2 rated online games (done; both players must report the same  result before ratings change) → 3 quick match (done) → 4 leaderboard + game history (done).
- Position editor: `js/position-editor.js` (GoEditor.isOpen) owns the board while open (capture-phase click
  listener; game-page drawBoard skips). GoGame.setPosition(board, turn) + breathlessStones(). GoPage.startFromPosition.
  Same computer and bots only (the user chose: no online).
- Daily games: `supabase/06-daily-games.sql` (daily_games, public read; rules in plpgsql: daily_group,
  daily_play [captures, suicide, simple ko vs prev_board], daily_score [Tromp-Taylor area, komi 7.5];
  daily_move(game, count, x, y; x=-1 pass), daily_finish [Elo K=32 + game_records rows with daily/rating_change],
  daily_check_timeouts [anyone may call]). `daily.html` + `js/daily-page.js` (list + ?game=ID, pick then Submit,
  dead-stone warning via 60 playouts) + `js/daily-badge.js` (menu counter on every page). Only open challenges
  (the user chose that). GoAccounts.onChange now calls late listeners right away.
- Languages: `js/i18n.js` (GoI18n.t, sentences, beforeChange) + `js/i18n-zh.js` (GO_TEXT_ZH: "English": [simplified, traditional]).
  The ENGLISH TEXT IS THE KEY: wrap new player-visible text in t("...") (placeholders {name}) and add a line to
  i18n-zh.js. Static HTML text nodes, placeholders, titles and aria-labels are translated on DOMContentLoaded;
  paragraphs with <b> use data-t-html="key". Switching = ?lang=xx reload (stored in localStorage "goboard-language").
  Database error messages are translated through t() too, so keep their English in the dictionary.
  Chat only allows English and Chinese (GoChatFilter.isAllowedText) and filters Chinese bad words.
- Planned next (user picked, in this order):
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
3. Online play with friends — done (PeerJS room codes). Live at https://playgoboard.github.io/ (repo playgoboard/playgoboard.github.io in the
   free "playgoboard" GitHub organization, owned by reinj-bot; moved there 2026-10-16)
   (GitHub Pages from `main`). Commits use the GitHub private email. Never push the local
   `backup-before-email-change` branch. Ask me yes/no before every push.
   Also on Netlify at https://playgoboard.netlify.app/ (visitor protection turned off), which deploys from a copy repo `reinj-bot/goboard-8506c` (made by Netlify's
   deploy link). `git push` goes to BOTH repos (two push URLs on origin), so both sites update.
   Netlify free plan has a monthly deploy credit limit (it stopped updating on 2026-10-15). The user wants
   fewer uploads: batch several features per push. GitHub Pages has no limit.
4. Accounts, ratings, game history, puzzles

## Features so far
- Board sizes 9/13/19, captures, ko, suicide check, pass, undo, resign, dead-stone marking and score count.
- Bots: 5 levels (Pebble, Sprout, Fox, Tiger, Dragon), color choice Black/White/Random, human sits at the
  bottom, undo takes back two moves. Bot passes when you pass and it's ahead on the count (or clearly lost).
- Hint button: asks the Level 5 bot (HINT_LEVEL in game-page.js), draws a green circle; the hint is tied to the
  exact position (positionKey) and vanishes or cancels when anything changes. GoGame.checkMove tests a move without playing it.
- Site name is "GoBoard" for now (placeholder; the user may rename it).
