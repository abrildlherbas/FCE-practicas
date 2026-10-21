import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import {
  Article,
  BodyBlock,
  Note,
  InlineRun,
  ParseWarning,
  Reference
} from "../models/Article";

import {
  findElement,
  findElements,
  findDirectChildren,
  extractText,
  readWId,
} from "./docx-xml.utils";
import { HeaderExtractor } from "./HeaderExtractor";
import { NoteDetector } from "./NoteDetector";
import { StylesResolver } from "./StylesResolver";
import { DocxBodyBlockExtractor } from "./DocxBodyBlockExtractor";

interface RawParagraph {
  xml: any;
  runs: InlineRun[];
  text: string;
  headingLevel: number | null;
  blockIndex: number;
  styleId: string | null;
  sizeHalfPoints: string | null;
  hasSuperscriptPrefix: boolean;
}

interface ParsedStructure {
  header: Article["header"];
  body: BodyBlock[];
  references: Reference[];
  warnings: ParseWarning[];
}

type XmlRecord = Record<string, unknown>;

function asXmlRecord(value: unknown): XmlRecord | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as XmlRecord;
}

function getXmlName(node: unknown): string | null {
  const record = asXmlRecord(node);
  if (!record) return null;

  return Object.keys(record).find(
    (key) => key !== ":@" && !key.startsWith("#")
  ) ?? null;
}

