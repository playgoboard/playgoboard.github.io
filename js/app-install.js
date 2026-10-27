// Installing GoBoard as an app (manifest.json + sw.js). Every page turns on the offline
// helper; the main menu shows an "Install GoBoard" button where the browser allows one
// (Chrome, Edge, Android), and a short tip on iPhones and iPads, which have no button.
(function () {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* works without it */ }));
  }

  const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let prompt = null;
  const listeners = [];
  const changed = () => listeners.forEach((fn) => fn());

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // we show our own button instead of the browser's banner
    prompt = event;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    changed();
  });

  window.GoInstall = {
    // "button": we can show an install button; "ios": show the Share tip; null: nothing to show.
    kind: () => (installed() ? null : prompt ? "button" : isIos ? "ios" : null),
    async install() {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
      prompt = null;
      changed();
    },
    onChange(fn) { listeners.push(fn); },
  };
})();
