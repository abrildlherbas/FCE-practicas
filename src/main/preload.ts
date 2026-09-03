import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDocument: () =>
    ipcRenderer.invoke("select-document"),

  convertDocument: (filePath: string) =>
    ipcRenderer.invoke("convert-document", filePath),
});