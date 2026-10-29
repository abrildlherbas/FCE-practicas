import { contextBridge, ipcRenderer } from "electron";
import type { ParseWarning } from "../converter/models/Article";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDocument: () =>
    ipcRenderer.invoke("select-document"),

  convertDocument: (filePath: string) =>
    ipcRenderer.invoke("convert-document", filePath),

  saveWarningStates: (filePath: string, warnings: ParseWarning[]) =>
    ipcRenderer.invoke("save-warning-states", filePath, warnings),

  preparePreview: (html: string, filePath?: string) =>
    ipcRenderer.invoke("prepare-preview", html, filePath),

  activateDocument: (filePath: string) =>
    ipcRenderer.invoke("activate-document", filePath),

  loadArticleEditState: (filePath: string) =>
    ipcRenderer.invoke("load-article-edit-state", filePath),

  saveArticleEditState: (filePath: string, state: unknown) =>
    ipcRenderer.invoke("save-article-edit-state", filePath, state),

  setEditorDraftStatus: (dirty: boolean) =>
    ipcRenderer.send("editor-draft-status", dirty),

  exportArticle: (html: string) =>
    ipcRenderer.invoke("export-article", html),

  openSavedArticleFolder: () =>
    ipcRenderer.invoke("open-saved-article-folder"),
});