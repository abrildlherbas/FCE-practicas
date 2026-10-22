import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

import type { Article } from "../src/converter/models/Article";
import { validateBrandLogo } from "../src/renderer-html/brand-logo";
import { renderArticle } from "../src/renderer-html/renderArticle";

function createArticle(): Article {
  return {
    document: {
      source: "ejemplo.docx",
      format: "docx",
      normalizedFormat: "docx",
    },
    header: {
      title: "Un <artículo> sobre & datos",
      title_en: "A scientific article",
      authors: [
        {
          name: "Ana Pérez",
          affiliations: ["i"],
          orcid: "0000-0000-0000-0001",
        },
      ],
      affiliations: [{ id: "i", text: "Instituto de Estudios" }],
      abstract: "Resumen con contenido importante.",
      abstract_en: "An important abstract.",
      keywords: ["economía", "datos"],
      keywords_en: ["economics", "data"],
      jel_codes: ["Q12"],
      doi: "10.1234/ejemplo",
      dates: {
        received: "01/01/2026",
        accepted: "02/02/2026",
      },
    },
    body: [
      {
        type: "heading",
        level: 1,
        runs: [{ type: "text", text: "Introducción" }],
      },
      {
        type: "paragraph",
        runs: [
          { type: "text", text: "Una afirmación" },
          { type: "noteRef", noteId: 3, noteType: "footnote" },
          { type: "text", text: " y una cita " },
          {
            type: "citation",
            text: "Pérez, 2024",
            referenceId: "revista-ref-1",
            citationId: "revista-cita-1-1",
          },
          { type: "text", text: " con énfasis", italic: true },
        ],
      },
      {
        type: "heading",
        level: 4,
        runs: [{ type: "text", text: "Subsección" }],
      },
      {
        type: "table",
        headers: ["Variable", "Valor"],
        rows: [["Producción", "42"]],
      },
      {
        type: "table",
        headers: [],
        rows: [["Fila", "Dato"]],
      },
      {
        type: "image",
        rId: "rId4",
        fileName: "rId4_figure.png",
      },
    ],
    notes: [
      {
        id: 3,
        type: "footnote",
        text: "Nota de explicación.",
      },
    ],
    references: [
      {
        id: "revista-ref-1",
        raw: "Pérez, A. (2024). Referencia de prueba.",
        authors: ["Pérez, A."],
        year: 2024,
      },
    ],
    warnings: [],
  };
}

function parseHtml(html: string): XmlDocument {
  const xhtmlContent = html.replace(/^<!doctype html>\s*/i, "");
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(xhtmlContent, "application/xml");
}

function elements(
  document: XmlDocument | XmlElement,
  tagName: string
): XmlElement[] {
  return Array.from(document.getElementsByTagName(tagName));
}

function byId(document: XmlDocument, id: string): XmlElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element;
}

