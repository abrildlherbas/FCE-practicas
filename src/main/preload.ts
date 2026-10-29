import { contextBridge, ipcRenderer } from "electron";
import type { ParseWarning } from "../converter/models/Article";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDocument: () =>
    ipcRenderer.invoke("select-document"),

  convertDocument: (filePath: string) =>
    ipcRenderer.invoke("convert-document", filePath),

  saveWarningStates: (filePath: string, warnings: ParseWarning[]) =>
    ipcRenderer.invoke("save-warning-states", filePath, warnings),

  preparePreview: (html: string) =>
    ipcRenderer.invoke("prepare-preview", html),

  exportArticle: (html: string) =>
    ipcRenderer.invoke("export-article", html),

  openSavedArticleFolder: () =>
    ipcRenderer.invoke("open-saved-article-folder"),
});