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
  extractText,
  readWId,
} from "./docx-xml.utils";
import { HeaderExtractor } from "./HeaderExtractor";
import { NoteDetector } from "./NoteDetector";
import { StylesResolver } from "./StylesResolver";
import { DocxBodyBlockExtractor } from "./DocxBodyBlockExtractor";
import { CitationLinker } from "./CitationLinker";

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

interface ExtractedMainBody {
  blocks: BodyBlock[];
  sourceBlockIndexes: number[];
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
    trimValues: false,
    parseTagValue: false,
  });

  async parse(
    zip: JSZip,
    sourcePath: string,
    previousWarnings: ParseWarning[] = []
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
      extractedBlocks,
      previousWarnings
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
    },
    previousWarnings: ParseWarning[]
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
    const mainBodyStartBlockIndex =
      mainBodyStart < 0
        ? Number.POSITIVE_INFINITY
        : rawParagraphs[mainBodyStart].blockIndex;
    headerExtraction.header.sourceParagraphs = rawParagraphs
      .filter(
        (paragraph) =>
          paragraph.blockIndex < mainBodyStartBlockIndex &&
          paragraph.text.trim().length > 0
      )
      .map((paragraph) => paragraph.text);
    for (const paragraph of rawParagraphs) {
      if (
        paragraph.blockIndex < mainBodyStartBlockIndex &&
        !headerExtraction.consumedBlockIndexes.has(paragraph.blockIndex) &&
        paragraph.text.trim()
      ) {
        warnings.push({
          code: "unclassified-header-paragraph",
          message:
            `Texto previo al cuerpo que no se pudo clasificar: ${paragraph.text}`,
          blockIndex: paragraph.blockIndex,
          status: "pendiente",
        });
      }
    }
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

    const extractedMainBody =
      this.extractMainBody(
        normalizedParagraphs,
        headerExtraction.consumedBlockIndexes,
        noteDetection.consumedNoteBlockIndexes,
        noteDetection.referenceHeadingBlockIndex,
        extractedBlocks.blocksByBodyIndex
      );
    const citationLinking = new CitationLinker().link(
      extractedMainBody.blocks,
      noteDetection.references
    );
    const sourceBodyIndexes = new Map<number, number[]>();
    extractedMainBody.sourceBlockIndexes.forEach((sourceIndex, bodyIndex) => {
      const indexes = sourceBodyIndexes.get(sourceIndex) ?? [];
      indexes.push(bodyIndex);
      sourceBodyIndexes.set(sourceIndex, indexes);
    });
    const bodyWarnings = warnings.map((warning) => {
      const matchingIndexes = warning.blockIndex === undefined
        ? undefined
        : sourceBodyIndexes.get(warning.blockIndex);
      const bodyIndex = warning.code.startsWith("image-") ||
        warning.code.includes("image")
        ? matchingIndexes?.find((index) =>
            extractedMainBody.blocks[index]?.type === "image"
          ) ?? matchingIndexes?.[0]
        : matchingIndexes?.[0];
      return {
        ...warning,
        ...(bodyIndex !== undefined ? { blockId: `b-${bodyIndex}` } : {}),
        status: "pendiente" as const,
      };
    });
    const citationWarnings = citationLinking.warnings.map((warning) => ({
      ...warning,
      ...(warning.blockIndex !== undefined
        ? { blockId: `b-${warning.blockIndex}` }
        : {}),
      status: "pendiente" as const,
    }));
    const detectedWarnings = [...bodyWarnings, ...citationWarnings];
    const resolvedWarningKeys = new Set(
      previousWarnings
        .filter((warning) => warning.status === "resuelto")
        .map((warning) =>
          this.warningKey(warning)
        )
    );
    const currentWarnings = detectedWarnings.map((warning) =>
      resolvedWarningKeys.has(this.warningKey(warning))
        ? { ...warning, status: "resuelto" as const }
        : warning
    );

    return {
      header: headerExtraction.header,
      body: citationLinking.body,
      references: noteDetection.references,
      warnings: currentWarnings,
    };
  }

  private warningKey(warning: ParseWarning): string {
    return `${warning.code}\u0000${warning.blockId ?? ""}\u0000${warning.message}`;
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
    const bodyElements = this.bodyContentElements(body);
    const paragraphElements = bodyElements
      .filter(({ node }) => getXmlName(node) === "w:p");

    return paragraphElements.map(
      ({ node: paragraph, blockIndex }): RawParagraph => {
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
          blockIndex,
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
    const bodyChildren = this.bodyContentElements(body);

    for (const { node: child, blockIndex } of bodyChildren) {
      const name = getXmlName(child);
      if (!name) continue;

      if (
        name !== "w:p" &&
        name !== "w:sectPr" &&
        (name !== "w:tbl" ||
          !recognizedBlockIndexes.has(blockIndex))
      ) {
        const text = collectXmlNodes(child, "w:r")
          .map((run) => this.extractRunText(run))
          .join("") ||
          findElements(child, "w:t")
            .map((node) => extractText(node))
            .join("");
        warnings.push({
          code: "unclassified-element",
          message: text
            ? `El elemento ${name} del cuerpo no se convirtió a un bloque del artículo. Texto: ${text}`
            : `El elemento ${name} del cuerpo no se convirtió a un bloque del artículo.`,
          blockIndex,
          status: "pendiente",
        });
      }

      if (name === "w:p") {
        for (const textBox of findElements(child, "w:txbxContent")) {
          const text = findElements(textBox, "w:t")
            .map((node) => extractText(node))
            .join("");
          if (text) {
            warnings.push({
              code: "unclassified-element",
              message:
                `El cuadro de texto del párrafo no se convirtió a un bloque del artículo. Texto: ${text}`,
              blockIndex,
              status: "pendiente",
            });
          }
        }
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
            `Este párrafo breve está entre otros dos párrafos breves; podría ser un fragmento de texto. Texto: ${paragraphs[index].text}`,
          blockIndex: paragraphs[index].blockIndex,
          status: "pendiente",
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
              `No se pudo resolver el tamaño de fuente de este run. Texto: ${runText}`,
            blockIndex: paragraph.blockIndex,
            status: "pendiente",
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

      previous.text += run.text;
    }

    return normalized;
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
    const visit = (node: unknown): string => {
      if (typeof node === "string") return node;

      if (Array.isArray(node)) {
        return node.map(visit).join("");
      }

      const record = asXmlRecord(node);
      if (!record) return "";

      const name = getXmlName(node);
      if (name === "w:tab") return " ";
      if (name === "w:br") return "\n";
      if (name === "w:noBreakHyphen") return "-";
      if (name === "w:softHyphen") return "";
      if (name === "w:t") return visit(record[name]);

      return Object.entries(record)
        .filter(([key]) => key !== ":@")
        .map(([, value]) => visit(value))
        .join("");
    };

    return visit(run);
  }

  private extractParagraphText(
    paragraph: any
  ): string {
    const runNodes = findElements(paragraph, "w:r");

    return runNodes
      .map((node) => this.extractRunText(node))
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

  private bodyContentElements(
    body: unknown
  ): { node: unknown; blockIndex: number }[] {
    const elements: { node: unknown; blockIndex: number }[] = [];
    const visit = (children: unknown): void => {
      if (!Array.isArray(children)) return;
      for (const child of children) {
        const name = getXmlName(child);
        if (name === "w:sdt") {
          const content = findElement(child, "w:sdtContent");
          if (content) visit(content);
          continue;
        }
        if (name) {
          elements.push({ node: child, blockIndex: elements.length });
        }
      }
    };
    visit(body);
    return elements;
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
  ): ExtractedMainBody {
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
    const sourceBlockIndexes: number[] = [];

    for (const blockIndex of orderedIndexes) {
      const blocks = [
        ...(paragraphBlocks.get(blockIndex) ?? []),
        ...(extractedBlocks.get(blockIndex) ?? []),
      ];
      bodyBlocks.push(...blocks);
      sourceBlockIndexes.push(...blocks.map(() => blockIndex));
    }

    return { blocks: bodyBlocks, sourceBlockIndexes };
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