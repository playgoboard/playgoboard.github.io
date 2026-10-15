# Changelog

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
