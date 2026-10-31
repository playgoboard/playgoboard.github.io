// On phones and tablets the category row in the top bar (Play a friend, Bots, Online…) scrolls
// sideways. Small ‹ › arrows show at its edges while there is more to see; tapping one scrolls it.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const nav = document.getElementById("nav");
    if (!nav) return;
    // A wrapper holds the row and its arrows, so the arrows stay put while the row scrolls.
    const wrap = document.createElement("div");
    wrap.className = "nav-wrap";
    nav.before(wrap);
    wrap.append(nav);

    function arrow(side) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `nav-arrow nav-arrow-${side}`;
      b.textContent = side === "left" ? "‹" : "›";
      b.setAttribute("aria-hidden", "true"); // the row itself can still be scrolled and read
      b.tabIndex = -1;
      b.addEventListener("click", () => {
        nav.scrollBy({ left: (side === "left" ? -1 : 1) * nav.clientWidth * 0.7, behavior: "smooth" });
      });
      wrap.append(b);
      return b;
    }
    const left = arrow("left"), right = arrow("right");

    function update() {
      const more = nav.scrollWidth - nav.clientWidth;
      left.hidden = more <= 2 || nav.scrollLeft <= 2;
      right.hidden = more <= 2 || nav.scrollLeft >= more - 2;
    }
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    // Translations and the Daily badge change the row's width after loading.
    setTimeout(update, 500);
    setTimeout(update, 2000);

    // Start with the current page's category in view.
    const active = nav.querySelector(".active");
    if (active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(0, active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2);
      update();
    }
  });
})();
