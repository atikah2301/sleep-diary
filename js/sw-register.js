if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });

  // sw.js calls skipWaiting()/clients.claim(), so a newly deployed worker takes
  // control of the page as soon as it activates. Reload once when that happens
  // so this load is served by it, rather than needing a second manual reload.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
