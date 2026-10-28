// Picks the page language and loads only that language's dictionary, before any other script
// runs (so every script can translate right away). English needs no dictionary. Chinese uses
// js/i18n-zh.js (both Simplified and Traditional); the others use js/lang/<code>.js.
// js/i18n.js then does the translating and shows the language menu.
(function () {
  const LANGUAGES = ["en", "zh-Hans", "zh-Hant", "fr", "es", "de", "ja", "ko"];
  const STORAGE_KEY = "goboard-language";
  let lang = null, chosen = false;

  // A ?lang= link (the language menu uses one) wins and is remembered.
  const fromAddress = new URLSearchParams(window.location.search).get("lang");
  if (LANGUAGES.includes(fromAddress)) {
    lang = fromAddress;
    chosen = true;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* only for this visit */ }
  } else {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGUAGES.includes(saved)) { lang = saved; chosen = true; }
    } catch { /* private window: use the browser's language */ }
  }

  // Not chosen yet: the browser's language (the first-visit window in i18n.js asks to confirm).
  const browser = (navigator.language || "").toLowerCase();
  let suggested = "en";
  if (/^zh-(tw|hk|mo|hant)/.test(browser)) suggested = "zh-Hant";
  else if (browser.startsWith("zh")) suggested = "zh-Hans";
  else if (LANGUAGES.includes(browser.slice(0, 2))) suggested = browser.slice(0, 2);
  if (!lang) lang = suggested;

  window.GO_LANG = { lang, chosen, suggested, all: LANGUAGES, storageKey: STORAGE_KEY };

  const script = document.currentScript;
  const version = script ? new URL(script.src).search : "";
  const base = script ? script.src.replace(/i18n-load\.js.*$/, "") : "js/";
  const file = lang.startsWith("zh") ? "i18n-zh.js" : lang === "en" ? null : `lang/${lang}.js`;
  // document.write keeps the order: the dictionary is ready before the next script on the page.
  if (file) document.write(`<script src="${base}${file}${version}"><\/script>`);
})();
