import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class DocConverter {
  async toDocx(
    inputPath: string
  ): Promise<string> {
    const outputDirectory =
      await fs.mkdtemp(
        path.join(
          process.env.TEMP ?? "/tmp",
          "article-converter-"
        )
      );

    await execFileAsync(
      "libreoffice",
      [
        "--headless",
        "--convert-to",
        "docx",
        "--outdir",
        outputDirectory,
        inputPath,
      ]
    );

    const inputName =
      path.basename(
        inputPath,
        path.extname(inputPath)
      );

    const outputPath = path.join(
      outputDirectory,
      `${inputName}.docx`
    );

    try {
      await fs.access(outputPath);
    } catch {
      throw new Error(
        "LibreOffice no pudo convertir el archivo .doc a .docx"
      );
    }

    return outputPath;
  }
}