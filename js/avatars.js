// Profile pictures: small drawings (SVG) on a round colored background. Players pick one on their
// profile (no uploads). The names must match supabase/08-profiles.sql and 14-rewards.sql.
// Reward pictures (and titles and frames) unlock when a whole achievement group is finished.
(function () {
  // Each drawing is in a box from -52 to 52, with its round background.
  const bg = (color) => `<circle r="52" fill="${color}"/>`;
  const stone = (x, y, r, color) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color === "black" ? "#111" : "#f4f2ec"}"/>`
    + `<circle cx="${x - r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.3}" fill="${color === "black" ? "#555" : "#fff"}"/>`;

  const PICTURES = {
    black: bg("#c9a75a") + `<g stroke="#5a4320" stroke-width="2" opacity=".5"><line x1="-52" y1="-18" x2="52" y2="-18"/><line x1="-52" y1="18" x2="52" y2="18"/><line x1="-18" y1="-52" x2="-18" y2="52"/><line x1="18" y1="-52" x2="18" y2="52"/></g>` + stone(0, 0, 26, "black"),
    white: bg("#3d3a37") + `<g stroke="#6a655f" stroke-width="2"><line x1="-52" y1="-18" x2="52" y2="-18"/><line x1="-52" y1="18" x2="52" y2="18"/><line x1="-18" y1="-52" x2="-18" y2="52"/><line x1="18" y1="-52" x2="18" y2="52"/></g>` + stone(0, 0, 26, "white"),
    dragon: bg("#24543c") + `<path d="M-30 18 L-8 -2 L-14 -26 L4 -10 L20 -34 L22 -6 L36 -2 L28 10 L34 22 L14 18 L4 30 Z" fill="#7cc46a"/><path d="M4 -10 L20 -34 L22 -6 Z" fill="#4f9a48"/><circle cx="14" cy="2" r="5" fill="#111"/><circle cx="12.5" cy=".5" r="1.6" fill="#fff"/><path d="M28 10 L36 14 L30 16" fill="#f4f2ec"/><path d="M-30 18 Q-40 30 -26 40" fill="none" stroke="#7cc46a" stroke-width="5" stroke-linecap="round"/>`,
    tiger: bg("#2f4f5f") + `<circle cx="-24" cy="-24" r="10" fill="#e8892c"/><circle cx="24" cy="-24" r="10" fill="#e8892c"/><circle cx="-24" cy="-24" r="5" fill="#f6d2a5"/><circle cx="24" cy="-24" r="5" fill="#f6d2a5"/><circle cy="4" r="32" fill="#e8892c"/><ellipse cy="18" rx="18" ry="14" fill="#fbe9d2"/><g stroke="#2a1d14" stroke-width="4" stroke-linecap="round"><line x1="0" y1="-28" x2="0" y2="-16"/><line x1="-10" y1="-26" x2="-8" y2="-17"/><line x1="10" y1="-26" x2="8" y2="-17"/><line x1="-32" y1="0" x2="-20" y2="2"/><line x1="32" y1="0" x2="20" y2="2"/><line x1="-30" y1="12" x2="-20" y2="10"/><line x1="30" y1="12" x2="20" y2="10"/></g><circle cx="-11" cy="-4" r="4" fill="#111"/><circle cx="11" cy="-4" r="4" fill="#111"/><path d="M-5 12 L5 12 L0 18 Z" fill="#2a1d14"/>`,
    fox: bg("#3c5a3a") + `<path d="M-34 -36 L-12 -18 L12 -18 L34 -36 L30 6 L0 34 L-30 6 Z" fill="#e2702c"/><path d="M-30 6 L-14 2 L0 34 Z" fill="#fbf1e4"/><path d="M30 6 L14 2 L0 34 Z" fill="#fbf1e4"/><path d="M-28 -28 L-16 -18 L-24 -12 Z" fill="#3a2418"/><path d="M28 -28 L16 -18 L24 -12 Z" fill="#3a2418"/><circle cx="-11" cy="-4" r="4" fill="#111"/><circle cx="11" cy="-4" r="4" fill="#111"/><circle cy="30" r="5" fill="#111"/>`,
    panda: bg("#5a8a5c") + `<circle cx="-26" cy="-26" r="11" fill="#1b1b1b"/><circle cx="26" cy="-26" r="11" fill="#1b1b1b"/><circle cy="4" r="32" fill="#f7f5f0"/><ellipse cx="-13" cy="-2" rx="9" ry="11" fill="#1b1b1b" transform="rotate(-20 -13 -2)"/><ellipse cx="13" cy="-2" rx="9" ry="11" fill="#1b1b1b" transform="rotate(20 13 -2)"/><circle cx="-12" cy="-3" r="3" fill="#fff"/><circle cx="12" cy="-3" r="3" fill="#fff"/><ellipse cy="14" rx="6" ry="4" fill="#1b1b1b"/><path d="M-6 22 Q0 27 6 22" fill="none" stroke="#1b1b1b" stroke-width="2.5" stroke-linecap="round"/>`,
    owl: bg("#2c3e5c") + `<ellipse cy="10" rx="28" ry="32" fill="#9a6b3e"/><ellipse cy="18" rx="16" ry="20" fill="#e5cfa8"/><path d="M-26 -18 L-30 -36 L-14 -24 Z M26 -18 L30 -36 L14 -24 Z" fill="#9a6b3e"/><circle cx="-11" cy="-6" r="10" fill="#fff"/><circle cx="11" cy="-6" r="10" fill="#fff"/><circle cx="-11" cy="-6" r="5" fill="#111"/><circle cx="11" cy="-6" r="5" fill="#111"/><path d="M-4 4 L0 11 L4 4 Z" fill="#e8a33a"/>`,
    turtle: bg("#2f6f86") + `<ellipse cx="34" cy="8" rx="11" ry="9" fill="#8fc46e"/><circle cx="37" cy="5" r="2" fill="#111"/><ellipse cx="-20" cy="24" rx="8" ry="6" fill="#8fc46e"/><ellipse cx="18" cy="24" rx="8" ry="6" fill="#8fc46e"/><path d="M-34 18 A34 30 0 0 1 30 18 Z" fill="#4f8a3c"/><g fill="none" stroke="#2f5a24" stroke-width="2.5"><path d="M-10 -8 L10 -8 L16 4 L10 16 L-10 16 L-16 4 Z"/><line x1="-16" y1="4" x2="-30" y2="4"/><line x1="16" y1="4" x2="28" y2="4"/><line x1="-10" y1="-8" x2="-16" y2="-14"/><line x1="10" y1="-8" x2="16" y2="-14"/></g>`,
    cat: bg("#b0705a") + `<path d="M-30 -14 L-26 -40 L-8 -24 Z M30 -14 L26 -40 L8 -24 Z" fill="#8a8f98"/><path d="M-26 -18 L-24 -32 L-14 -24 Z M26 -18 L24 -32 L14 -24 Z" fill="#f2b8c0"/><circle cy="4" r="30" fill="#8a8f98"/><ellipse cx="-11" cy="0" rx="5" ry="7" fill="#c8e06a"/><ellipse cx="11" cy="0" rx="5" ry="7" fill="#c8e06a"/><ellipse cx="-11" cy="0" rx="2" ry="6" fill="#111"/><ellipse cx="11" cy="0" rx="2" ry="6" fill="#111"/><path d="M-4 12 L4 12 L0 16 Z" fill="#f2a0aa"/><g stroke="#e8e8e8" stroke-width="1.5"><line x1="-8" y1="16" x2="-34" y2="12"/><line x1="-8" y1="19" x2="-34" y2="22"/><line x1="8" y1="16" x2="34" y2="12"/><line x1="8" y1="19" x2="34" y2="22"/></g>`,
    rabbit: bg("#6a5a9a") + `<ellipse cx="-12" cy="-26" rx="8" ry="22" fill="#f4f2ec"/><ellipse cx="12" cy="-26" rx="8" ry="22" fill="#f4f2ec"/><ellipse cx="-12" cy="-26" rx="4" ry="16" fill="#f2b8c0"/><ellipse cx="12" cy="-26" rx="4" ry="16" fill="#f2b8c0"/><circle cy="14" r="26" fill="#f4f2ec"/><circle cx="-10" cy="8" r="4" fill="#111"/><circle cx="10" cy="8" r="4" fill="#111"/><ellipse cy="18" rx="4" ry="3" fill="#e88a9a"/><path d="M-5 24 Q0 28 5 24" fill="none" stroke="#999" stroke-width="2"/>`,
    frog: bg("#3a5c8a") + `<circle cx="-16" cy="-18" r="13" fill="#6bbf4f"/><circle cx="16" cy="-18" r="13" fill="#6bbf4f"/><ellipse cy="10" rx="34" ry="26" fill="#6bbf4f"/><circle cx="-16" cy="-18" r="8" fill="#fff"/><circle cx="16" cy="-18" r="8" fill="#fff"/><circle cx="-15" cy="-17" r="4" fill="#111"/><circle cx="15" cy="-17" r="4" fill="#111"/><path d="M-20 14 Q0 30 20 14" fill="none" stroke="#2f6a24" stroke-width="3.5" stroke-linecap="round"/><circle cx="-24" cy="6" r="4" fill="#f2a0aa" opacity=".7"/><circle cx="24" cy="6" r="4" fill="#f2a0aa" opacity=".7"/>`,
    octopus: bg("#1f5f7a") + `<g fill="#b44f9a"><path d="M-26 6 Q-36 30 -22 40 Q-24 26 -14 14 Z"/><path d="M-12 12 Q-18 34 -6 42 Q-6 28 -2 16 Z"/><path d="M12 12 Q18 34 6 42 Q6 28 2 16 Z"/><path d="M26 6 Q36 30 22 40 Q24 26 14 14 Z"/></g><ellipse cy="-6" rx="28" ry="26" fill="#c45daa"/><circle cx="-10" cy="-6" r="6" fill="#fff"/><circle cx="10" cy="-6" r="6" fill="#fff"/><circle cx="-9" cy="-5" r="3" fill="#111"/><circle cx="11" cy="-5" r="3" fill="#111"/><circle cx="-16" cy="-24" r="3" fill="#e08acb"/><circle cx="12" cy="-28" r="2" fill="#e08acb"/>`,
    bamboo: bg("#e9e2c8") + `<g fill="#5a9a3c"><rect x="-22" y="-52" width="10" height="104"/><rect x="2" y="-52" width="10" height="104"/></g><g fill="#3f7a2a"><rect x="-23" y="-22" width="12" height="3"/><rect x="-23" y="14" width="12" height="3"/><rect x="1" y="-34" width="12" height="3"/><rect x="1" y="2" width="12" height="3"/><rect x="1" y="34" width="12" height="3"/></g><g fill="#6fb04a"><path d="M12 -32 Q30 -40 40 -30 Q26 -28 12 -30 Z"/><path d="M12 4 Q32 -2 42 8 Q28 8 12 6 Z"/><path d="M-22 -20 Q-40 -28 -46 -16 Q-34 -16 -22 -18 Z"/></g>`,
    blossom: bg("#3f5a7a") + `<g fill="#f3a6c0">${[0, 72, 144, 216, 288].map((a) => `<ellipse cy="-18" rx="13" ry="18" transform="rotate(${a})"/>`).join("")}</g><g fill="#e57aa0">${[0, 72, 144, 216, 288].map((a) => `<ellipse cy="-12" rx="4" ry="8" transform="rotate(${a})"/>`).join("")}</g><circle r="8" fill="#f6d35b"/>`,
    moon: bg("#1d2a4a") + `<circle cx="-4" cy="2" r="28" fill="#f2d675"/><circle cx="10" cy="-8" r="25" fill="#1d2a4a"/><g fill="#f4f2ec"><circle cx="22" cy="18" r="2.5"/><circle cx="30" cy="-24" r="2"/><circle cx="-26" cy="-30" r="1.8"/><circle cx="34" cy="2" r="1.5"/></g>`,
    star: bg("#2f4a8a") + `<path d="M0 -34 L9 -12 L33 -11 L14 4 L21 28 L0 14 L-21 28 L-14 4 L-33 -11 L-9 -12 Z" fill="#f6c84a"/><path d="M0 -34 L9 -12 L33 -11 L14 4 L0 0 Z" fill="#fbdc7a"/>`,

    // ---- Rewards: one per finished achievement group ----
    robot: bg("#3a1c1a") + `<line x1="0" y1="-30" x2="0" y2="-40" stroke="#b9c0ca" stroke-width="3"/><circle cy="-42" r="5" fill="#e04a3a"/><rect x="-36" y="-10" width="8" height="18" rx="3" fill="#8a929c"/><rect x="28" y="-10" width="8" height="18" rx="3" fill="#8a929c"/><rect x="-30" y="-30" width="60" height="54" rx="10" fill="#c9ced6"/><rect x="-24" y="-22" width="48" height="24" rx="6" fill="#1d2430"/>` + stone(-11, -10, 7, "black") + `<circle cx="-11" cy="-10" r="7.5" fill="none" stroke="#3fd0d6" stroke-width="1.5"/>` + stone(11, -10, 7, "white") + `<g fill="#6b737e"><rect x="-16" y="9" width="5" height="9" rx="1"/><rect x="-7" y="9" width="5" height="9" rx="1"/><rect x="2" y="9" width="5" height="9" rx="1"/><rect x="11" y="9" width="5" height="9" rx="1"/></g><circle cx="-24" cy="-26" r="2" fill="#8a929c"/><circle cx="24" cy="-26" r="2" fill="#8a929c"/><rect x="-14" y="26" width="28" height="8" rx="2" fill="#8a929c"/>`,
    "puzzle-piece": bg("#2f5d8a") + `<path d="M-26 -26 H-6 A8 8 0 1 1 6 -26 H26 V-6 A8 8 0 1 0 26 6 V26 H6 A8 8 0 1 1 -6 26 H-26 V6 A8 8 0 1 0 -26 -6 Z" fill="#e7b544"/>` + stone(-8, -6, 8, "black") + stone(9, 8, 8, "white"),
    crown: bg("#4a2f73") + `<rect x="-26" y="2" width="52" height="30" rx="3" fill="#dcb35c"/><g stroke="#3b2a14" stroke-width="1.5"><line x1="-26" y1="12" x2="26" y2="12"/><line x1="-26" y1="22" x2="26" y2="22"/><line x1="-12" y1="2" x2="-12" y2="32"/><line x1="0" y1="2" x2="0" y2="32"/><line x1="12" y1="2" x2="12" y2="32"/></g><circle cx="-12" cy="12" r="4.5" fill="#111"/><circle cx="12" cy="22" r="4.5" fill="#f4f2ec"/><path d="M-22 -4 L-24 -30 L-11 -16 L0 -34 L11 -16 L24 -30 L22 -4 Z" fill="#f1c84b"/><circle cy="-34" r="3.5" fill="#d64545"/><circle cx="-24" cy="-30" r="3" fill="#4fa3d9"/><circle cx="24" cy="-30" r="3" fill="#4fa3d9"/>`,
    rainbow: bg("#1d6f73") + `<g fill="none" stroke-width="6"><path d="M-36 22 A36 36 0 0 1 36 22" stroke="#e05555"/><path d="M-28 22 A28 28 0 0 1 28 22" stroke="#f1c84b"/><path d="M-20 22 A20 20 0 0 1 20 22" stroke="#5cc26e"/><path d="M-12 22 A12 12 0 0 1 12 22" stroke="#5ba7e8"/></g>` + stone(-24, -26, 7, "black") + stone(24, -26, 7, "white") + `<circle cy="-38" r="4" fill="#f1c84b"/>`,
    flame: bg("#2b2522") + `<path d="M0 -40 C18 -18 30 -10 26 12 C24 30 10 38 0 38 C-10 38 -24 30 -26 12 C-30 -8 -14 -14 -8 -30 C-4 -20 0 -18 0 -40 Z" fill="#e8642c"/><path d="M0 -18 C10 -4 16 4 14 18 C12 30 6 34 0 34 C-6 34 -12 30 -14 18 C-16 6 -6 0 0 -18 Z" fill="#f4a531"/>` + stone(0, 20, 10, "black"),
  };

  // The achievement groups and what finishing each one unlocks. Must match supabase/14-rewards.sql.
  const REWARDS = {
    Bots: { picture: "robot", title: "Dragon Slayer", frame: "red", look: ["stones", "dragon", "Dragon stones"] },
    Puzzles: { picture: "puzzle-piece", title: "Puzzle Master", frame: "gold", look: ["board", "golden", "Golden board"] },
    Online: { picture: "crown", title: "Champion", frame: "purple", look: ["stones", "royal", "Royal stones"] },
    Fun: { picture: "rainbow", title: "Trickster", frame: "cyan", look: ["board", "neon", "Neon board"] },
    Streak: { picture: "flame", title: "Unstoppable", frame: "orange", look: ["board", "fire", "Fire board"] },
  };
  const FRAME_COLORS = { red: "#d64545", gold: "#e7b544", purple: "#9b6bd6", cyan: "#3fd0d6", orange: "#f08a2c" };
  const REWARD_PICTURES = new Set(Object.values(REWARDS).map((r) => r.picture));

  // A round picture element, optionally with a colored frame. Without a picture: the first letter
  // of the name on gray.
  function element(key, name, size = 40, frame = null) {
    const el = document.createElement("span");
    el.className = "avatar";
    el.style.width = el.style.height = `${size}px`;
    if (PICTURES[key]) {
      el.innerHTML = `<svg viewBox="-52 -52 104 104" width="${size}" height="${size}" aria-hidden="true">${PICTURES[key]}</svg>`;
    } else {
      el.style.background = "var(--panel-light)";
      el.style.fontSize = `${Math.round(size * 0.55)}px`;
      el.textContent = (name || "?").charAt(0).toUpperCase();
    }
    if (FRAME_COLORS[frame]) {
      const ring = Math.max(2, Math.round(size / 16));
      el.style.boxShadow = `0 0 0 ${ring}px ${FRAME_COLORS[frame]}, 0 0 ${ring * 3}px ${FRAME_COLORS[frame]}`;
    }
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

  window.GoAvatars = {
    names: Object.keys(PICTURES).filter((k) => !REWARD_PICTURES.has(k)),
    element, profileLink, REWARDS, FRAME_COLORS,
  };
})();
