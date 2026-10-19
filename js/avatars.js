// Profile pictures: a picture on a colored circle. Players pick one of these on their profile
// (no uploads). The names must match the list in supabase/08-profiles.sql.
(function () {
  const PICTURES = {
    black: ["⚫", "#c9b27c"], white: ["⚪", "#4a4744"], dragon: ["🐉", "#3f7a5a"], tiger: ["🐯", "#c77a2b"],
    fox: ["🦊", "#a6533a"], panda: ["🐼", "#5f6b75"], owl: ["🦉", "#6b5a45"], turtle: ["🐢", "#2f7d7a"],
    cat: ["🐱", "#b08a3e"], rabbit: ["🐰", "#8a6fa8"], frog: ["🐸", "#4f8f3a"], octopus: ["🐙", "#a8466b"],
    bamboo: ["🎋", "#3f6f3f"], blossom: ["🌸", "#b85c7f"], moon: ["🌙", "#2f3f6f"], star: ["⭐", "#3a4f8a"],
  };

  // A round picture element. Without a picture: the first letter of the name on gray.
  function element(key, name, size = 40) {
    const el = document.createElement("span");
    el.className = "avatar";
    el.style.width = el.style.height = `${size}px`;
    el.style.fontSize = `${Math.round(size * 0.55)}px`;
    const picture = PICTURES[key];
    el.style.background = picture ? picture[1] : "var(--panel-light)";
    el.textContent = picture ? picture[0] : (name || "?").charAt(0).toUpperCase();
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  // A player's name that opens their profile page.
  function profileLink(username, text = username) {
    const a = document.createElement("a");
    a.className = "profile-name-link";
    a.href = `leaderboard.html?player=${encodeURIComponent(username)}`;
    a.textContent = text;
    return a;
  }

  window.GoAvatars = { names: Object.keys(PICTURES), element, profileLink };
})();
