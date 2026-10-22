import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDocument: () =>
    ipcRenderer.invoke("select-document"),

  convertDocument: (filePath: string, previousWarnings = []) =>
    ipcRenderer.invoke("convert-document", filePath, previousWarnings),

  preparePreview: (html: string) =>
    ipcRenderer.invoke("prepare-preview", html),

  exportArticle: (html: string) =>
    ipcRenderer.invoke("export-article", html),

  openSavedArticleFolder: () =>
    ipcRenderer.invoke("open-saved-article-folder"),
});