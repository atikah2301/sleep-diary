export function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function retryHint() {
  return isMobileDevice() ? "Try closing and reopening the app." : "Try refreshing the page.";
}

export function isOnline() {
  return navigator.onLine;
}

/** navigator.onLine reflects the network interface, not real reachability of Supabase - it can
 * report "online" on a captive portal or dead wifi. Accepted as a known limitation; no active
 * ping-based probing, to keep this the "easy win". */
export function onConnectivityChange(callback) {
  window.addEventListener("online", () => callback(true));
  window.addEventListener("offline", () => callback(false));
}
