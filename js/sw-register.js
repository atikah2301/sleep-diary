if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        // iOS treats launching a standalone home-screen app (especially after a
        // full force-quit) differently from a normal page navigation, and its
        // automatic "is sw.js newer?" check often never fires there. Explicitly
        // calling update() on every load - and again whenever the app is
        // brought back to the foreground - forces that check ourselves instead
        // of relying on the browser to do it.
        registration.update();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registration.update();
        });
      })
      .catch((err) => {
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
