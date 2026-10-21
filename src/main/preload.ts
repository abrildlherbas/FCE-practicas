import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDocument: () =>
    ipcRenderer.invoke("select-document"),

  convertDocument: (filePath: string) =>
    ipcRenderer.invoke("convert-document", filePath),

  preparePreview: (html: string) =>
    ipcRenderer.invoke("prepare-preview", html),

  exportArticle: (html: string) =>
    ipcRenderer.invoke("export-article", html),
});