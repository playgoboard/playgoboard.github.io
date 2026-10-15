// A chess-style game clock: each player has their own time, and only the
// player whose turn it is counts down. Finishing a turn can add bonus seconds.
(function () {
  class GameClock {
    constructor(minutes, bonusSeconds) {
      this.on = minutes > 0;
      this.bonusMs = bonusSeconds * 1000;
      this.left = { 1: minutes * 60000, 2: minutes * 60000 }; // keyed by Go.BLACK / Go.WHITE
      this.running = null;
      this.since = 0;
    }

    // Moves the running player's used time into their total.
    settle() {
      if (!this.running) return;
      const now = performance.now();
      this.left[this.running] -= now - this.since;
      this.since = now;
    }

    // Starts this player's countdown (null = nobody's clock runs).
    run(color) {
      if (color === this.running) return;
      this.settle();
      this.running = color;
      this.since = performance.now();
    }

    // The player finished their turn: stop their time and add the bonus. Returns their time left.
    press(color) {
      if (!this.on) return null;
      if (this.running === color) {
        this.settle();
        this.running = null;
      }
      this.left[color] += this.bonusMs;
      return Math.round(this.left[color]);
    }

    // Online: trust the time the other player's browser reported.
    set(color, ms) {
      if (typeof ms !== "number" || !isFinite(ms)) return;
      this.settle();
      this.left[color] = ms;
    }

    timeLeft(color) {
      let ms = this.left[color];
      if (this.running === color) ms -= performance.now() - this.since;
      return ms;
    }

    snapshot() {
      this.settle();
      return { 1: Math.round(this.left[1]), 2: Math.round(this.left[2]) };
    }
  }

  // 4:05 normally, 7.3 in the last ten seconds.
  function formatTime(ms) {
    const t = Math.max(0, ms);
    if (t < 10000) return (t / 1000).toFixed(1);
    const seconds = Math.ceil(t / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  window.GoClock = { GameClock, formatTime };
})();
