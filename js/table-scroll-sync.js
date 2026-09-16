/** Adds a slim duplicate horizontal scrollbar above `scrollEl` (a horizontally-scrolling
 * container) that mirrors its scroll position, so wide tables don't require scrolling all
 * the way down to reach the scrollbar at the bottom. Keeps itself in sync with `contentEl`'s
 * width (e.g. when optional columns are toggled on/off) via a ResizeObserver. */
export function addTopScrollbar(scrollEl, contentEl) {
  const topBar = document.createElement("div");
  topBar.className = "table-scroll-top";
  const spacer = document.createElement("div");
  topBar.appendChild(spacer);
  scrollEl.parentNode.insertBefore(topBar, scrollEl);

  function sync() {
    spacer.style.width = `${contentEl.scrollWidth}px`;
  }

  topBar.addEventListener("scroll", () => {
    scrollEl.scrollLeft = topBar.scrollLeft;
  });
  scrollEl.addEventListener("scroll", () => {
    topBar.scrollLeft = scrollEl.scrollLeft;
  });

  new ResizeObserver(sync).observe(contentEl);
  sync();
}
