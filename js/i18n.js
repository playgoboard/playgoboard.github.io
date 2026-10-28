// Languages: English (the text in the code), Simplified and Traditional Chinese, French,
// Spanish, German, Japanese and Korean. The English text itself is the lookup key, so code only
// wraps its text: t("Your move") or t("{name} passed.", { name }). js/i18n-load.js (loaded first)
// picks the language and loads its dictionary: js/i18n-zh.js ("English": [simplified,
// traditional]) or js/lang/<code>.js ("English": "translation").
// Text written straight into the HTML is translated once when the page has loaded.
// Picking another language saves it and reloads the page. The first visit asks which one.
(function () {
  const LANGUAGES = {
    en: "English", "zh-Hans": "简体中文", "zh-Hant": "繁體中文", fr: "Français",
    es: "Español", de: "Deutsch", ja: "日本語", ko: "한국어",
  };
  // Phones show short names so the top bar fits on one row.
  const SHORT = { en: "EN", "zh-Hans": "简", "zh-Hant": "繁", fr: "FR", es: "ES", de: "DE", ja: "日", ko: "한" };
  const loaded = window.GO_LANG || { lang: "en", chosen: true, suggested: "en", storageKey: "goboard-language" };
  const lang = LANGUAGES[loaded.lang] ? loaded.lang : "en";
  document.documentElement.lang = lang;

  // The dictionary for this language: a function from English text to the translation (or undefined).
  const zhColumn = lang === "zh-Hans" ? 0 : lang === "zh-Hant" ? 1 : -1;
  const lookup = zhColumn >= 0
    ? (key) => { const entry = (window.GO_TEXT_ZH || {})[key]; return entry ? entry[zhColumn] : undefined; }
    : lang === "en" ? () => undefined
    : (key) => (window.GO_TEXT || {})[key];

  const squash = (text) => text.replace(/\s+/g, " ").trim();
  const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? vars[name] : all)) : text);

  function t(text, vars) {
    const translated = lookup(squash(text));
    return fill(translated !== undefined ? translated : text, vars);
  }

  // Translate the fixed text of the page: text nodes, placeholders and tooltips.
  // Paragraphs with bold words inside use data-t-html="key" with a ready-made translation.
  function translatePage(root = document.body) {
    if (lang === "en") return;
    for (const el of root.querySelectorAll("[data-t-html]")) {
      const html = lookup(el.dataset.tHtml);
      if (html) el.innerHTML = html;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("script, style, [data-t-html], [data-no-t]")) continue;
      const key = squash(node.nodeValue);
      const translated = key ? lookup(key) : undefined;
      if (translated === undefined) continue;
      const lead = node.nodeValue.match(/^\s*/)[0], tail = node.nodeValue.match(/\s*$/)[0];
      node.nodeValue = lead + translated + tail;
    }
    for (const el of root.querySelectorAll("[placeholder], [title], [aria-label]")) {
      for (const attr of ["placeholder", "title", "aria-label"]) {
        const value = el.getAttribute(attr);
        const translated = value ? lookup(squash(value)) : undefined;
        if (translated !== undefined) el.setAttribute(attr, translated);
      }
    }
    document.title = t(document.title);
  }

  // Switching language reloads the page with ?lang= (i18n-load.js remembers it).
  const reloadChecks = [];
  function switchTo(code) {
    if (reloadChecks.some((check) => !check())) return false;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", code);
    window.location.replace(url.toString());
    return true;
  }

  // The menu in the top bar.
  function addMenu() {
    const bar = document.querySelector(".top-bar");
    if (!bar) return;
    const select = document.createElement("select");
    select.className = "lang-select";
    select.setAttribute("aria-label", t("Language"));
    const narrow = window.matchMedia("(max-width: 560px)");
    for (const [code, name] of Object.entries(LANGUAGES)) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = narrow.matches ? SHORT[code] : name;
      option.selected = code === lang;
      select.append(option);
    }
    narrow.addEventListener("change", () => {
      for (const option of select.options) option.textContent = narrow.matches ? SHORT[option.value] : LANGUAGES[option.value];
    });
    select.addEventListener("change", () => { if (!switchTo(select.value)) select.value = lang; });
    bar.append(select);
  }

  // First visit: ask which language (the browser's own language is highlighted).
  function askLanguage() {
    if (loaded.chosen || !document.querySelector(".top-bar")) return;
    const dialog = document.createElement("dialog");
    dialog.className = "account-dialog language-dialog";
    const heading = document.createElement("h2");
    heading.textContent = `🌐 ${t("Choose your language")}`;
    const note = document.createElement("p");
    note.textContent = t("You can change it any time with the menu at the top.");
    const grid = document.createElement("div");
    grid.className = "language-grid";
    for (const [code, name] of Object.entries(LANGUAGES)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn${code === loaded.suggested ? " btn-primary" : ""}`;
      b.textContent = name;
      b.addEventListener("click", () => {
        try { localStorage.setItem(loaded.storageKey, code); } catch { /* asked again next time */ }
        if (code === lang) dialog.close();
        else switchTo(code);
      });
      grid.append(b);
    }
    dialog.append(heading, grid, note);
    // Closing without choosing keeps the suggested language.
    dialog.addEventListener("close", () => {
      try { if (!localStorage.getItem(loaded.storageKey)) localStorage.setItem(loaded.storageKey, lang); } catch { /* fine */ }
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  document.addEventListener("DOMContentLoaded", () => {
    translatePage();
    addMenu();
    askLanguage();
  });

  // Several sentences in a row: most languages put a space between them, Chinese and Japanese don't.
  const sentences = (...parts) => parts.filter(Boolean).join(/^(zh|ja)/.test(lang) ? "" : " ");

  window.GoI18n = {
    lang,
    t,
    sentences,
    translatePage,
    // Another file can stop a language change, e.g. during an online game: return false to cancel.
    beforeChange(check) { reloadChecks.push(check); },
  };
})();
