import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { DocxParser } from "../src/converter/docx/parser";

const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

function createDocumentXml(): string {
  return `<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>
    <w:p><w:r><w:t>Título del estudio</w:t></w:r></w:p>
    <w:p><w:r><w:t>Introducción</w:t></w:r></w:p>
    <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Columna A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Columna B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Dato 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Dato 2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>Texto anterior a la imagen</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen" descr="Gráfico de ejemplo"/><a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Sin encabezado</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>Texto posterior a la imagen</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body></w:document>`;
}

describe("DocxParser: tablas e imágenes", () => {
  it("conserva el orden, extrae tablas e imágenes y escribe el binario junto al DOCX", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "docx-blocks-")
    );
    tempDirectories.push(directory);
    const sourcePath = path.join(directory, "articulo.docx");
    const zip = new JSZip();

    zip.file("word/document.xml", createDocumentXml());
    zip.file(
      "word/_rels/document.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/></Relationships>`
    );
    zip.file("word/media/chart.png", Buffer.from([1, 2, 3, 4]));

    const article = await new DocxParser().parse(zip, sourcePath);

    expect(
      article.body.map((block) => block.type)
    ).toEqual([
      "paragraph",
      "table",
      "paragraph",
      "image",
      "table",
      "paragraph",
    ]);
    expect(article.body[1]).toEqual({
      type: "table",
      headers: ["Columna A", "Columna B"],
      rows: [["Dato 1", "Dato 2"]],
    });
    expect(article.body[3]).toEqual({
      type: "image",
      rId: "rId1",
      fileName: "rId1_chart.png",
      alt: "Gráfico de ejemplo",
    });
    expect(article.body[4]).toEqual({
      type: "table",
      headers: [],
      rows: [["Sin encabezado"]],
    });
    expect(article.warnings).not.toContainEqual(
      expect.objectContaining({ code: "unclassified-element" })
    );
    expect(
      article.warnings.some((warning) => warning.code === "image-missing-alt")
    ).toBe(false);
    expect(
      await fs.readFile(
        path.join(directory, "articulo_assets", "rId1_chart.png")
      )
    ).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("advierte cuando una imagen no tiene texto alternativo", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "docx-image-alt-")
    );
    tempDirectories.push(directory);
    const zip = new JSZip();
    const documentXml = createDocumentXml().replace(
      'descr="Gráfico de ejemplo"',
      'descr=""'
    );
    zip.file("word/document.xml", documentXml);
    zip.file(
      "word/_rels/document.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/></Relationships>`
    );
    zip.file("word/media/chart.png", Buffer.from([1]));

    const article = await new DocxParser().parse(
      zip,
      path.join(directory, "articulo.docx")
    );

    expect(article.warnings).toContainEqual(
      expect.objectContaining({
        code: "image-missing-alt",
        blockIndex: 4,
      })
    );
  });
});
