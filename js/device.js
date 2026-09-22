export function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function retryHint() {
  return isMobileDevice() ? "Try closing and reopening the app." : "Try refreshing the page.";
}
