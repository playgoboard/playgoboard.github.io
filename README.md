# GoBoard

A website for playing the board game Go, in the style of chess.com.

## What it does right now
- Play Go on a 9×9, 13×13 or 19×19 board, two players taking turns on the same computer.
- Captures, the ko rule and the "no suicide" rule are all checked for you.
- Hint, Pass (skip your turn), Undo and Resign buttons. Hint shows a good move in green.
- When both players pass, click the dead groups and the site counts the score
  (area scoring, with 7.5 komi for White).
- Play against the computer: 5 bot levels (Pebble, Sprout, Fox, Tiger, Dragon).
  Pick Black, White or Random. Undo takes back your move and the bot's reply.
  The bots are best on 9×9; on 19×19 even Dragon is still a beginner.

- Play online with a friend: click **Online**, then **Create online game**, and send your friend the
  code or the invite link. They type the code under "Join" (or just click the link).
  Online play needs internet and uses the free PeerJS service to connect you. It may not work on
  some school or work networks. Undo and Hint are turned off in online games.

## How to play it
Play online at **https://playgoboard.netlify.app/** (or https://reinj-bot.github.io/goboard/),
or double-click `index.html`. It opens in your web browser. Local games and bots work without
internet; online games need it.
