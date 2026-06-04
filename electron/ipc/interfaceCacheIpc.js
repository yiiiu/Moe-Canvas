import { session } from "electron";

export function registerInterfaceCacheIpcHandlers({ ipcMain }) {
  ipcMain.handle("interfaceCache:clear", async () => {
    await session.defaultSession.clearCache();
    return { ok: true };
  });
}