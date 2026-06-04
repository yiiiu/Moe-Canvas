function getDesktopCacheApi() {
  const api = globalThis.window?.electronAPI?.interfaceCache;
  return api && typeof api.clear === "function" ? api : null;
}

async function clearBrowserCacheStorage() {
  if (!globalThis.caches || typeof globalThis.caches.keys !== "function") {
    return { cleared: 0, supported: false };
  }

  const keys = await globalThis.caches.keys();
  await Promise.all(keys.map((key) => globalThis.caches.delete(key)));
  return { cleared: keys.length, supported: true };
}

function buildReloadUrl() {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("cacheBust", String(Date.now()));
  return url.toString();
}

export async function clearInterfaceCache() {
  const desktopApi = getDesktopCacheApi();
  const desktopResult = desktopApi ? await desktopApi.clear() : null;
  const browserResult = await clearBrowserCacheStorage();

  return {
    ok: true,
    desktop: desktopResult,
    browser: browserResult,
    reloadUrl: buildReloadUrl(),
  };
}

export function reloadAfterInterfaceCacheClear(result) {
  const reloadUrl = result?.reloadUrl || buildReloadUrl();
  globalThis.location.replace(reloadUrl);
}