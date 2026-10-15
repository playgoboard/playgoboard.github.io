// Replaces bad words in chat messages with ****.
// It also catches the usual tricks: sh1t, $hit, fuuuck, f.u.c.k and f u c k.
(function () {
  // Words that are bad wherever they appear inside a word ("fucking", "bullshitter").
  const BAD_ANYWHERE = [
    "fuck", "fuk", "shit", "bitch", "cunt", "nigg", "fagg", "whore", "slut", "motherf",
    "asshole", "pussy", "wank", "twat", "dickhead", "bastard", "douche", "retard", "jackass", "dumbass",
  ];
  // Words that are only bad on their own (so "class", "cocktail" and "assist" stay fine).
  const BAD_EXACT = new Set([
    "ass", "asses", "dick", "dicks", "cock", "cocks", "fag", "fags", "piss", "pissed", "prick", "pricks",
    "tits", "kys", "stfu", "wtf", "porn", "nazi",
  ]);

  const LOOKALIKES = { 0: "o", 1: "i", "!": "i", "|": "i", 3: "e", 4: "a", "@": "a", 5: "s", $: "s", 7: "t", 8: "b", "+": "t" };

  function normalize(word) {
    let out = "";
    for (const ch of word.toLowerCase()) {
      const mapped = LOOKALIKES[ch] || ch;
      if (mapped >= "a" && mapped <= "z") out += mapped;
    }
    return out;
  }

  const squeeze = (text, keep) => text.replace(/(.)\1+/g, (run, ch) => ch.repeat(Math.min(run.length, keep)));

  function isBad(word) {
    const plain = normalize(word);
    if (!plain) return false;
    for (const form of [plain, squeeze(plain, 2), squeeze(plain, 1)]) {
      if (BAD_EXACT.has(form)) return true;
      if (BAD_ANYWHERE.some((bad) => form.includes(bad))) return true;
    }
    return false;
  }

  const stars = (word) => "*".repeat(Math.max(4, Math.min(word.length, 8)));

  function cleanMessage(text) {
    const parts = text.split(/(\s+)/); // keep the spaces so the message looks the same
    const words = parts.map((part, i) => ({ part, i })).filter(({ part }) => part.trim());

    const badIndexes = new Set();
    const spelledOut = new Set(); // single letters of a spelled-out word become a single *
    for (const { part, i } of words) if (isBad(part)) badIndexes.add(i);

    // Spelled out with spaces: "f u c k". Join runs of single letters and test them together.
    for (let start = 0; start < words.length; start++) {
      if (normalize(words[start].part).length !== 1) continue;
      let end = start;
      while (end + 1 < words.length && normalize(words[end + 1].part).length === 1) end++;
      if (end > start && isBad(words.slice(start, end + 1).map((w) => w.part).join(""))) {
        for (let k = start; k <= end; k++) spelledOut.add(words[k].i);
      }
      start = end;
    }

    return parts.map((part, i) => (spelledOut.has(i) ? "*" : badIndexes.has(i) ? stars(part) : part)).join("");
  }

  window.GoChatFilter = { cleanMessage };
})();
