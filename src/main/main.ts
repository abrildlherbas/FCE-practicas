import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

import { DocxReader } from "../converter/docx/reader";
import { DocxParser } from "../converter/docx/parser";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )
    );
  }
}

ipcMain.handle("select-document", async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Documentos Word",
        extensions: ["doc", "docx"],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle(
  "convert-document",
  async (_event, filePath: string) => {
    const extension = path.extname(filePath).toLowerCase();

    if (extension !== ".docx") {
      throw new Error(
        "Por ahora el prototipo solo procesa archivos .docx."
      );
    }

    const reader = new DocxReader();
    const parser = new DocxParser();

    const zip = await reader.open(filePath);

    return parser.parse(zip, filePath);
  }
);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});