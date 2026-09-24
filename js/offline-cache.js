import { isOnline } from "./device.js";

const PREFIX = "sleep-diary-cache:";

function cacheSet(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // Caching is a nice-to-have - never let a storage failure break a successful fetch.
  }
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function looksLikeNetworkFailure(error) {
  // A genuine network failure (DNS/TLS/connection refused) surfaces as a plain "Failed to
  // fetch"-style message with no Postgrest error code, distinct from a real server-side error
  // (bad query, RLS denial). Lets a navigator.onLine false-positive still fall back to cache
  // without masking genuine errors while truly online.
  return !error?.code && /fetch|network/i.test(error?.message ?? "");
}

export async function fetchWithOfflineFallback(cacheKey, fetchFn) {
  if (!isOnline()) return fallbackResult(cacheKey);
  const { data, error } = await fetchFn();
  if (error) {
    if (looksLikeNetworkFailure(error) || !isOnline()) return fallbackResult(cacheKey);
    return { data: null, error, fromCache: false };
  }
  cacheSet(cacheKey, data);
  return { data, error: null, fromCache: false };
}

function fallbackResult(cacheKey) {
  const cached = cacheGet(cacheKey);
  if (cached) return { data: cached.data, error: null, fromCache: true, cachedAt: cached.cachedAt };
  return {
    data: null,
    error: { message: "You're offline and this hasn't been loaded before, so there's nothing cached to show." },
    fromCache: false,
  };
}
