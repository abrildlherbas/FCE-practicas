import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import {
  Article,
  BodyBlock,
  Note,
  InlineRun,
  Reference
} from "../models/Article";

import {
  findElement,
  findElements,
  findDirectChildren,
  extractText,
  readWId,
} from "./docx-xml.utils";

interface RawParagraph {
  xml: any;
  runs: InlineRun[];
  text: string;
  headingLevel: number | null;
}

interface ParsedStructure {
  header: Article["header"];
  body: BodyBlock[];
  references: Reference[];
}

export class DocxParser {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    preserveOrder: true,
  });

  async parse(zip: JSZip, sourcePath: string): Promise<Article> {
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

    const document = this.xmlParser.parse(documentXml);

    const footnotes = footnotesXml
      ? this.parseNotes(footnotesXml, "footnote")
      : [];

    const endnotes = endnotesXml
      ? this.parseNotes(endnotesXml, "endnote")
      : [];

    const structure = this.parseDocumentStructure(document);

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
      notes: [...footnotes, ...endnotes],
      references: structure.references,
    };
  }

  private parseDocumentStructure(
    document: any
  ): ParsedStructure {
    const body = findElement(
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
        references: [],
      };
    }

    const rawParagraphs =
      this.extractBodyParagraphs(body);

    const normalizedParagraphs =
      this.normalizeBlocks(rawParagraphs);

    const header =
      this.extractHeader(normalizedParagraphs);

    const bodyBlocks =
      this.extractMainBody(
        normalizedParagraphs
      );

    const references =
      this.extractReferences(
        normalizedParagraphs
      );

    return {
      header,
      body: bodyBlocks,
      references,
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

    if (!file) return null;

    return file.async("text");
  }

  private extractBodyParagraphs(
    body: any
  ): RawParagraph[] {
    const paragraphElements =
      findDirectChildren(body, "w:p");

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

      const previous =
        normalized[normalized.length - 1];

      if (
        !previous ||
        previous.type !== "text" ||
        previous.bold !== run.bold ||
        previous.italic !== run.italic
      ) {
        normalized.push({ ...run });
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

    if (!previous || !current) return "";

    if (
      previousText.endsWith(" ") ||
      currentText.startsWith(" ")
    ) {
      return "";
    }

    if (/^[.,;:!?%)\]}]/.test(current)) {
      return "";
    }

    if (/[([{]$/.test(previous)) {
      return "";
    }

    if (
      /\d$/.test(previous) &&
      /^\d/.test(current)
    ) {
      return "";
    }

    const previousWord =
      previous.match(
        /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/
      )?.[0] ?? "";

    const currentWord =
      current.match(
        /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/
      )?.[0] ?? "";

    if (
      previousWord.length === 1 ||
      currentWord.length === 1
    ) {
      return "";
    }

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

      if (!hasContent) continue;

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

  private parseRuns(
    paragraph: any
  ): InlineRun[] {
    const runElements =
      findElements(paragraph, "w:r");

    const result: InlineRun[] = [];

    for (const run of runElements) {
      const footnoteRef =
        findElement(run, "w:footnoteReference");

      if (footnoteRef) {
        const id = readWId(footnoteRef);

        if (id !== null) {
          result.push({
            type: "noteRef",
            noteId: id,
            noteType: "footnote",
          });
        }

        continue;
      }

      const endnoteRef =
        findElement(run, "w:endnoteReference");

      if (endnoteRef) {
        const id = readWId(endnoteRef);

        if (id !== null) {
          result.push({
            type: "noteRef",
            noteId: id,
            noteType: "endnote",
          });
        }

        continue;
      }

      const text = this.extractRunText(run);

      if (!text) continue;

      const { bold, italic } =
        this.extractRunFormatting(run);

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
    const textNodes =
      findElements(run, "w:t");

    return textNodes
      .map((node) => extractText(node))
      .join("");
  }

  private extractRunFormatting(
    run: any
  ): {
    bold: boolean;
    italic: boolean;
  } {
    const properties =
      findElement(run, "w:rPr");

    if (!properties) {
      return {
        bold: false,
        italic: false,
      };
    }

    const bold =
      findElement(properties, "w:b") !== null;

    const italic =
      findElement(properties, "w:i") !== null;

    return {
      bold,
      italic,
    };
  }

  private extractParagraphText(
    paragraph: any
  ): string {
    const texts =
      findElements(paragraph, "w:t");

    return texts
      .map((node) => extractText(node))
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

    /*
    * Título
    */
    const titleCandidate =
      this.findFirstTitleCandidate(
        paragraphs,
        texts.length
      );

    if (titleCandidate) {
      header.title = titleCandidate;
    }

    /*
    * Autor
    */
    const titleIndex =
      titleCandidate
        ? texts.findIndex(
            (text) => text === titleCandidate
          )
        : -1;

    if (
      titleIndex !== -1 &&
      texts[titleIndex + 1]
    ) {
      const author =
        texts[titleIndex + 1].trim();

      if (
        author &&
        !this.isMetadataText(author)
      ) {
        header.authors = [author];
      }
    }

    /*
    * ORCID
    */
    const orcid =
      texts
        .join(" ")
        .match(
          /https?:\/\/orcid\.org\/([0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4})/i
        );

    if (orcid) {
      header.orcid = orcid[1];
    }

    /*
    * DOI
    */
    const doi =
      texts
        .join(" ")
        .match(
          /(?:https?:\/\/doi\.org\/|DOI\s*:\s*)(10\.\S+)/i
        );

    if (doi) {
      header.doi = doi[1]
        .replace(/[.,;]+$/, "");
    }

    /*
    * Sección
    */
    const sectionParagraph =
      texts.find(
        (text) =>
          text
            .toLowerCase()
            .startsWith("sección:")
      );

    if (sectionParagraph) {
      header.section =
        sectionParagraph
          .replace(/^Sección\s*:\s*/i, "")
          .trim();
    }

    /*
    * Palabras clave
    */
    const keywordsParagraph =
      texts.find(
        (text) =>
          /^palabras\s+clave/i.test(text)
      );

    if (keywordsParagraph) {
      const keywords =
        keywordsParagraph
          .replace(
            /^palabras\s+clave\s*:?\s*/i,
            ""
          )
          .replace(/[.!]\s*$/, "")
          .split(",")
          .map(
            (keyword) =>
              keyword.trim()
          )
          .filter(Boolean);

      header.keywords = keywords;
    }

    /*
    * JEL
    */
    const jel =
      texts.find(
        (text) =>
          /^(c[oó]digos\s+jel|jel\s+codes?)\s*:/i.test(
            text
          )
      );

    if (jel) {
      header.jel_codes =
        this.parseListField(
          jel,
          /^(c[oó]digos\s+jel|jel\s+codes?)\s*:/i
        );
    }

    /*
    * Fechas
    *
    * En este documento están dentro del mismo
    * párrafo:
    *
    * Recibido: 3/2025Aceptado: 5/2025
    */
    const fullText =
      texts.join(" ");

    const received =
      fullText.match(
        /Recibido\s*:\s*([0-9]{1,2}\/[0-9]{4})/i
      );

    if (received) {
      header.dates.received =
        received[1];
    }

    const accepted =
      fullText.match(
        /Aceptado\s*:\s*([0-9]{1,2}\/[0-9]{4})/i
      );

    if (accepted) {
      header.dates.accepted =
        accepted[1];
    }

    const published =
      fullText.match(
        /Publicado\s*:\s*([^]+?)(?=\s+(?:Palabras|Resumen|Abstract)|$)/i
      );

    if (published) {
      header.dates.published =
        published[1].trim();
    }

    return header;
  }

  private isMetadataText(
    text: string
  ): boolean {
    return (
      /^https?:\/\//i.test(text) ||
      /@/.test(text) ||
      /^doi\s*:/i.test(text) ||
      /^sección\s*:/i.test(text) ||
      /^recibido\s*:/i.test(text) ||
      /^aceptado\s*:/i.test(text) ||
      /^publicado\s*:/i.test(text) ||
      /^palabras\s+clave/i.test(text) ||
      /^c[oó]digos\s+jel/i.test(text)
    );
  }

  private getHeadingLevel(
    paragraph: any
  ): number | null {
    const properties =
      findElement(paragraph, "w:pPr");

    if (!properties) {
      return null;
    }

    const style =
      findElement(properties, "w:pStyle");

    if (!style) {
      return null;
    }

    const styleId = style["@_w:val"];

    if (!styleId) {
      return null;
    }

    const match =
      String(styleId).match(
        /Heading([1-9])/i
      );

    if (!match) {
      return null;
    }

    const level = Number(match[1]);

    return level;
  }

  private parseNotes(
    xml: string,
    type: "footnote" | "endnote"
  ): Note[] {
    const parsed =
      this.xmlParser.parse(xml);

    const noteElements =
      findElements(parsed, `w:${type}`);

    const notes: Note[] = [];

    for (const note of noteElements) {
      const rawId =
        note["@_w:id"] ??
        note["@_w:id"];

      if (rawId === undefined) continue;

      const id = Number(rawId);

      if (id < 1) continue;

      const textNodes =
        findElements(note, "w:t");

      const text = textNodes
        .map((node) => extractText(node))
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
  ): void {}

  private findFirstTitleCandidate(
    paragraphs: RawParagraph[],
    endIndex: number
  ): string | undefined {
    for (
      let i = 0;
      i < endIndex;
      i++
    ) {
      const text =
        paragraphs[i].text.trim();

      if (!text) {
        continue;
      }

      if (
        /^DOI\s*:/i.test(text) ||
        /^Sección\s*:/i.test(text) ||
        /^Palabras\s+clave/i.test(text) ||
        /^https?:\/\//i.test(text) ||
        /@/.test(text)
      ) {
        continue;
      }

      return text;
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
      const text =
        paragraphs[i].text.trim();

      if (
        /^Palabras\s+Clave\s*:/i.test(
          text
        ) ||
        /^C[oó]digos\s+JEL\s*:/i.test(
          text
        )
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
    const value =
      text.replace(prefix, "").trim();

    if (!value) return [];

    return value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private extractField(
    texts: string[],
    prefix: RegExp
  ): string | undefined {
    const value =
      texts.find((text) =>
        prefix.test(text)
      );

    if (!value) return undefined;

    return value
      .replace(prefix, "")
      .trim();
  }

  private extractMainBody(
    paragraphs: RawParagraph[]
  ): BodyBlock[] {
    const texts = paragraphs.map(
      (paragraph) => paragraph.text.trim()
    );

    const startIndex =
      this.findMainBodyStart(texts);

    const endIndex =
      this.findReferencesStart(
        texts,
        startIndex
      );

    const mainParagraphs =
      paragraphs.slice(
        startIndex === -1 ? 0 : startIndex,
        endIndex === -1
          ? paragraphs.length
          : endIndex
      );

    return this.buildBodyBlocks(
      mainParagraphs
    );
  }

  private findMainBodyStart(
    texts: string[]
  ): number {
    const headings = [
      "introduccion",
      "metodologia",
      "resultados",
      "conclusiones y trabajos futuros",
      "referencias bibliograficas",
    ];

    for (let i = 0; i < texts.length; i++) {
      const normalized =
        texts[i]
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .trim()
          .toLowerCase();

      if (headings.includes(normalized)) {
        return i;
      }
    }

    return -1;
  }

  private findReferencesStart(
    texts: string[],
    startIndex: number
  ): number {
    for (
      let i = Math.max(startIndex, 0);
      i < texts.length;
      i++
    ) {
      const normalized =
        texts[i]
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .trim()
          .toLowerCase();

      if (
        normalized ===
        "referencias bibliograficas"
      ) {
        return i;
      }
    }

    return -1;
  }

  private extractReferences(
    paragraphs: RawParagraph[]
  ): Reference[] {
    const texts = paragraphs.map(
      (paragraph) => paragraph.text.trim()
    );

    const startIndex =
      this.findReferencesStart(
        texts,
        0
      );

    if (startIndex === -1) {
      return [];
    }

    const referenceParagraphs =
      paragraphs.slice(startIndex + 1);

    const references: Reference[] = [];

    for (const paragraph of referenceParagraphs) {
      const text =
        paragraph.text.trim();

      if (!text) {
        continue;
      }

      const last =
        references[references.length - 1];

      if (
        this.isUrl(text) &&
        last
      ) {
        last.text += ` ${text}`;
        continue;
      }

      references.push({
        id: String(references.length + 1),
        text,
      });
    }

    return references;
  }

  private isUrl(
    text: string
  ): boolean {
    return /^https?:\/\//i.test(text);
  }

}