import { lazy } from 'react';

/**
 * forceUpdateAndReload
 * Bypasses PWA Cache Storage and unregisters Service Workers before reloading
 * to guarantee that the browser fetches the new index.html referencing the current hashes.
 */
async function forceUpdateAndReload() {
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch (e) {}

  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
  } catch (e) {}

  try {
    window.location.reload();
  } catch (e) {
    if (typeof location !== 'undefined' && location.reload) {
      location.reload();
    }
  }
}

/**
 * lazyWithRetry
 *
 * Wraps dynamic imports in React.lazy with retry logic.
 * If a dynamic import fails (common after a new deployment due to stale chunk hashes),
 * it stores a retry flag in sessionStorage and reloads the page *once* to get the latest assets.
 * If it fails again, it throws the error so the Error Boundary can handle it gracefully
 * (preventing infinite reload loops).
 *
 * @param {() => Promise<{ default: React.ComponentType<any> }>} componentImport
 * @param {string} chunkName - A stable, unique identifier for the chunk/component
 */
export function lazyWithRetry(componentImport, chunkName) {
  return lazy(async () => {
    const storageKey = `chunk-retry-${chunkName}`;
    try {
      const component = await componentImport();
      // Successful load — clear any prior retry flag for this chunk.
      sessionStorage.removeItem(storageKey);
      return component;
    } catch (error) {
      const alreadyRetried = sessionStorage.getItem(storageKey) === 'true';

      if (!alreadyRetried) {
        // First failure for this chunk in this session — reload once to pick up the fresh build.
        sessionStorage.setItem(storageKey, 'true');
        console.warn(`Chunk load failed for ${chunkName}. Force reloading page bypassing PWA cache...`, error);
        forceUpdateAndReload();
        // Return a promise that never resolves; the reload takes over before this matters.
        return new Promise(() => {});
      }

      // Already retried once and it still failed — this is a real, persistent problem
      // (network issue, or the deploy is somehow broken), not just a stale-chunk timing issue.
      // Surface it to the error boundary instead of reloading forever.
      throw error;
    }
  });
}
