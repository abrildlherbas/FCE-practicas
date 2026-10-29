import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadArticleEditState,
  saveArticleEditState,
  writeArticleWithBackup,
} from "../src/main/article-storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "article-edits-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("persistencia de ediciones y borradores", () => {
  it("guarda los cambios por bloque y el borrador asociado al documento", async () => {
    const directory = await createTemporaryDirectory();
    const sourcePath = path.join(directory, "articulo.docx");
    const state = {
      edits: [
        {
          blockId: "b-0",
          originalHtml: '<p data-bloque-id="b-0">Base</p>',
          html: '<p data-bloque-id="b-0">Editado</p>',
        },
      ],
      draftHtml: "<html>edici├│n en curso</html>",
      draftBaseHtml: "<html>art├¡culo original</html>",
    };

    await saveArticleEditState(path.join(directory, "state"), sourcePath, state);

    await expect(
      loadArticleEditState(path.join(directory, "state"), sourcePath)
    ).resolves.toEqual(state);
  });

  it("crea una copia de seguridad antes de reemplazar un art├¡culo existente", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = path.join(directory, "articulo.html");
    await fs.writeFile(targetPath, "<html>versi├│n anterior</html>", "utf8");

    const backupPath = await writeArticleWithBackup(
      targetPath,
      "<html>versi├│n nueva</html>"
    );

    expect(backupPath).not.toBeNull();
    await expect(fs.readFile(backupPath!, "utf8")).resolves.toBe(
      "<html>versi├│n anterior</html>"
    );
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(
      "<html>versi├│n nueva</html>"
    );
  });

  it("no crea una copia de seguridad si todav├¡a no existe el art├¡culo", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = path.join(directory, "articulo.html");

    await expect(
      writeArticleWithBackup(targetPath, "<html>nuevo</html>")
    ).resolves.toBeNull();
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(
      "<html>nuevo</html>"
    );
  });
});
