const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("systemDiagnostics", {
  list: () => ipcRenderer.invoke("diagnostics:list"),
  record: (entry) => ipcRenderer.send("diagnostics:record", entry),
  exportForLlm: () => ipcRenderer.invoke("diagnostics:export"),
  subscribe: (listener) => {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on("diagnostics:entry", handler);
    return () => ipcRenderer.removeListener("diagnostics:entry", handler);
  },
});
