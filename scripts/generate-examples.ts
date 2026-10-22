import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

import { DocxParser } from "../src/converter/docx/parser";
import type { BodyBlock } from "../src/converter/models/Article";
import { renderArticle } from "../src/renderer-html/renderArticle";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = path.join(
  repositoryRoot,
  "tests",
  "fixtures",
  "Carbonel_Cielo.docx"
);
const outputDirectory = path.join(repositoryRoot, "examples");

const examples = [
  { fileName: "ejemplo-revista-a.html", color: "#123A70" },
  { fileName: "ejemplo-revista-b.html", color: "#D94635" },
];

async function copyExtractedImages(
  body: BodyBlock[],
  sourceAssetsDirectory: string
): Promise<void> {
  const outputAssetsDirectory = path.join(
    outputDirectory,
    "Carbonel_Cielo_assets"
  );
  await fs.mkdir(outputAssetsDirectory, { recursive: true });
  for (const block of body) {
    if (block.type !== "image") continue;

    const fileName = path.basename(block.fileName);
    await fs.copyFile(
      path.join(sourceAssetsDirectory, fileName),
      path.join(outputAssetsDirectory, fileName)
    );
  }
}

async function main(): Promise<void> {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "revista-examples-")
  );
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(fixturePath));
    const sourcePath = path.join(
      temporaryDirectory,
      "source",
      "Carbonel_Cielo.docx"
    );
    const article = await new DocxParser().parse(zip, sourcePath);
    const assetsDirectory = path.join(
      path.dirname(sourcePath),
      "Carbonel_Cielo_assets"
    );
    await fs.mkdir(outputDirectory, { recursive: true });
    await copyExtractedImages(article.body, assetsDirectory);

    for (const example of examples) {
      const html = renderArticle(article, { color: example.color });
      await fs.writeFile(
        path.join(outputDirectory, example.fileName),
        html,
        "utf8"
      );
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("No se pudieron generar los ejemplos HTML:", error);
  process.exitCode = 1;
});
