# Changelog

## 0.40.0
- Install as an app: GoBoard can be added to a phone or computer like an app (own icon, full screen). The main menu shows an install button (Chrome, Edge, Android) or a tip for iPhones. An offline helper (sw.js) keeps copies of the site so it loads fast and bots and puzzles work offline after first use; pages always load fresh when online.

## 0.39.0
- Watch live games: friends of a player can watch their live online games (Friends window "🔴 Watch", or "Watch live" on the profile), updated every 2 seconds. The admin can watch any game from a profile with the admin code. Players see how many friends are watching. Only games with a logged-in player can be watched.

## 0.38.2
- Admin code: every admin action (seeing the list, Looks fine, Ban) asks for a secret code that can only be set in Supabase. 5 wrong codes lock admin actions for 15 minutes.

## 0.38.1
- Fixed: Tiger (and the old search) could think forever when a phone quietly stopped its background helpers. It now uses what it has, or thinks on the page, a few seconds after its thinking time; if thinking fails twice, the bot passes instead of freezing.
- Bot games with Undo, Hint or a custom position now say they won't count for bot achievements (for logged-in players).

## 0.38.0
- Main menu: the site now opens on a menu of big square buttons (two side by side) for Daily games, Today's puzzle, Bots, Play online, Puzzles, Play a friend, Leaderboard and Achievements, each with live info (games waiting for you, puzzle solved, rating, achievements and streak). The ☰ button in the top bar of every page brings it back.

## 0.37.0
- Speed limit against floods: the database refuses more than 120 actions a minute from one account, or 300 from one internet address for guests.

## 0.36.0
- Achievements (30, for logged-in players): bots, puzzles, online, fun and streak groups, on a new Achievements page and as badges on profiles, with a pop-up and chime. Rating, wins, daily games, friends and streaks are checked by the database; bot achievements send the game as proof.
- Daily streak 🔥: solve a puzzle, finish a bot or online game, or make a daily move each day. Shown next to your name and on profiles.
- Admin page (admin.html, only for the admin account) to replay proof games with Dragon's Review and ban cheaters for 7 days, removing all their achievements.

## 0.35.0
- Two-step verification (optional): turn it on in your account window, scan the QR code with an authenticator app, and logging in then also asks for the 6-digit code. The database itself refuses requests from an account that still needs its code.

## 0.34.0
- Player profiles: a picture (16 to pick from) and an About me, a rating graph, more stats (win %, longest win streak, rated / casual / daily, results per board size), and Add friend / Daily challenge buttons. Daily challenges can now go to any player, not only friends.
- Player names in the friends list, daily games and online game cards open that player's profile.
- Fixed: a profile's game list broke when a game was won on points.

## 0.33.0
- More choices in the Look window (🎨): 5 new boards (Bamboo, Marble, Blue ocean, Night, Paper), 3 new stone styles (Glass, Jade & pearl, Yunzi), stone sound (Wood, Soft, Slate, Off), accent color (Green, Blue, Purple, Red, Orange), page background (Plain, Soft gradient, Wood, Go pattern), text size (Small, Normal, Large) and board size on screen (Compact, Normal, Big).

## 0.32.0
- 40 new puzzles (20 Intermediate, 20 Advanced) found in Dragon's own games, each with exactly one correct first move. Puzzles are now grouped Beginner / Intermediate / Advanced.
- Today's puzzle: one Intermediate or Advanced puzzle per day, the same for everyone. Shown on the main page and starred on the Puzzles page.

## 0.31.0
- Dragon's Review: after any finished game (and on every Leaderboard replay, daily games included), the neural-network Dragon checks every position and labels each move ✓ Good, ~ Slip, ? Mistake or ?? Big mistake by how much it lowered that player's win chance. Win-chance graph (click to jump), a summary per player, and Dragon's preferred move as a green circle.

