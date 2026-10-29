import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { ManualBlockEdit } from "../renderer-html/block-edits";

export interface ArticleEditState {
  edits: ManualBlockEdit[];
  draftHtml: string | null;
  draftBaseHtml?: string | null;
}

const EMPTY_STATE: ArticleEditState = {
  edits: [],
  draftHtml: null,
  draftBaseHtml: null,
};

function storageFilePath(directory: string, sourcePath: string): string {
  const key = createHash("sha256")
    .update(path.resolve(sourcePath).toLowerCase())
    .digest("hex");
  return path.join(directory, `${key}.json`);
}

function isManualBlockEdit(value: unknown): value is ManualBlockEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as Record<string, unknown>;
  return (
    typeof edit.blockId === "string" &&
    typeof edit.originalHtml === "string" &&
    typeof edit.html === "string"
  );
}

function parseState(value: unknown): ArticleEditState {
  if (!value || typeof value !== "object") return EMPTY_STATE;
  const state = value as Record<string, unknown>;
  return {
    edits: Array.isArray(state.edits)
      ? state.edits.filter(isManualBlockEdit)
      : [],
    draftHtml: typeof state.draftHtml === "string" ? state.draftHtml : null,
    draftBaseHtml:
      typeof state.draftBaseHtml === "string" ? state.draftBaseHtml : null,
  };
}

export async function loadArticleEditState(
  directory: string,
  sourcePath: string
): Promise<ArticleEditState> {
  try {
    const content = await fs.readFile(storageFilePath(directory, sourcePath), "utf8");
    return parseState(JSON.parse(content) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...EMPTY_STATE };
    }
    throw error;
  }
}

export async function saveArticleEditState(
  directory: string,
  sourcePath: string,
  state: ArticleEditState
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const targetPath = storageFilePath(directory, sourcePath);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state), "utf8");
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function backupBeforeOverwrite(
  targetPath: string
): Promise<string | null> {
  try {
    await fs.access(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const backupPath = `${targetPath}.${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.${randomUUID()}.bak`;
  await fs.copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
  return backupPath;
}

export async function writeArticleWithBackup(
  targetPath: string,
  html: string
): Promise<string | null> {
  const backupPath = await backupBeforeOverwrite(targetPath);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, html, "utf8");
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return backupPath;
}
