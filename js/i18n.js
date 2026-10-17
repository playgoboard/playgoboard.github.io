// Languages: English (the text in the code), Simplified and Traditional Chinese.
// The English text itself is the lookup key into the dictionary in i18n-zh.js, so
// code only wraps its text: t("Your move") or t("{name} passed.", { name }).
// Text written straight into the HTML is translated once when the page has loaded.
// Picking another language saves it and reloads the page.
(function () {
  const LANGUAGES = { en: "English", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const STORAGE_KEY = "goboard-language";
  const DICTIONARY = window.GO_TEXT_ZH || {};

  function startLanguage() {
    // A ?lang= link (the menu below uses one) wins and is remembered.
    const fromAddress = new URLSearchParams(window.location.search).get("lang");
    if (LANGUAGES[fromAddress]) {
      try { localStorage.setItem(STORAGE_KEY, fromAddress); } catch { /* only for this visit */ }
      return fromAddress;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGUAGES[saved]) return saved;
    } catch { /* private window: fall back to the browser language */ }
    const browser = (navigator.language || "").toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(browser)) return "zh-Hant";
    if (browser.startsWith("zh")) return "zh-Hans";
    return "en";
  }

  const lang = startLanguage();
  document.documentElement.lang = lang;
  const column = lang === "zh-Hans" ? 0 : lang === "zh-Hant" ? 1 : -1;

  const squash = (text) => text.replace(/\s+/g, " ").trim();
  const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? vars[name] : all)) : text);

  function t(text, vars) {
    if (column >= 0) {
      const entry = DICTIONARY[squash(text)];
      if (entry) return fill(entry[column], vars);
    }
    return fill(text, vars);
  }

  // Translate the fixed text of the page: text nodes, placeholders and tooltips.
  // Paragraphs with bold words inside use data-t-html="key" with a ready-made translation.
  function translatePage(root = document.body) {
    if (column < 0) return;
    for (const el of root.querySelectorAll("[data-t-html]")) {
      const entry = DICTIONARY[el.dataset.tHtml];
      if (entry) el.innerHTML = entry[column];
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("script, style, [data-t-html], [data-no-t]")) continue;
      const key = squash(node.nodeValue);
      if (!key || !DICTIONARY[key]) continue;
      const lead = node.nodeValue.match(/^\s*/)[0], tail = node.nodeValue.match(/\s*$/)[0];
      node.nodeValue = lead + DICTIONARY[key][column] + tail;
    }
    for (const el of root.querySelectorAll("[placeholder], [title], [aria-label]")) {
      for (const attr of ["placeholder", "title", "aria-label"]) {
        const value = el.getAttribute(attr);
        if (value && DICTIONARY[squash(value)]) el.setAttribute(attr, DICTIONARY[squash(value)][column]);
      }
    }
    document.title = t(document.title);
  }

  // The menu in the top bar.
  const reloadChecks = [];
  function addMenu() {
    const bar = document.querySelector(".top-bar");
    if (!bar) return;
    const select = document.createElement("select");
    select.className = "lang-select";
    select.setAttribute("aria-label", t("Language"));
    // Phones show short names so the top bar fits on one row.
    const SHORT = { en: "EN", "zh-Hans": "简", "zh-Hant": "繁" };
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
    select.addEventListener("change", () => {
      if (reloadChecks.some((check) => !check())) {
        select.value = lang;
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("lang", select.value);
      window.location.replace(url.toString());
    });
    bar.append(select);
  }

  document.addEventListener("DOMContentLoaded", () => {
    translatePage();
    addMenu();
  });

  // Several sentences in a row: English puts a space between them, Chinese doesn't.
  const sentences = (...parts) => parts.filter(Boolean).join(column >= 0 ? "" : " ");

  window.GoI18n = {
    lang,
    t,
    sentences,
    translatePage,
    // Another file can stop a language change, e.g. during an online game: return false to cancel.
    beforeChange(check) { reloadChecks.push(check); },
  };
})();
