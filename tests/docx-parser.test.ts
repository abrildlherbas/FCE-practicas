import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { DocxParser } from "../src/converter/docx/parser";
import { renderArticle } from "../src/renderer-html/renderArticle";

const fixturePath = fileURLToPath(
  new URL("./fixtures/warnings-example.docx", import.meta.url)
);

describe("DocxParser", () => {
  it("preserva los espacios de w:t con xml:space=\"preserve\"", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">  texto </w:t><w:t>continuado</w:t></w:r></w:p></w:body></w:document>'
    );

    const article = await new DocxParser().parse(zip, "spaces.docx");
    const contentParagraph = article.body[1];
    if (!contentParagraph || !("runs" in contentParagraph)) {
      throw new Error("No se encontró el párrafo de contenido.");
    }
    const bodyText = contentParagraph.runs
      .filter((run) => run.type === "text")
      .map((run) => run.text)
      .join("");

    expect(bodyText).toBe("  texto continuado");
  });

  it("convierte los elementos de control de runs a texto en orden", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:noBreakHyphen/><w:t>D</w:t><w:softHyphen/><w:t>E</w:t></w:r></w:p></w:body></w:document>'
    );

    const article = await new DocxParser().parse(zip, "controls.docx");
    const contentParagraph = article.body[1];
    if (!contentParagraph || !("runs" in contentParagraph)) {
      throw new Error("No se encontró el párrafo de contenido.");
    }
    const bodyText = contentParagraph.runs
      .filter((run) => run.type === "text")
      .map((run) => run.text)
      .join("");

    expect(bodyText).toBe("A B\nC-DE");
  });

  it("preserva runs cuyo contenido es únicamente numérico", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:p><w:r><w:t>14</w:t></w:r><w:r><w:t>/</w:t></w:r><w:r><w:t>03</w:t></w:r><w:r><w:t>/</w:t></w:r><w:r><w:t>2026</w:t></w:r></w:p></w:body></w:document>'
    );

    const article = await new DocxParser().parse(zip, "numeric-runs.docx");
    const contentParagraph = article.body[1];
    if (!contentParagraph || !("runs" in contentParagraph)) {
      throw new Error("No se encontró el párrafo de contenido.");
    }
    const bodyText = contentParagraph.runs
      .filter((run) => run.type === "text")
      .map((run) => run.text)
      .join("");

    expect(bodyText).toBe("14/03/2026");
  });

  it("parsea el DOCX de ejemplo y coincide con el snapshot JSON", async () => {
    const fixture = await fs.readFile(fixturePath);
    const zip = await JSZip.loadAsync(fixture);
    const article = await new DocxParser().parse(zip, fixturePath);

    expect(article.header).toMatchObject({
      title: "Título de ejemplo",
      authors: [{ name: "Ana Pérez", affiliations: [] }],
      affiliations: [
        { id: "i", text: "Instituto de Investigación" },
      ],
      abstract: "Un resumen del artículo de prueba.",
      keywords: ["economía", "producción"],
      keywords_en: [],
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

  it("asocia warnings con el bloque correspondiente y conserva el estado resuelto", async () => {
    const zip = await JSZip.loadAsync(await fs.readFile(fixturePath));
    const parser = new DocxParser();
    const article = await parser.parse(zip, fixturePath);
    const warning = article.warnings.find(
      ({ code, message, blockId }) =>
        code === "short-paragraph-cluster" &&
        message.includes("Texto: y") &&
        blockId !== undefined
    );

    expect(warning?.status).toBe("pendiente");
    expect(warning?.blockId).toBe("b-3");
    expect(warning).toMatchObject({
      start: 0,
      end: 1,
      affectedText: "y",
    });
    expect(article.body[3]).toMatchObject({
      type: "paragraph",
      runs: [{ type: "text", text: "y" }],
    });

    const rendered = renderArticle(article);
    const document = new JSDOM(rendered).window.document;
    expect(
      document.querySelector(`[data-bloque-id="${warning?.blockId}"]`)
        ?.textContent
    ).toContain("y");

    const regenerated = await parser.parse(zip, fixturePath, [
      { ...warning!, status: "resuelto" },
    ]);
    const regeneratedWarning = regenerated.warnings.find(
        ({ code, message, blockId }) =>
          code === warning?.code &&
          message === warning.message &&
          blockId === warning.blockId
      );
    expect(regeneratedWarning).toMatchObject({
      id: warning?.id,
      ordinal: warning?.ordinal,
      status: "resuelto",
    });
    expect(
      regenerated.warnings.find(
        (candidate) => candidate.id !== warning?.id
      )?.status
    ).toBe("pendiente");
  });

  it("conserva los metadatos bilingües, ORCID y afiliaciones del artículo real", async () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/Carbonel_Cielo.docx", import.meta.url)
    );
    const zip = await JSZip.loadAsync(await fs.readFile(fixture));
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "carbonel-header-")
    );

    try {
      const article = await new DocxParser().parse(
        zip,
        path.join(temporaryDirectory, "Carbonel_Cielo.docx")
      );

      expect(article.header.title_en).toContain(
        "Technological Intensification and Economic Efficiency"
      );
      expect(article.header.abstract_en).toContain(
        "Differential technology adoption in livestock systems"
      );
      expect(article.header.keywords_en).toEqual([
        "Beef cattle",
        "technological intensification",
        "productive and economic gap",
      ]);
      expect(article.header.authors).toContainEqual({
        name: "Carlos Torres Carbonelli",
        affiliations: ["iii"],
        orcid: "0000-0002-2978-4326",
      });
      expect(article.header.affiliations.map(({ id }) => id)).toEqual([
        "i",
        "ii",
        "iii",
      ]);
      expect(article.references).toHaveLength(33);
      expect(
        article.references.map(({ id }) => id)
      ).toEqual(
        Array.from({ length: 33 }, (_, index) => `revista-ref-${index + 1}`)
      );
      expect(new Set(article.references.map(({ id }) => id)).size).toBe(33);
      expect(
        article.references.every((reference) =>
          Object.keys(reference).every((key) =>
            ["id", "raw", "authors", "year"].includes(key)
          )
        )
      ).toBe(true);
      expect(article.references.at(-1)?.raw).toContain(
        "Pasture chemoscapes and their ecological services"
      );
      const citations = article.body.flatMap((block) =>
        "runs" in block
          ? block.runs.filter((run) => run.type === "citation")
          : []
      );
      expect(citations.length).toBeGreaterThan(0);
      expect(
        citations.every((citation) =>
          article.references.some(
            (reference) => reference.id === citation.referenceId
          )
        )
      ).toBe(true);
      expect(
        new Set(citations.map((citation) => citation.citationId)).size
      ).toBe(citations.length);
      const rendered = new JSDOM(renderArticle(article)).window.document;
      for (const citation of citations) {
        expect(rendered.getElementById(citation.citationId)).not.toBeNull();
        expect(
          rendered.querySelector(
            `#${citation.referenceId} a[href="#${citation.citationId}"]`
          )
        ).not.toBeNull();
      }
      expect(
        article.body.some(
          (block) =>
            "runs" in block &&
            block.runs.some(
              (run) =>
                run.type === "text" &&
                run.text.includes(
                  "Pasture chemoscapes and their ecological services"
                )
            )
        )
      ).toBe(false);
      expect(
        article.warnings.some((warning) => warning.code === "uncited-reference")
      ).toBe(true);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("recorre controles de contenido y tablas en orden documental", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:sdt><w:sdtContent><w:p><w:r><w:t>Antes de la tabla</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Después de la tabla</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>'
    );

    const article = await new DocxParser().parse(zip, "content-control.docx");

    expect(article.body.map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
      "table",
      "paragraph",
    ]);
    expect(article.body[1]).toMatchObject({
      runs: [{ type: "text", text: "Antes de la tabla" }],
    });
    expect(article.body[2]).toMatchObject({
      type: "table",
      rows: [["Celda"]],
    });
    expect(article.body[3]).toMatchObject({
      runs: [{ type: "text", text: "Después de la tabla" }],
    });
    expect(
      article.warnings.some(({ code }) => code === "unclassified-element")
    ).toBe(false);
  });

  it("incluye el texto no ubicado de elementos no reconocidos en warnings", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Introducción</w:t></w:r></w:p><w:customXml><w:p><w:r><w:t>Texto que no se pudo ubicar</w:t></w:r></w:p></w:customXml></w:body></w:document>'
    );

    const article = await new DocxParser().parse(zip, "unknown-content.docx");

    expect(article.warnings).toContainEqual(
      expect.objectContaining({
        code: "unclassified-element",
        message: expect.stringContaining("Texto que no se pudo ubicar"),
      })
    );
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
    const noteParagraph = article.body[1];
    expect(
      noteParagraph && "runs" in noteParagraph ? noteParagraph.runs : []
    ).toContainEqual({
      type: "noteRef",
      noteId: 1,
      noteType: "footnote",
    });
    expect(article.references).toEqual([
      {
        id: "revista-ref-1",
        raw: "García, A. (2020). Estudio de ejemplo. DOI: 10.1234/demo.",
        authors: ["García, A."],
        year: 2020,
      },
    ]);
    expect(
      article.body.some((block) =>
        "runs" in block && block.runs.some(
          (run) =>
            run.type === "text" &&
            run.text.includes("Estudio de ejemplo")
        )
      )
    ).toBe(false);
  });
});
