import fs from "node:fs/promises";
import JSZip from "jszip";

export class DocxReader {
  async open(filePath: string): Promise<JSZip> {
    const buffer = await fs.readFile(filePath);

    return JSZip.loadAsync(buffer);
  }

  async readFile(
    zip: JSZip,
    path: string
  ): Promise<string | null> {
    const file = zip.file(path);

    if (!file) {
      return null;
    }

    return file.async("text");
  }

  exists(zip: JSZip, path: string): boolean {
    return zip.file(path) !== null;
  }
}