## 0.30.0
- Dragon (and the Hint button) now think with a real neural network: KataGo's public-domain g170 b10c128 network, converted for the browser (tools/katago_to_onnx.py) and run with ONNX Runtime Web in background helpers, with an AlphaZero-style search. Checked to match the official KataGo program exactly. Beat the previous Dragon 2-0 by huge margins on 9x9. Downloads about 15 MB the first time Dragon thinks; falls back to the old Dragon if a browser can't run it.

## 0.29.0
- Look window (🎨 in the top bar): Dark, Light or Match my device; board Classic wood, Light maple, Dark walnut or Green; stones Classic, Flat or Slate & shell. Changes show instantly with a small preview and are remembered in your browser on every page.

## 0.28.0
- Phones: the top bar fits on one row (logo icon, short language names EN/简/繁, smaller buttons) and the menu is one row you can swipe, so pages no longer slide sideways. Small fixes to text spacing under buttons.
- Phones: starting a game jumps up to the board.
- Picking a board size changes the board right away (unless a game is in progress; then it is used for the next game).

## 0.27.0
- Invite someone you know to a daily game: "Who can join" when creating a challenge: Anyone, Invite link (a private link to send) or A friend (from your friends list; they Accept or Decline). The Friends window has a "Daily game" button next to each friend. Friend challenges count in the Daily menu counter.

## 0.26.0
- Daily games (new Daily page and menu item): post an open challenge (board size, 1/3/7 days per move, Rated or Casual, your color) or join one. Moves are saved and checked by the database with the full rules, so you can play several games at your own pace. Not moving in time loses the game. When both pass, the board is counted as it is; the site warns before a pass if enemy stones still look dead. The menu shows how many games wait for your move. Finished daily games appear in the game history with replays.

## 0.25.0
- Bot pictures: Pebble, Sprout, Fox, Tiger and Dragon each have a round picture (img/bots/) in the bot list and next to their name on the board while you play.

## 0.24.0
- New link-preview picture (what WhatsApp, Discord etc. show when the link is shared): the big round GoBoard logo with the name. Previews now point to playgoboard.github.io.

## 0.23.0
- "Remember me" checkbox when logging in (on by default): ticked keeps you logged in after closing the browser, unticked logs you out when the browser closes (for shared computers).
- A Log out button in the top bar next to your name while you are logged in.

## 0.22.0
- New logo: a round wooden board with a black and a white stone (img/logo.svg) in the top bar of every page, and a matching browser-tab icon (favicon.svg). Clicking the logo goes to the main page.

## 0.21.0
- Stronger Tiger, Dragon and Hint on every board size: smarter practice games (escape atari, avoid self-atari), RAVE so the search learns faster, and the thinking runs on all spare processor cores in background workers. Dragon (and Hint) now think about 10 seconds per move. In tests on one core each, new Dragon beat old Dragon 17-7 on 9x9, 14-0 on 13x13 and 7-0 on 19x19.

## 0.20.0
- Better chances in mainland China: the PeerJS and Supabase libraries are now stored in the site (js/vendor) instead of loading from unpkg and jsDelivr, and online games also use connection servers from Chinese companies (Xiaomi, Tencent) next to Google's.

## 0.19.0
- Language menu in the top bar: English, 简体中文 (Simplified Chinese) and 繁體中文 (Traditional Chinese). The whole site is translated, including bots, puzzles, accounts, friends, quick match, the leaderboard and the privacy page. The choice is remembered; Chinese browsers start in Chinese.

## 0.18.0
- Chat: only English and Chinese (plus numbers, punctuation and board symbols like ★ ● ← →). Messages in other languages or with emojis are not sent, with a note in both languages.
- The bad-word filter now also hides common Chinese swear words (simplified and traditional) and pinyin abbreviations, and catches full-width letters.

## 0.17.0
- Set up position: place black and white stones (Black / White / Eraser), pick who moves first, then play from there on the same computer or against a bot. Stones without liberties are not allowed.

## 0.16.0
- Leaderboard page (top menu): the top 100 players with at least one rated game. Click a name to see their profile and game history.
- Game history: finished online games (rated, casual and quick match) are saved for each logged-in player, with moves. Rated games show the rating change. Older rated games appear without a replay.
- Replay any saved game move by move (buttons, the move list, or the arrow keys).
- "My games" button in your profile. Privacy page updated.