function collectXmlNodes(
  node: unknown,
  name: string,
  results: unknown[] = []
): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectXmlNodes(child, name, results);
    }

    return results;
  }

  const record = asXmlRecord(node);
  if (!record) return results;

  if (getXmlName(node) === name) {
    results.push(node);
    return results;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key !== ":@" && !key.startsWith("#")) {
      collectXmlNodes(value, name, results);
    }
  }

  return results;
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
    const stylesXml = await this.readOptional(
      zip,
      "word/styles.xml"
    );
    const relationshipsXml = await this.readOptional(
      zip,
      "word/_rels/document.xml.rels"
    );

    const document = this.xmlParser.parse(documentXml);
    const stylesResolver = new StylesResolver(stylesXml);
    const extractedBlocks =
      await new DocxBodyBlockExtractor().extract(
        documentXml,
        relationshipsXml,
        zip,
        sourcePath
      );

    const footnotes = footnotesXml
      ? this.parseNotes(footnotesXml, "footnote")
      : [];

    const endnotes = endnotesXml
      ? this.parseNotes(endnotesXml, "endnote")
      : [];

    const structure = this.parseDocumentStructure(
      document,
      stylesResolver,
      [...footnotes, ...endnotes],
      extractedBlocks
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
      notes: [...footnotes, ...endnotes],
      references: structure.references,
      warnings: structure.warnings,
    };
  }

  private parseDocumentStructure(
    document: any,
    stylesResolver: StylesResolver,
    nativeNotes: Note[],
    extractedBlocks: {
      blocksByBodyIndex: Map<number, BodyBlock[]>;
      warnings: ParseWarning[];
    }
  ): ParsedStructure {
    const body = findElement(
      document,
      "w:body"
    );

    if (!body) {
      const headerExtraction =
        new HeaderExtractor().extract([]);

      return {
        header: headerExtraction.header,
        body: [],
        references: [],
        warnings: headerExtraction.warnings,
      };
    }

    const rawParagraphs =
      this.extractBodyParagraphs(body, stylesResolver);
    const headerExtraction = new HeaderExtractor().extract(
      rawParagraphs.map((paragraph) => ({
        blockIndex: paragraph.blockIndex,
        text: paragraph.text,
        styleId: paragraph.styleId,
        sizeHalfPoints: paragraph.sizeHalfPoints,
      }))
    );
    const warnings = this.collectWarnings(
      body,
      rawParagraphs,
      stylesResolver,
      new Set(extractedBlocks.blocksByBodyIndex.keys())
    );
    warnings.push(...extractedBlocks.warnings);
    warnings.push(...headerExtraction.warnings);

    const mainBodyStart = this.findMainBodyStart(
      rawParagraphs.map((paragraph) => paragraph.text.trim())
    );
    const noteDetection = new NoteDetector().detect(
      rawParagraphs.map((paragraph) => ({
        blockIndex: paragraph.blockIndex,
        text: paragraph.text,
        sizeHalfPoints: paragraph.sizeHalfPoints,
        hasSuperscriptPrefix: paragraph.hasSuperscriptPrefix,
      })),
      nativeNotes,
      mainBodyStart < 0
        ? null
        : rawParagraphs[mainBodyStart].blockIndex
    );
    warnings.push(...noteDetection.warnings);

    const normalizedParagraphs =
      this.normalizeBlocks(rawParagraphs);

    const bodyBlocks =
      this.extractMainBody(
        normalizedParagraphs,
        headerExtraction.consumedBlockIndexes,
        noteDetection.consumedNoteBlockIndexes,
        noteDetection.referenceHeadingBlockIndex,
        extractedBlocks.blocksByBodyIndex
      );

    return {
      header: headerExtraction.header,
      body: bodyBlocks,
      references: noteDetection.references,
      warnings,
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
    body: any,
    stylesResolver: StylesResolver
  ): RawParagraph[] {
    const paragraphElements =
      findDirectChildren(body, "w:p");
    const directElements = Array.isArray(body)
      ? body.filter((child) => getXmlName(child) !== null)
      : [];

    return paragraphElements.map(
      (paragraph, paragraphIndex): RawParagraph => {
        const runs = this.parseRuns(paragraph, stylesResolver);
        const firstRun =
          collectXmlNodes(paragraph, "w:r")[0] ?? null;
        const firstRunSize = firstRun
          ? stylesResolver.resolveRunProps(
              paragraph,
              firstRun
            ).sizeHalfPoints
          : null;
        const firstTextRun = collectXmlNodes(
          paragraph,
          "w:r"
        ).find((run) => this.extractRunText(run) !== "") ?? null;

        return {
          xml: paragraph,
          runs,
          text: this.extractParagraphText(paragraph),
          headingLevel: this.getHeadingLevel(paragraph),
          blockIndex: Array.isArray(body)
            ? Math.max(directElements.indexOf(paragraph), 0)
            : paragraphIndex,
          styleId:
            stylesResolver.getParagraphStyleId(paragraph),
          sizeHalfPoints: firstRunSize,
          hasSuperscriptPrefix:
            firstTextRun !== null &&
            stylesResolver.isSuperscript(
              paragraph,
              firstTextRun
            ),
        };
      }
    );
  }

  private collectWarnings(
    body: any,
    paragraphs: RawParagraph[],
    stylesResolver: StylesResolver,
    recognizedBlockIndexes: Set<number>
  ): ParseWarning[] {
    const warnings: ParseWarning[] = [];
    const bodyChildren = Array.isArray(body) ? body : [];

    let blockIndex = -1;
    for (const child of bodyChildren) {
      const name = getXmlName(child);
      if (!name) continue;
      blockIndex++;

      if (
        name !== "w:p" &&
        name !== "w:sectPr" &&
        !recognizedBlockIndexes.has(blockIndex)
      ) {
        warnings.push({
          code: "unclassified-element",
          message: `El elemento ${name} del cuerpo no se convirtió a un bloque del artículo.`,
          blockIndex,
        });
      }
    }

    for (let index = 1; index < paragraphs.length - 1; index++) {
      const previousLength =
        paragraphs[index - 1].text.trim().length;
      const currentLength =
        paragraphs[index].text.trim().length;
      const nextLength =
        paragraphs[index + 1].text.trim().length;

      if (
        previousLength > 0 &&
        previousLength <= 20 &&
        currentLength > 0 &&
        currentLength <= 20 &&
        nextLength > 0 &&
        nextLength <= 20
      ) {
        warnings.push({
          code: "short-paragraph-cluster",
          message:
            "Este párrafo breve está entre otros dos párrafos breves; podría ser un fragmento de texto.",
          blockIndex: paragraphs[index].blockIndex,
        });
      }
    }

    for (const paragraph of paragraphs) {
      const runs = collectXmlNodes(paragraph.xml, "w:r");

      for (const run of runs) {
        const runText = this.extractRunText(run);
        if (!runText) continue;

        if (!stylesResolver.resolveRunProps(paragraph.xml, run).sizeHalfPoints) {
          warnings.push({
            code: "unresolved-run-size",
            message:
              "No se pudo resolver el tamaño de fuente de este run.",
            blockIndex: paragraph.blockIndex,
          });
        }
      }
    }

    return warnings;
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
    paragraph: any,
    stylesResolver: StylesResolver
  ): InlineRun[] {
    const runElements =
      findElements(paragraph, "w:r");

    const result: InlineRun[] = [];

    for (const run of runElements) {
      const footnoteRef =
        collectXmlNodes(run, "w:footnoteReference")[0];

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
        collectXmlNodes(run, "w:endnoteReference")[0];

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
        stylesResolver.resolveRunProps(paragraph, run);

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

  private extractParagraphText(
    paragraph: any
  ): string {
    const texts =
      findElements(paragraph, "w:t");

    return texts
      .map((node) => extractText(node))
      .join("");
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
      collectXmlNodes(parsed, `w:${type}`);

    const notes: Note[] = [];

    for (const note of noteElements) {
      const id = readWId(note);
      if (id === null) continue;

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

  private extractMainBody(
    paragraphs: RawParagraph[],
    consumedBlockIndexes: Set<number>,
    consumedNoteBlockIndexes: Set<number>,
    referenceHeadingBlockIndex: number | null,
    extractedBlocks: Map<number, BodyBlock[]>
  ): BodyBlock[] {
    const texts = paragraphs.map(
      (paragraph) => paragraph.text.trim()
    );

    const startIndex =
      this.findMainBodyStart(texts);

    const existingReferencesStart =
      this.findReferencesStart(
        texts,
        startIndex
      );
    const detectedReferencesIndex =
      referenceHeadingBlockIndex === null
        ? -1
        : paragraphs.findIndex(
            (paragraph) =>
              paragraph.blockIndex === referenceHeadingBlockIndex
          );
    const endIndex =
      existingReferencesStart < 0
        ? detectedReferencesIndex
        : detectedReferencesIndex < 0
          ? existingReferencesStart
          : Math.min(existingReferencesStart, detectedReferencesIndex);

    const startBlockIndex =
      startIndex === -1 ? 0 : paragraphs[startIndex].blockIndex;
    const endBlockIndex =
      endIndex === -1
        ? Number.POSITIVE_INFINITY
        : paragraphs[endIndex].blockIndex;
    const mainParagraphs =
      paragraphs.slice(
        startIndex === -1 ? 0 : startIndex,
        endIndex === -1
          ? paragraphs.length
          : endIndex
      ).filter(
        (paragraph) =>
          !consumedBlockIndexes.has(paragraph.blockIndex) &&
          !consumedNoteBlockIndexes.has(paragraph.blockIndex)
      );

    const paragraphBlocks = new Map<number, BodyBlock[]>();
    for (const paragraph of mainParagraphs) {
      if (
        consumedBlockIndexes.has(paragraph.blockIndex) ||
        consumedNoteBlockIndexes.has(paragraph.blockIndex)
      ) {
        continue;
      }

      const blocks = this.buildBodyBlocks([paragraph]);
      if (blocks.length > 0) {
        paragraphBlocks.set(paragraph.blockIndex, blocks);
      }
    }

    const bodyIndexes = new Set([
      ...paragraphBlocks.keys(),
      ...extractedBlocks.keys(),
    ]);
    const orderedIndexes = [...bodyIndexes]
      .filter(
        (blockIndex) =>
          blockIndex >= startBlockIndex &&
          blockIndex < endBlockIndex
      )
      .sort((left, right) => left - right);
    const bodyBlocks: BodyBlock[] = [];

    for (const blockIndex of orderedIndexes) {
      bodyBlocks.push(...(paragraphBlocks.get(blockIndex) ?? []));
      bodyBlocks.push(...(extractedBlocks.get(blockIndex) ?? []));
    }

    return bodyBlocks;
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

}