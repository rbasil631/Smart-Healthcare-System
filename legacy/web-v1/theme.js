// Small display refinements that sit on top of app.js without changing it.
(() => {
  "use strict";
  // Risk-over-time chart: when visits are close together their date labels overlap.
  // Keep the most recent date and drop any earlier label that would collide with one already kept.
  function declutterDates(svg) {
    const ax = [...svg.querySelectorAll("text.ax")];
    if (!ax.length) return;
    const bottom = Math.max(...ax.map(t => Number(t.getAttribute("y"))));
    const dates = ax.filter(t => Number(t.getAttribute("y")) === bottom)
      .map(t => ({ t, box: t.getBBox() }))
      .sort((a, b) => b.box.x - a.box.x);
    let leftEdge = Infinity;
    for (const { t, box } of dates) {
      if (box.x + box.width + 8 <= leftEdge) { leftEdge = box.x; t.style.display = ""; }
      else t.style.display = "none";
    }
  }
  new MutationObserver(() => {
    document.querySelectorAll("#trendSvg:not([data-tidy])").forEach(svg => { svg.dataset.tidy = "1"; declutterDates(svg); });
  }).observe(document.body, { childList: true, subtree: true });
})();
