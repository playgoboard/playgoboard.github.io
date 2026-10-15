// Runs one search for Tiger, Dragon or the Hint button on a spare processor core,
// so several searches run at once and the page stays smooth (see go-bot.js).
// It loads the same script versions as the page (the ?v= of this file's address).
self.window = self;
const version = self.location.search;
importScripts(`go-rules.js${version}`, `go-bot.js${version}`);

self.onmessage = (event) => {
  const { cells, size, ko, color, last, thinkMs } = event.data;
  self.postMessage(self.GoBot.searchInWorker(cells, size, ko, color, last, thinkMs));
};
