import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DocxParser } from "../src/converter/docx/parser";

const fixturePath = fileURLToPath(
  new URL("./fixtures/warnings-example.docx", import.meta.url)
);

describe("DocxParser", () => {
  it("parsea el DOCX de ejemplo y coincide con el snapshot JSON", async () => {
    const fixture = await fs.readFile(fixturePath);
    const zip = await JSZip.loadAsync(fixture);
    const article = await new DocxParser().parse(zip, fixturePath);

    expect(article.header).toMatchObject({
      title: "Título de ejemplo",
      authors: ["Ana Pérez"],
      affiliations: ["Instituto de Investigación"],
      abstract: "Un resumen del artículo de prueba.",
      keywords: ["economía", "producción"],
      jel_codes: ["Q12", "Q18"],
      dates: {
        received: "14/03/2026",
        accepted: "22/05/2026",
        published: "30/06/2026",
      },
    });
    expect(
      article.body.some((block) =>
        "runs" in block && block.runs.some(
          (run) =>
            run.type === "text" &&
            run.text.includes("Título de ejemplo")
        )
      )
    ).toBe(false);
    expect(article).toMatchSnapshot();
  });

  it("usa notas OOXML nativas y extrae referencias estructuradas", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:r><w:t>Una afirmación</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:r><w:t>Referencias</w:t></w:r></w:p><w:p><w:r><w:t>García, A. (2020). Estudio de ejemplo. DOI: 10.1234/demo.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
    );
    zip.file(
      "word/footnotes.xml",
      '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Nota nativa</w:t></w:r></w:p></w:footnote></w:footnotes>'
    );
    zip.file("word/styles.xml", "<w:styles/>");

    const article = await new DocxParser().parse(
      zip,
      "native-notes.docx"
    );

    expect(article.notes).toEqual([
      { id: 1, type: "footnote", text: "Nota nativa" },
    ]);
    expect(article.body[1]?.runs).toContainEqual({
      type: "noteRef",
      noteId: 1,
      noteType: "footnote",
    });
    expect(article.references).toEqual([
      {
        raw: "García, A. (2020). Estudio de ejemplo. DOI: 10.1234/demo.",
        authors: ["García, A."],
        year: 2020,
        doi: "10.1234/demo",
      },
    ]);
    expect(
      article.body.some((block) =>
        block.runs.some(
          (run) =>
            run.type === "text" &&
            run.text.includes("Estudio de ejemplo")
        )
      )
    ).toBe(false);
  });
});