describe("renderArticle", () => {
  it("genera estructura semántica, metadatos y jerarquía accesible", () => {
    const html = renderArticle(createArticle());
    const document = parseHtml(html);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html.indexOf('class="article-data"')).toBeLessThan(
      html.indexOf('class="article-body"')
    );
    const headings = elements(document, "h1");

    expect(elements(document, "header")).toHaveLength(2);
    expect(elements(document, "main")).toHaveLength(1);
    expect(elements(document, "article")).toHaveLength(1);
    expect(elements(document, "footer")).toHaveLength(1);
    expect(elements(document, "nav")).toHaveLength(1);
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Un <artículo> sobre & datos");
    expect(
      document.getElementsByTagName("header")[1].textContent
    ).toContain("A scientific article");
    const articleData = elements(document, "section").find(
      (element) => element.getAttribute("class") === "article-data"
    );
    expect(articleData?.textContent).toContain("An important abstract.");
    expect(articleData?.textContent).toContain("Key words: economics; data");
    expect(
      elements(document, "a").some(
        (anchor) => anchor.getAttribute("href") === "#affiliation-i"
      )
    ).toBe(true);
    expect(
      elements(document, "a").some(
        (anchor) =>
          anchor.getAttribute("href") ===
          "https://orcid.org/0000-0000-0000-0001"
      )
    ).toBe(true);
    expect(
      elements(document, "a").some(
        (anchor) =>
          anchor.getAttribute("href") ===
          "https://doi.org/10.1234/ejemplo"
      )
    ).toBe(true);
    expect(elements(document, "title")[0].textContent).toBe(
      "Un <artículo> sobre & datos"
    );
    expect(
      document.getElementsByTagName("style")[0].textContent
    ).toContain("--article-accent");

    const section = elements(document, "section").find(
      (element) => element.getAttribute("class") === "article-body"
    );
    expect(section).toBeDefined();
    const articleHeadingLevels = Array.from(
      section!.getElementsByTagName("*")
    )
      .filter((element) => /^h[2-6]$/.test(element.tagName))
      .map((element) => Number(element.tagName.slice(1)));
    expect(articleHeadingLevels).toEqual([2, 3]);
    expect(
      articleHeadingLevels.every(
        (level, index) => index === 0 || level <= articleHeadingLevels[index - 1] + 1
      )
    ).toBe(true);
    expect(
      document.getElementsByTagName("script")
    ).toHaveLength(0);
  });

  it("enlaza notas en ambas direcciones y les da nombres accesibles", () => {
    const document = parseHtml(renderArticle(createArticle()));
    const reference = byId(document, "note-ref-footnote-3-1-1");
    const note = byId(document, "note-footnote-3");
    const backlink = note.getElementsByTagName("a")[0];

    expect(reference.getAttribute("href")).toBe("#note-footnote-3");
    expect(reference.getAttribute("role")).toBe("doc-noteref");
    expect(reference.getAttribute("aria-label")).toBe(
      "Ir a la nota al pie 3"
    );
    expect(backlink.getAttribute("href")).toBe(
      "#note-ref-footnote-3-1-1"
    );
    expect(backlink.getAttribute("role")).toBe("doc-backlink");
    expect(note.textContent).toContain("Nota de explicación.");
  });

  it("enlaza cada cita con su referencia y genera el enlace de vuelta", () => {
    const document = parseHtml(renderArticle(createArticle()));
    const citation = byId(document, "revista-cita-1-1");
    const reference = byId(document, "revista-ref-1");
    const backlink = reference.getElementsByTagName("a")[0];

    expect(citation.getAttribute("href")).toBe("#revista-ref-1");
    expect(citation.getAttribute("role")).toBe("doc-biblioref");
    expect(reference.textContent).toContain(
      "Pérez, A. (2024). Referencia de prueba."
    );
    expect(backlink.getAttribute("href")).toBe("#revista-cita-1-1");
    expect(backlink.getAttribute("role")).toBe("doc-backlink");
  });

  it("renderiza tablas caption/th scope e imágenes con alt obligatorio", () => {
    const document = parseHtml(renderArticle(createArticle()));
    const tables = elements(document, "table");
    const images = elements(document, "img");

    expect(tables).toHaveLength(2);
    expect(tables[0].getElementsByTagName("caption")[0].textContent).toBe(
      "Tabla 1"
    );
    expect(
      tables[0].getElementsByTagName("th")[0].getAttribute("scope")
    ).toBe("col");
    expect(
      tables[1].getElementsByTagName("th")[0].getAttribute("scope")
    ).toBe("row");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(
      "ejemplo_assets/rId4_figure.png"
    );
    expect(images[0].hasAttribute("alt")).toBe(true);
    expect(images[0].getAttribute("alt")).toBe("");
  });

  it("mantiene el header y footer editoriales fijos entre artículos", () => {
    const first = parseHtml(renderArticle(createArticle()));
    const secondArticle = createArticle();
    secondArticle.header.title = "Otro título";
    secondArticle.notes = [];
    secondArticle.references = [];
    const second = parseHtml(renderArticle(secondArticle));

    expect(elements(first, "header")[0].toString()).toBe(
      elements(second, "header")[0].toString()
    );
    expect(elements(first, "footer")[0].toString()).toBe(
      elements(second, "footer")[0].toString()
    );
    expect(byId(second, "article-notes")).toBeDefined();
    expect(byId(second, "article-references")).toBeDefined();
  });

  it("aplica el color validado y embebe el logo en el HTML exportable", () => {
    const logo = validateBrandLogo(
      "revista.svg",
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    );
    if (!logo.valid) throw new Error(logo.error);

    const html = renderArticle(createArticle(), {
      color: "#123A70",
      logo: logo.logo,
      magazineName: "Revista de prueba",
    });
    const document = parseHtml(html);
    const logoDataUri = logo.logo.dataUri;

    expect(html).toContain(`--revista-color: #123A70;`);
    expect(html).toContain(`--revista-logo-url: url("${logoDataUri}");`);
    expect(html).not.toContain('background-image: url("revista.svg")');
    const logos = elements(document, "div").filter(
      (element) => element.getAttribute("class") === "revista-logo"
    );
    expect(logos).toHaveLength(2);
    expect(logos.map((element) => element.getAttribute("role"))).toEqual([
      "img",
      "img",
    ]);
    expect(logos[0].getAttribute("aria-label")).toBe(
      "Logo de Revista de prueba"
    );
  });

  it("rechaza un color de marca que no cumple el contraste", () => {
    expect(() =>
      renderArticle(createArticle(), { color: "#FFFF00" })
    ).toThrow(
      "Este color es muy claro y dificulta la lectura. Probá uno más oscuro."
    );
  });
});
