// Go ranks worked out from the rating: 100 rating points = one rank. 1200 = 10 kyu, 2100 = 1 kyu,
// 2200 = 1 dan, up to 9 dan. This is GoBoard's own rough scale, not an official one.
(function () {
  const { t } = window.GoI18n;

  function name(rating) {
    if (rating >= 2200) return t("{n} dan", { n: Math.min(9, Math.floor((rating - 2200) / 100) + 1) });
    return t("{n} kyu", { n: Math.min(30, Math.ceil((2200 - rating) / 100)) });
  }

  window.GoRanks = { name };
})();