## 0.15.0
- Quick match: in Online, press Quick match to play a stranger with the same board size, clock and game type (Casual or Rated). Pairs players with close ratings first and widens the range the longer you wait. No account needed for casual games: guests pick a level from Beginner to Expert. Colors are random. If the opponent leaves before the game starts, searching continues.
- Online texts say "opponent" instead of "friend" in quick matches.

## 0.14.0
- Friends: open your profile and click Friends. Add players by username; they accept or decline. See your friends' ratings and win/loss record, remove friends, cancel sent requests. A bell on the account button shows new requests. The database only lets players see and change their own friendships.

## 0.13.0
- Rated online games: choose Casual or Rated when creating an online game. Rated needs both players logged in. Player cards show usernames and ratings. Ratings (Elo, K = 32) change only when both browsers report the same winner; a lone report counts after 10 minutes. The database checks everything, so ratings can't be faked from the page.

## 0.12.0
- Accounts (Supabase): sign up with username, email and password, log in, forgotten password, profile with rating and record, log out, delete account. Everyone starts at 1200. Profiles are read-only for the website; ratings can't be edited directly.
- Privacy page explaining what is stored.
- On small screens the top menu gets its own line.

## 0.11.0
- Puzzles page with 20 beginner puzzles (captures, chasing, correct-side atari, double atari, ladders, nets). A small solver checks your moves, so any truly correct answer counts, and plays White's defence. Progress is remembered in your browser.
- The board drawing code now lives in its own file (board-view.js), shared by the game and puzzle pages.

## 0.10.0
- Move list and replay: every move is listed (Black/White pairs, passes shown). Step through the game with « ‹ › », the ← → keys, or by clicking a move. The board is read-only while looking back.

## 0.9.0
- Game clock: Off (default), 1, 3, 5, 10 or 30 minutes each, with optional bonus seconds per move (+0, +2, +5, +10, +30). Run out and you lose on time. Online, the creator's choice counts for both, times stay in sync, and clocks pause while the connection is down. Bots have no clock.

## 0.8.1
- Link preview: sharing the site in WhatsApp, Discord etc. shows a picture (preview.png), title and description.

## 0.8.0
- Rematch button after an online game: once both players click it, a new game starts on the same board with randomly picked colors. Chat carries over.

## 0.7.0
- Chat in online games, with a bad-word filter on both sides (catches tricks like sh1t, fuuuck and f u c k). Messages are plain text only.

## 0.6.0
- Stone sounds: a wooden clack when any stone is placed and a pebble rattle for captures. Mute button (🔊/🔇) at the top, remembered between visits.
- Script and style links carry a version tag so browsers don't mix old and new files after an update.

## 0.5.1
- Phones: the game buttons (Hint, Pass, Undo, Resign) now sit right under the board instead of below the New game box.

## 0.5.0
- Online play is sturdier: the joiner keeps asking until the game starts, hiccups with the online service no longer end a game, and a dropped connection reconnects by itself (both boards are rebuilt from the creator's move list). Status shows "Connecting…", "Connection lost / Reconnecting…" and "Reconnected!". Strangers with the code are turned away.

## 0.4.0
- Online play with a friend: create a game to get a 6-letter code and invite link, or join with a code. Uses the free PeerJS service to connect the two browsers. Undo and Hint are off in online games; passing, resigning, dead stones and scoring stay in sync.

## 0.3.0
- Hint button: Dragon (Level 5) thinks for a few seconds and marks a good move in green. Works against friends and bots.
- Pass button now says "Skip your turn" on hover, and How to play explains when to pass.

## 0.2.0
- Play against the computer: 5 levels (1-3 use rules of thumb, 4-5 also play out thousands of practice games). Choose your color; you sit at the bottom of the board.

## 0.1.0
- First version: Go board (9×9, 13×13, 19×19) for two players on one computer, with captures, ko, pass, undo, resign and score counting.
