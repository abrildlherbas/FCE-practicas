import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ParseWarning } from "../src/converter/models/Article";
import { warningIdentity } from "../src/converter/warningIdentity";
import {
  persistWarningStates,
  readWarningStates,
} from "../src/main/warning-state-storage";

const temporaryDirectories: string[] = [];

async function sourceFilePath(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "warning-state-test-")
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "articulo.docx");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

function warning(
  text: string,
  ordinal: number,
  status: ParseWarning["status"]
): ParseWarning {
  const warning: ParseWarning = {
    code: "short-paragraph-cluster",
    message: `Revisar: ${text}`,
    blockId: "b-4",
    affectedText: text,
    ordinal,
    status,
  };
  warning.id = warningIdentity(warning);
  return warning;
}

describe("persistencia de estados de errores", () => {
  it("reconcilia regeneraciones por code, bloque y hash del texto", async () => {
    const sourcePath = await sourceFilePath();
    const resolved = warning("texto original", 8, "resuelto");
    const newWarning = warning("nuevo fragmento", 9, "pendiente");

    await persistWarningStates(sourcePath, [resolved]);
    await persistWarningStates(sourcePath, [newWarning]);

    expect(await readWarningStates(sourcePath)).toEqual([
      {
        id: resolved.id,
        ordinal: 8,
        status: "resuelto",
      },
      {
        id: newWarning.id,
        ordinal: 9,
        status: "pendiente",
      },
    ]);
    expect(warningIdentity(warning("texto original", 99, "pendiente"))).toBe(
      resolved.id
    );
    expect(warningIdentity(warning("texto editado", 99, "pendiente"))).not.toBe(
      resolved.id
    );
  });

  it("persiste la reapertura sin cambiar el número asignado", async () => {
    const sourcePath = await sourceFilePath();
    const reopened = warning("fragmento", 12, "pendiente");

    await persistWarningStates(sourcePath, [
      { ...reopened, status: "resuelto" },
    ]);
    await persistWarningStates(sourcePath, [reopened]);

    expect(await readWarningStates(sourcePath)).toEqual([
      {
        id: reopened.id,
        ordinal: 12,
        status: "pendiente",
      },
    ]);
  });
});
