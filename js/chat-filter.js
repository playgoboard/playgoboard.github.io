// Replaces bad words in chat messages with ****.
// It also catches the usual tricks: sh1t, $hit, fuuuck, f.u.c.k and f u c k.
(function () {
  // Words that are bad wherever they appear inside a word ("fucking", "bullshitter").
  const BAD_ANYWHERE = [
    "fuck", "fuk", "shit", "bitch", "cunt", "nigg", "fagg", "whore", "slut", "motherf",
    "asshole", "pussy", "wank", "twat", "dickhead", "bastard", "douche", "retard", "jackass", "dumbass",
    // French, Spanish and German (written without accents: the check removes them first).
    "putain", "merde", "connard", "connasse", "salope", "encule", "batard",
    "mierda", "cabron", "pendejo", "gilipollas", "joder", "maricon", "hijoputa", "hijueputa",
    "scheiss", "arschloch", "fotze", "wichser", "hurensohn", "schlampe", "missgeburt",
  ];
  // Words that are only bad on their own (so "class", "cocktail" and "assist" stay fine).
  const BAD_EXACT = new Set([
    "ass", "asses", "dick", "dicks", "cock", "cocks", "fag", "fags", "piss", "pissed", "prick", "pricks",
    "tits", "kys", "stfu", "wtf", "porn", "nazi",
    "pute", "putes", "puta", "putas", "puto", "putos", "arsch",
  ]);

  // Chinese, Japanese and Korean bad words. These languages often have no spaces, so they are
  // found anywhere in the message. Single characters like 操 or 草 are left alone because
  // they are also in normal words (操作 = operate, 草地 = grass).
  const BAD_CJK = [
    "操你妈", "操你媽", "草你妈", "草你媽", "日你妈", "日你媽", "操你","操他", "操她", "操蛋", "我操", "草你", "草泥马", "草泥馬", "肏", "日你", "干你娘", "幹你娘", "幹你",
    "傻逼", "傻b", "傻B", "煞笔", "煞筆", "沙比", "傻屄", "屄", "屌", "鸡巴", "雞巴", "婊子",
    "他妈", "他媽", "你妈", "你媽", "妈的", "媽的", "尼玛", "尼瑪", "你妹", "狗日", "王八蛋", "混蛋",
    "滚蛋", "滾蛋", "贱人", "賤人", "去死", "脑残", "腦殘", "白痴", "白癡", "智障",
    "死ね", "しね", "バカ", "ばか", "馬鹿", "アホ", "あほ", "クソ", "くそ", "キモい", "きもい", "殺す", "ころす",
    "씨발", "시발", "ㅅㅂ", "병신", "ㅂㅅ", "개새끼", "새끼", "좆", "존나", "미친놈", "미친년", "닥쳐", "꺼져",
  ].sort((a, b) => b.length - a.length); // longest first, so whole phrases are hidden
  // Common rude pinyin abbreviations, only bad on their own.
  for (const word of ["sb", "cnm", "nmsl", "tmd", "nmb", "wcnm", "mlgb", "nmd", "rnm"]) BAD_EXACT.add(word);

  // Chat allows the site's languages: ASCII; accented letters (French, Spanish, German); Chinese
  // characters; Japanese kana; Korean Hangul; their punctuation; a few quote marks; and symbols for
  // talking about the board (★ ● ○ ← ↑ → ↓ ×). Must match the About me check in supabase/18-languages.sql.
  const ALLOWED_CHAT = /^[\x20-\x7E\s -ɏḀ-ỿ㐀-䶿一-鿿　-〿぀-ヿㇰ-ㇿᄀ-ᇿ㄰-㆏가-힯！-～｡-ﾟ‘’‚“”„—…·×←-↓■□▲△◆◇○●★☆]*$/;
  const isAllowedText = (text) => ALLOWED_CHAT.test(text);

  const LOOKALIKES = { 0: "o", 1: "i", "!": "i", "|": "i", 3: "e", 4: "a", "@": "a", 5: "s", $: "s", 7: "t", 8: "b", "+": "t" };

  function normalize(word) {
    let out = "";
    // NFKC turns full-width letters (ｆｕｃｋ) into normal ones; then accents are removed (é → e, ß → ss).
    const plain = word.normalize("NFKC").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const ch of plain) {
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

    let clean = parts.map((part, i) => (spelledOut.has(i) ? "*" : badIndexes.has(i) ? stars(part) : part)).join("");
    for (const bad of BAD_CJK) clean = clean.split(bad).join("*".repeat(Math.max(2, bad.length)));
    return clean;
  }

  window.GoChatFilter = { cleanMessage, isAllowedText };
})();
