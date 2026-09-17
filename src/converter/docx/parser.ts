import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import {
  Article,
  BodyBlock,
  Note,
  InlineRun
} from "../models/Article";

interface RawParagraph {
  xml: any;
  runs: InlineRun[];
  text: string;
  headingLevel: number | null;
}

interface ParsedStructure {
  header: Article["header"];
  body: BodyBlock[];
}

export class DocxParser {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    preserveOrder: true,
  });

  async parse(
    zip: JSZip,
    sourcePath: string
  ): Promise<Article> {
    const documentXml = await this.readRequired(
      zip,
      "word/document.xml"
    );

    const footnotesXml = await this.readOptional(
      zip,
      "word/footnotes.xml"
    );

    const endnotesXml = await this.readOptional(
      zip,
      "word/endnotes.xml"
    );

    const document = this.xmlParser.parse(
      documentXml
    );

    const footnotes = footnotesXml
      ? this.parseNotes(
          footnotesXml,
          "footnote"
        )
      : [];

    const endnotes = endnotesXml
      ? this.parseNotes(
          endnotesXml,
          "endnote"
        )
      : [];

    const structure =
      this.parseDocumentStructure(
        document
      );

    this.attachNoteAnchors(
      structure.body,
      [...footnotes, ...endnotes]
    );

    return {
      document: {
        source: path.basename(sourcePath),
        format: "docx",
        normalizedFormat: "docx",
      },

      header: structure.header,

      body: structure.body,

      notes: [
        ...footnotes,
        ...endnotes,
      ],

      references: [],
    };
  }

  private parseDocumentStructure(
  document: any
): ParsedStructure {
  const body = this.findElement(
    document,
    "w:body"
  );

  if (!body) {
    return {
      header: {
        authors: [],
        keywords: [],
        jel_codes: [],
        dates: {},
      },
      body: [],
    };
  }

  const rawParagraphs =
    this.extractBodyParagraphs(body);

  const normalizedParagraphs =
    this.normalizeBlocks(rawParagraphs);

  const header =
    this.extractHeader(normalizedParagraphs);

  const bodyBlocks =
    this.extractMainBody(normalizedParagraphs);

  return {
    header,
    body: bodyBlocks,
  };
  }

  private async readRequired(
    zip: JSZip,
    filePath: string
  ): Promise<string> {
    const file = zip.file(filePath);

    if (!file) {
      throw new Error(
        `El archivo DOCX no contiene ${filePath}`
      );
    }

    return file.async("text");
  }

  private async readOptional(
    zip: JSZip,
    filePath: string
  ): Promise<string | null> {
    const file = zip.file(filePath);

    if (!file) {
      return null;
    }

    return file.async("text");
  }

  private extractBodyParagraphs(
    body: any
  ): RawParagraph[] {
    const paragraphElements =
      this.findDirectChildren(body, "w:p");

    return paragraphElements.map(
      (paragraph): RawParagraph => {
        const runs = this.parseRuns(paragraph);

        return {
          xml: paragraph,
          runs,
          text: this.extractParagraphText(paragraph),
          headingLevel: this.getHeadingLevel(paragraph),
        };
      }
    );
  }

  private normalizeBlocks(
    paragraphs: RawParagraph[]
  ): RawParagraph[] {
    return paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: this.normalizeRuns(paragraph.runs),
    }));
  }

  private normalizeRuns(
    runs: InlineRun[]
  ): InlineRun[] {
    const normalized: InlineRun[] = [];

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];

      if (run.type !== "text") {
        normalized.push(run);
        continue;
      }

      const previous = normalized[normalized.length - 1];

      if (
        !previous ||
        previous.type !== "text" ||
        previous.bold !== run.bold ||
        previous.italic !== run.italic
      ) {
        normalized.push({
          ...run,
        });

        continue;
      }

      const separator = this.getRunSeparator(
        previous.text,
        run.text,
        runs[i + 1]
      );

      previous.text += separator + run.text;
    }

    return normalized;
  }

  private getRunSeparator(
    previousText: string,
    currentText: string,
    nextRun?: InlineRun
  ): string {
    const previous = previousText.trimEnd();
    const current = currentText.trimStart();

    if (!previous || !current) {
      return "";
    }

    // Si el XML ya conserva un espacio explícito, respetarlo.
    if (
      previousText.endsWith(" ") ||
      currentText.startsWith(" ")
    ) {
      return "";
    }

    // Puntuación que no necesita espacio delante.
    if (/^[.,;:!?%)\]}]/.test(current)) {
      return "";
    }

    // Después de signos de apertura no agregamos espacio.
    if (/[([{]$/.test(previous)) {
      return "";
    }

    // Palabras/números partidos en un punto de ejecución.
    if (
      /\d$/.test(previous) &&
      /^\d/.test(current)
    ) {
      return "";
    }

    /*
    * Fragmentos de una sola letra:
    *
    * hospitalari + a
    * Código + s
    * o + f healthcare
    * L + a literatura
    *
    * En estos documentos suelen ser cortes internos
    * de una palabra.
    */
    const previousWord =
      previous.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/)?.[0] ?? "";

    const currentWord =
      current.match(/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/)?.[0] ?? "";

    if (
      previousWord.length === 1 ||
      currentWord.length === 1
    ) {
      return "";
    }

    // Dos fragmentos de palabras normales:
    // "Universitat" + "de"
    // "design" + "is used"
    // "Conclusions..." + "impacts"
    if (
      /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ)]$/.test(previous) &&
      /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(current)
    ) {
      return " ";
    }

    return "";
  }

  private buildBodyBlocks(
    paragraphs: RawParagraph[]
  ): BodyBlock[] {
    const bodyBlocks: BodyBlock[] = [];

    for (const paragraph of paragraphs) {
      const hasContent = paragraph.runs.some(
        (run) =>
          run.type === "noteRef" ||
          (run.type === "text" && run.text.trim())
      );

      if (!hasContent) {
        continue;
      }

      if (paragraph.headingLevel !== null) {
        bodyBlocks.push({
          type: "heading",
          level: paragraph.headingLevel,
          runs: paragraph.runs,
        });

        continue;
      }

      bodyBlocks.push({
        type: "paragraph",
        runs: paragraph.runs,
      });
    }

    return bodyBlocks;
  }

  private parseRuns(paragraph: any): InlineRun[] {
    const runElements = this.findElements(paragraph, "w:r");
    const result: InlineRun[] = [];

    for (const run of runElements) {
      const footnoteRef = this.findElement(run, "w:footnoteReference");

      if (footnoteRef) {
        const id = this.readWId(footnoteRef);

        if (id !== null) {
          result.push({ type: "noteRef", noteId: id, noteType: "footnote" });
        }

        continue;
      }

      const endnoteRef = this.findElement(run, "w:endnoteReference");

      if (endnoteRef) {
        const id = this.readWId(endnoteRef);

        if (id !== null) {
          result.push({ type: "noteRef", noteId: id, noteType: "endnote" });
        }

        continue;
      }

      const text = this.extractRunText(run);

      if (!text) {
        continue;
      }

      const { bold, italic } = this.extractRunFormatting(run);

      result.push({
        type: "text",
        text,
        ...(bold ? { bold } : {}),
        ...(italic ? { italic } : {}),
      });
    }

    return result;
  }

  private extractRunText(run: any): string {
    const textNodes = this.findElements(run, "w:t");

    return textNodes.map((node) => this.extractText(node)).join("");
  }

  private extractRunFormatting(run: any): { bold: boolean; italic: boolean } {
    const properties = this.findElement(run, "w:rPr");

    if (!properties) {
      return { bold: false, italic: false };
    }

    const bold = this.findElement(properties, "w:b") !== null;
    const italic = this.findElement(properties, "w:i") !== null;

    return { bold, italic };
  }

  private readWId(node: any): number | null {
    const raw = node["@_w:id"];

    if (raw === undefined) {
      return null;
    }

    const id = Number(raw);

    return Number.isNaN(id) ? null : id;
  }

  private extractParagraphText(
    paragraph: any
  ): string {
    const texts = this.findElements(
      paragraph,
      "w:t"
    );

    return texts
      .map((node) => this.extractText(node))
      .join("");
  }

  private extractHeader(
  paragraphs: RawParagraph[]
): Article["header"] {
  const header: Article["header"] = {
    authors: [],
    keywords: [],
    jel_codes: [],
    dates: {},
  };

  const texts = paragraphs.map(
    (paragraph) => paragraph.text.trim()
  );

  const resumenIndex = texts.findIndex(
    (text) => text.toUpperCase() === "RESUMEN"
  );

  const abstractIndex = texts.findIndex(
    (text) => text.toUpperCase() === "ABSTRACT"
  );

  if (resumenIndex === -1) {
    return header;
  }

  // DOI
  const doiParagraph = texts.find(
    (text) =>
      text.toUpperCase().startsWith("DOI:")
  );

  if (doiParagraph) {
    header.doi = doiParagraph
      .replace(/^DOI:\s*/i, "")
      .trim();
  }

  // Sección
  const sectionParagraph = texts.find(
    (text) =>
      text.toLowerCase().startsWith("sección:")
  );

  if (sectionParagraph) {
    header.section = sectionParagraph
      .replace(/^Sección:\s*/i, "")
      .trim();
  }

  // Título
  const titleCandidate =
    this.findFirstTitleCandidate(
      paragraphs,
      resumenIndex
    );

  if (titleCandidate) {
    header.title = titleCandidate;
  }

  // Abstract / resumen
  const abstractParagraphs =
    this.extractAbstractParagraphs(
      paragraphs,
      resumenIndex,
      abstractIndex
    );

  if (abstractParagraphs.length > 0) {
    header.abstract =
      abstractParagraphs.join("\n\n");
  }

  // Keywords
  const spanishKeywords = texts.find(
    (text) =>
      /^palabras\s+clave\s*:/i.test(text)
  );

  if (spanishKeywords) {
    header.keywords =
      this.parseListField(
        spanishKeywords,
        /^palabras\s+clave\s*:/i
      );
  }

  // JEL
  const jel = texts.find(
    (text) =>
      /^(c[oó]digos\s+jel|jel\s+codes?)\s*:/i.test(text)
  );

  if (jel) {
    header.jel_codes =
      this.parseListField(
        jel,
        /^(c[oó]digos\s+jel|jel\s+codes?)\s*:/i
      );
  }

  // Fechas
  header.dates.received =
    this.extractField(
      texts,
      /^Recibido\s*:/i
    );

  header.dates.accepted =
    this.extractField(
      texts,
      /^Aceptado\s*:/i
    );

  header.dates.published =
    this.extractField(
      texts,
      /^Publicado\s*:/i
    );

  return header;
}

  private getHeadingLevel(
    paragraph: any
  ): number | null {
    const properties = this.findElement(
      paragraph,
      "w:pPr"
    );

    console.log(
      "\n=== PARÁGRAFO ==="
    );

    console.log(
      "Texto:",
      this.extractParagraphText(paragraph)
    );

    console.log(
      "pPr:",
      JSON.stringify(
        properties,
        null,
        2
      )
    );

    if (!properties) {
      console.log(
        "Resultado: sin w:pPr"
      );

      return null;
    }

    const style = this.findElement(
      properties,
      "w:pStyle"
    );

    console.log(
      "w:pStyle:",
      JSON.stringify(
        style,
        null,
        2
      )
    );

    if (!style) {
      console.log(
        "Resultado: sin w:pStyle"
      );

      return null;
    }

    const styleId =
      style["@_w:val"];

    console.log(
      "styleId:",
      styleId
    );

    if (!styleId) {
      console.log(
        "Resultado: styleId vacío"
      );

      return null;
    }

    const match = String(styleId).match(
      /Heading([1-9])/i
    );

    console.log(
      "match Heading:",
      match
    );

    if (!match) {
      console.log(
        "Resultado: no es Heading1-9"
      );

      return null;
    }

    const level = Number(
      match[1]
    );

    console.log(
      "Resultado:",
      level
    );

    return level;
  }

  private parseNotes(
    xml: string,
    type: "footnote" | "endnote"
  ): Note[] {
    const parsed = this.xmlParser.parse(xml);

    const noteElements = this.findElements(
      parsed,
      `w:${type}`
    );

    const notes: Note[] = [];

    for (const note of noteElements) {
      const rawId =
        note["@_w:id"] ??
        note["@_w:id"];

      if (rawId === undefined) {
        continue;
      }

      const id = Number(rawId);

      if (id < 1) {
        continue;
      }

      const textNodes = this.findElements(
        note,
        "w:t"
      );

      const text = textNodes
        .map((node) => this.extractText(node))
        .join("");

      notes.push({
        id,
        type,
        text,
      });
    }

    return notes;
  }

  private attachNoteAnchors(
    body: BodyBlock[],
    notes: Note[]
  ): void {
  }

  private extractText(node: any): string {
    if (typeof node === "string") {
      return node;
    }

    if (node?.["#text"] !== undefined) {
      return String(node["#text"]);
    }

    return "";
  }

  private findElement(
    root: any,
    name: string
  ): any | null {
    if (!root) {
      return null;
    }

    if (Array.isArray(root)) {
      for (const item of root) {
        const result = this.findElement(
          item,
          name
        );

        if (result) {
          return result;
        }
      }

      return null;
    }

    if (typeof root !== "object") {
      return null;
    }

    if (root[name]) {
      return root[name];
    }

    for (const value of Object.values(root)) {
      const result = this.findElement(
        value,
        name
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  private findElements(
    root: any,
    name: string
  ): any[] {
    const results: any[] = [];

    this.collectElements(
      root,
      name,
      results
    );

    return results;
  }

  private findDirectChildren(root: any, name: string): any[] {
    if (!Array.isArray(root)) {
      return [];
    }

    const results: any[] = [];

    for (const item of root) {
      if (
        item &&
        typeof item === "object" &&
        item[name] !== undefined
      ) {
        results.push(item);
      }
    }

    return results;
  }

  private findFirstTitleCandidate(
  paragraphs: RawParagraph[],
  resumenIndex: number
): string | undefined {
  for (
    let i = 0;
    i < resumenIndex;
    i++
  ) {
    const text = paragraphs[i].text.trim();

    if (!text) {
      continue;
    }

    if (/^DOI\s*:/i.test(text)) {
      continue;
    }

    if (/^Sección\s*:/i.test(text)) {
      continue;
    }

    if (
      paragraphs[i - 1]?.text
        .trim()
        .toLowerCase()
        .startsWith("sección:")
    ) {
      return text;
    }
  }

  return undefined;
  }

  private extractAbstractParagraphs(
    paragraphs: RawParagraph[],
    resumenIndex: number,
    abstractIndex: number
  ): string[] {
    const result: string[] = [];

    for (
      let i = resumenIndex + 1;
      i < paragraphs.length;
      i++
    ) {
      const text = paragraphs[i].text.trim();

      if (
        /^Palabras\s+Clave\s*:/i.test(text) ||
        /^C[oó]digos\s+JEL\s*:/i.test(text)
      ) {
        break;
      }

      if (
        abstractIndex !== -1 &&
        i >= abstractIndex
      ) {
        break;
      }

      if (text) {
        result.push(text);
      }
    }

    return result;
  }

  private parseListField(
    text: string,
    prefix: RegExp
  ): string[] {
    const value = text
      .replace(prefix, "")
      .trim();

    if (!value) {
      return [];
    }

    return value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private extractField(
    texts: string[],
    prefix: RegExp
  ): string | undefined {
    const value = texts.find((text) =>
      prefix.test(text)
    );

    if (!value) {
      return undefined;
    }

    return value
      .replace(prefix, "")
      .trim();
  }

  private collectElements(
    root: any,
    name: string,
    results: any[]
  ): void {
    if (!root) {
      return;
    }

    if (Array.isArray(root)) {
      for (const item of root) {
        this.collectElements(
          item,
          name,
          results
        );
      }

      return;
    }

    if (typeof root !== "object") {
      return;
    }

    if (root[name]) {
      const value = root[name];

      if (Array.isArray(value)) {
        results.push(...value);
      } else {
        results.push(value);
      }
    }

    for (const value of Object.values(root)) {
      this.collectElements(
        value,
        name,
        results
      );
    }
  }

  private extractMainBody(
  paragraphs: RawParagraph[]
): BodyBlock[] {
  const texts = paragraphs.map(
    (paragraph) => paragraph.text.trim()
  );

  const startIndex =
    this.findMainBodyStart(texts);

  const mainParagraphs =
    startIndex === -1
      ? paragraphs
      : paragraphs.slice(startIndex);

  return this.buildBodyBlocks(
    mainParagraphs
  );
  }

  private findMainBodyStart(
  texts: string[]
): number {
  const headings = [
    "introducción",
    "metodología",
    "resultados",
    "conclusiones y trabajos futuros",
    "referencias bibliográficas",
  ];

  for (let i = 0; i < texts.length; i++) {
    const normalized =
      texts[i]
        .trim()
        .toLowerCase();

    if (headings.includes(normalized)) {
      return i;
    }
  }

  return -1;
  }
}