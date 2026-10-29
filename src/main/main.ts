import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { DocxReader } from "../converter/docx/reader";
import { DocxParser } from "../converter/docx/parser";
import type { ParseWarning } from "../converter/models/Article";
import {
  persistWarningStates,
  readWarningStates,
} from "./warning-state-storage";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let selectedDocumentPath: string | null = null;
let savedArticlePath: string | null = null;

function imageMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const types: Record<string, string> = {
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
  };

  return types[extension] ?? "application/octet-stream";
}

async function inlineArticleImages(html: string): Promise<string> {
  if (!selectedDocumentPath) {
    throw new Error("No hay un documento abierto para preparar.");
  }

  const assetDirectoryName =
    `${path.parse(selectedDocumentPath).name}_assets`;
  const imagePaths = Array.from(
    html.matchAll(/src="([^"]+)"/g),
    (match) => match[1]
  ).filter((source) => source.startsWith(`${assetDirectoryName}/`));
  let preparedHtml = html;

  for (const imagePath of new Set(imagePaths)) {
    const fileName = imagePath.slice(assetDirectoryName.length + 1);
    if (!fileName || path.basename(fileName) !== fileName) {
      throw new Error("La ruta de una imagen del artículo no es válida.");
    }

    const imageBuffer = await fs.readFile(
      path.join(
        path.dirname(selectedDocumentPath),
        assetDirectoryName,
        fileName
      )
    );
    const dataUrl = `data:${imageMimeType(fileName)};base64,${imageBuffer.toString(
      "base64"
    )}`;
    preparedHtml = preparedHtml.replaceAll(
      `src="${imagePath}"`,
      `src="${dataUrl}"`
    );
  }

  return preparedHtml;
}

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
        name: "Documento Word",
        extensions: ["docx"],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  selectedDocumentPath = result.filePaths[0];
  savedArticlePath = null;
  return selectedDocumentPath;
});

ipcMain.handle(
  "convert-document",
  async (_event, filePath: unknown) => {
    if (
      typeof filePath !== "string" ||
      !selectedDocumentPath ||
      path.resolve(filePath) !== path.resolve(selectedDocumentPath)
    ) {
      throw new Error("El documento seleccionado ya no está disponible.");
    }

    const extension = path.extname(filePath).toLowerCase();

    if (extension !== ".docx") {
      throw new Error(
        "Por ahora el prototipo solo procesa archivos .docx."
      );
    }

    const reader = new DocxReader();
    const parser = new DocxParser();

    const zip = await reader.open(filePath);

    const warningStates = await readWarningStates(filePath);
    const article = await parser.parse(zip, filePath, warningStates);
    await persistWarningStates(filePath, article.warnings);
    return article;
  }
);

ipcMain.handle(
  "save-warning-states",
  async (_event, filePath: unknown, warningValues: unknown) => {
    if (
      typeof filePath !== "string" ||
      !selectedDocumentPath ||
      path.resolve(filePath) !== path.resolve(selectedDocumentPath)
    ) {
      throw new Error("El documento seleccionado ya no está disponible.");
    }
    if (!Array.isArray(warningValues)) {
      throw new Error("No se pudieron guardar los estados de los errores.");
    }

    const warnings = warningValues.filter(
      (warning): warning is ParseWarning =>
        typeof warning === "object" &&
        warning !== null &&
        "id" in warning &&
        typeof warning.id === "string" &&
        "ordinal" in warning &&
        typeof warning.ordinal === "number" &&
        Number.isInteger(warning.ordinal) &&
        "status" in warning &&
        (warning.status === "pendiente" ||
          warning.status === "resuelto") &&
        "code" in warning &&
        typeof warning.code === "string" &&
        "message" in warning &&
        typeof warning.message === "string"
    );
    if (warnings.length !== warningValues.length) {
      throw new Error("No se pudieron guardar los estados de los errores.");
    }
    await persistWarningStates(filePath, warnings);
  }
);

ipcMain.handle("prepare-preview", async (_event, html: unknown) => {
  if (typeof html !== "string") {
    throw new Error("No se pudo preparar la vista del artículo.");
  }

  return inlineArticleImages(html);
});

ipcMain.handle("export-article", async (_event, html: unknown) => {
  if (!mainWindow || !selectedDocumentPath) {
    throw new Error("Elige primero un documento Word.");
  }
  if (typeof html !== "string") {
    throw new Error("No se pudo preparar el artículo para guardarlo.");
  }

  const source = path.parse(selectedDocumentPath);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Guardar artículo",
    defaultPath: path.join(source.dir, `${source.name}.html`),
    buttonLabel: "Guardar artículo",
    filters: [
      {
        name: "Artículo",
        extensions: ["html"],
      },
    ],
  });

  if (result.canceled || !result.filePath) return null;

  const htmlWithImages = await inlineArticleImages(html);
  await fs.writeFile(result.filePath, htmlWithImages, "utf8");
  savedArticlePath = result.filePath;
  return result.filePath;
});

ipcMain.handle("open-saved-article-folder", async () => {
  if (!savedArticlePath) {
    throw new Error("Guarda el artículo antes de abrir su carpeta.");
  }

  await fs.access(savedArticlePath);
  shell.showItemInFolder(savedArticlePath);
});

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