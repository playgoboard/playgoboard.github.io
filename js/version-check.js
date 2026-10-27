// Makes sure nobody keeps playing on an old version of GoBoard. Every page knows its own version
// (the ?v= number of its scripts); version.json on the server says the newest one. When a newer
// one is out, a message covers the page until you refresh. An online game in progress is left to
// finish first (the game page says so through GoVersion.holdWhile).
(function () {
  const CHECK_EVERY_MS = 3 * 60 * 1000;
  const script = document.currentScript;
  const mine = Number(new URL(script ? script.src : location.href).searchParams.get("v")) || 0;
  let hold = () => false;
  let newer = false;
  let cover = null;

  function showCover() {
    if (cover || hold()) return;
    const t = window.GoI18n ? window.GoI18n.t : (s) => s;
    cover = document.createElement("div");
    cover.className = "update-cover";
    const box = document.createElement("div");
    box.className = "panel-block update-box";
    const heading = document.createElement("h2");
    heading.textContent = t("GoBoard was updated");
    const text = document.createElement("p");
    text.textContent = t("Please refresh the page to keep playing with the newest version.");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = t("Refresh");
    button.addEventListener("click", () => location.reload());
    box.append(heading, text, button);
    cover.append(box);
    document.body.append(cover);
  }

  async function check() {
    if (!mine || newer) return newer && showCover();
    try {
      const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
      const { version } = await response.json();
      if (Number(version) > mine) {
        newer = true;
        showCover();
      }
    } catch { /* offline or not found: keep playing */ }
  }

  window.addEventListener("load", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  setInterval(check, CHECK_EVERY_MS);

  window.GoVersion = {
    version: mine,
    // fn() returns true while the page must not be covered yet (an online game in progress).
    holdWhile(fn) { hold = fn; },
    // Call when the hold may have ended (e.g. the online game finished).
    recheck: check,
  };
})();
