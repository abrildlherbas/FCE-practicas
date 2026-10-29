import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import {
  Article,
  BodyBlock,
  CitationMetadata,
  Note,
  InlineRun,
  ParseWarning,
  Reference,
  WarningState,
} from "../models/Article";
import { headerRules } from "../config/header-rules";

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
import { warningIdentity } from "../warningIdentity";

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

interface FieldState {
  instruction: string;
  separated: boolean;
  discarded: boolean;
}

interface ParseContext {
  fields: FieldState[];
  warnings: ParseWarning[];
  hyperlinkTargets: Map<string, string>;
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

function getXmlAttribute(node: unknown, name: string): string | null {
  const record = asXmlRecord(node);
  const attributes = asXmlRecord(record?.[":@"]);
  const value = attributes?.[`@_${name}`];
  return value === undefined ? null : String(value);
}

function citationMetadata(instruction: string): CitationMetadata | undefined {
  if (!/\b(?:ZOTERO_ITEM|MENDELEY)\b/i.test(instruction)) return undefined;
  const jsonStart = instruction.indexOf("{");
  const jsonEnd = instruction.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(instruction.slice(jsonStart, jsonEnd + 1));
  } catch {
    return undefined;
  }
  const root = asXmlRecord(value);
  const items = Array.isArray(root?.citationItems)
    ? root.citationItems
    : [];
  const item = asXmlRecord(asXmlRecord(items[0])?.itemData) ??
    asXmlRecord(items[0]) ??
    root;
  if (!item) return undefined;

  const authorValues = Array.isArray(item.author) ? item.author : [];
  const authors = authorValues
    .map((author) => {
      const authorRecord = asXmlRecord(author);
      return String(
        authorRecord?.family ??
          authorRecord?.literal ??
          ""
      ).trim();
    })
    .filter(Boolean);
  const issued = asXmlRecord(item.issued);
  const firstDate = Array.isArray(issued?.["date-parts"])
    ? issued["date-parts"][0]
    : null;
  const yearValue = Array.isArray(firstDate) ? firstDate[0] : null;
  const year = Number(yearValue);
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const metadata: CitationMetadata = {
    ...(authors.length ? { authors } : {}),
    ...(Number.isInteger(year) && year > 0 ? { year } : {}),
    ...(title ? { title } : {}),
  };
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeVisibleText(text: string): {
  text: string;
  changed: boolean;
} {
  const normalized = text
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, " ")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "\ufffd")
    .replace(/\ud800(?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/gu, "\ufffd");
  return { text: normalized, changed: normalized !== text };
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
    previousWarnings: Array<ParseWarning | WarningState> = []
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
    const parseContext: ParseContext = {
      fields: [],
      warnings: [],
      hyperlinkTargets: this.readHyperlinkTargets(relationshipsXml),
    };

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
      parseContext,
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
    parseContext: ParseContext,
    nativeNotes: Note[],
    extractedBlocks: {
      blocksByBodyIndex: Map<number, BodyBlock[]>;
      warnings: ParseWarning[];
    },
    previousWarnings: Array<ParseWarning | WarningState>
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
      this.extractBodyParagraphs(body, stylesResolver, parseContext);
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
          start: 0,
          end: paragraph.text.length,
          affectedText: paragraph.text,
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
        extractedBlocks.blocksByBodyIndex,
        parseContext
      );
      warnings.push(...parseContext.warnings);
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
    const previousById = new Map(
      previousWarnings.map((warning) => {
        const id =
          "code" in warning
            ? warning.id ?? warningIdentity(warning)
            : warning.id;
        return [id, warning] as const;
      })
    );
    let nextOrdinal = Math.max(
      0,
      ...previousWarnings.map((warning) =>
        "ordinal" in warning ? warning.ordinal ?? 0 : 0
      )
    );
    const currentWarnings = detectedWarnings.map((warning) => {
      const id = warningIdentity(warning);
      const previous = previousById.get(id);
      const ordinal =
        previous && "ordinal" in previous && previous.ordinal
          ? previous.ordinal
          : ++nextOrdinal;
      return {
        ...warning,
        id,
        ordinal,
        status:
          previous?.status === "resuelto"
            ? "resuelto" as const
            : "pendiente" as const,
      };
    });

    return {
      header: headerExtraction.header,
      body: citationLinking.body,
      references: noteDetection.references,
      warnings: currentWarnings,
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
    stylesResolver: StylesResolver,
    parseContext: ParseContext
  ): RawParagraph[] {
    const bodyElements = this.bodyContentElements(body);
    const paragraphElements = bodyElements
      .filter(({ node }) => getXmlName(node) === "w:p");

    return paragraphElements.map(
      ({ node: paragraph, blockIndex }): RawParagraph => {
        const styleId = stylesResolver.getParagraphStyleId(paragraph);
        const runs = this.parseRuns(
          paragraph,
          stylesResolver,
          parseContext,
          blockIndex,
          styleId
        );
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
          styleId,
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
    }

    for (const alternate of collectXmlNodes(body, "mc:AlternateContent")) {
      const alternateRecord = asXmlRecord(alternate);
      const choices = alternateRecord?.["mc:Choice"];
      const fallback = alternateRecord?.["mc:Fallback"];
      const mainText = this.extractRunText(Array.isArray(choices) ? choices[0] : choices);
      const fallbackText = this.extractRunText(fallback);
      if (mainText && mainText === fallbackText) {
        warnings.push({
          code: "duplicate-alternate-content-removed",
          message: `Se descartó la rama alternativa duplicada de mc:AlternateContent: ${mainText}`,
          status: "pendiente",
        });
      }
    }

    warnings.push(...this.collectUnknownWordWarnings(body, paragraphs));

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
          start: 0,
          end: paragraphs[index].text.length,
          affectedText: paragraphs[index].text,
          status: "pendiente",
        });
      }
    }

    for (const paragraph of paragraphs) {
      const runs = collectXmlNodes(paragraph.xml, "w:r");
      let searchStart = 0;

      for (const run of runs) {
        const runText = this.extractRunText(run);
        if (!runText) continue;

        if (!stylesResolver.resolveRunProps(paragraph.xml, run).sizeHalfPoints) {
          const start = paragraph.text.indexOf(runText, searchStart);
          warnings.push({
            code: "unresolved-run-size",
            message:
              `No se pudo resolver el tamaño de fuente de este run. Texto: ${runText}`,
            blockIndex: paragraph.blockIndex,
            ...(start >= 0
              ? {
                  start,
                  end: start + runText.length,
                  affectedText: runText,
                }
              : {}),
            status: "pendiente",
          });
        }
        const runStart = paragraph.text.indexOf(runText, searchStart);
        if (runStart >= 0) searchStart = runStart + runText.length;
      }
    }

    return warnings;
  }

  private collectUnknownWordWarnings(
    body: unknown,
    paragraphs: RawParagraph[]
  ): ParseWarning[] {
    const known = new Set([
      "w:body", "w:p", "w:r", "w:t", "w:pPr", "w:rPr", "w:pStyle",
      "w:sz", "w:b", "w:i", "w:vertAlign", "w:tab", "w:br",
      "w:noBreakHyphen", "w:softHyphen", "w:sym", "w:instrText",
      "w:fldChar", "w:fldSimple", "w:hyperlink", "w:footnoteReference",
      "w:endnoteReference", "w:del", "w:delText", "w:ins", "w:sdt",
      "w:sdtContent", "w:sdtPr", "w:tag", "w:lock", "w:tbl", "w:tblPr",
      "w:tblCaption", "w:tblGrid", "w:tblW", "w:tblBorders", "w:tr",
      "w:trPr", "w:tblHeader", "w:tc", "w:tcPr", "w:tcW", "w:gridSpan",
      "w:sectPr", "w:pgSz", "w:pgMar", "w:bookmarkStart", "w:bookmarkEnd",
      "w:proofErr", "w:smartTag", "w:customXml", "w:txbxContent",
      "w:drawing", "w:pict", "w:moveFrom", "w:moveTo", "w:moveFromRangeStart",
      "w:moveFromRangeEnd", "w:moveToRangeStart", "w:moveToRangeEnd",
      "w:numPr", "w:numId", "w:ilvl", "w:spacing", "w:ind", "w:jc",
      "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:tabs", "w:tab",
      "w:hyperlink", "w:color", "w:u", "w:strike", "w:caps", "w:smallCaps",
    ]);
    const warnings: ParseWarning[] = [];
    const visited = new Set<unknown>();
    const paragraphIndexes = new Map(
      paragraphs.map((paragraph) => [paragraph.xml, paragraph.blockIndex])
    );
    const visit = (node: unknown, blockIndex?: number): void => {
      if (Array.isArray(node)) {
        node.forEach((child) => visit(child, blockIndex));
        return;
      }
      const record = asXmlRecord(node);
      if (!record || visited.has(node)) return;
      visited.add(node);
      blockIndex = paragraphIndexes.get(node) ?? blockIndex;
      const name = getXmlName(node);
      if (name === "mc:Fallback" || name === "w:del") return;
      if (name === "mc:AlternateContent") {
        const choice = Array.isArray(record["mc:Choice"])
          ? record["mc:Choice"][0]
          : record["mc:Fallback"];
        if (choice) visit(choice, blockIndex);
        return;
      }
      if (name?.startsWith("w:") && !known.has(name)) {
        const text = this.extractRunText(node).trim();
        warnings.push({
          code: "unknown-ooxml-element",
          message: `Elemento OOXML no reconocido ${name}${text ? `; texto: ${text}` : ""}.`,
          ...(blockIndex !== undefined ? { blockIndex } : {}),
          status: "pendiente",
        });
      }
      for (const [key, value] of Object.entries(record)) {
        if (key !== ":@" && !key.startsWith("#")) {
          visit(value, blockIndex);
        }
      }
    };
    visit(body);
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

      const previous =
        normalized[normalized.length - 1];

      if (!previous || !this.canMergeRuns(previous, run)) {
        normalized.push({ ...run });
        continue;
      }

      if (previous.type !== "noteRef" && run.type !== "noteRef") {
        previous.text += run.text;
      }
    }

    return normalized;
  }

  private canMergeRuns(left: InlineRun, right: InlineRun): boolean {
    if (left.type !== right.type || left.type === "citation" || left.type === "noteRef") {
      return false;
    }
    if (right.type === "citation" || right.type === "noteRef") return false;
    return left.bold === right.bold &&
      left.italic === right.italic &&
      left.sizeHalfPoints === right.sizeHalfPoints &&
      (left.type !== "link" || (right.type === "link" && left.href === right.href)) &&
      (left.type !== "fieldCitation" ||
        (right.type === "fieldCitation" &&
          JSON.stringify(left.metadata) === JSON.stringify(right.metadata)));
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
    stylesResolver: StylesResolver,
    context: ParseContext,
    blockIndex: number,
    styleId: string | null
  ): InlineRun[] {
    const result: InlineRun[] = [];
    const visit = (
      node: unknown,
      run: unknown | null = null,
      hyperlink: string | null = null
    ): void => {
      if (Array.isArray(node)) {
        node.forEach((child) => visit(child, run, hyperlink));
        return;
      }
      if (typeof node === "string" || node === null) return;
      const record = asXmlRecord(node);
      if (!record) return;
      const name = getXmlName(node);
      if (name === "mc:Fallback" || name === "w:del") return;
      if (name === "w:txbxContent") return;
      if (name === "mc:AlternateContent") {
        const choice = Array.isArray(record["mc:Choice"])
          ? record["mc:Choice"][0]
          : record["mc:Fallback"];
        if (choice) visit(choice, run, hyperlink);
        return;
      }
      if (name === "w:r") {
        visit(record[name], node, hyperlink);
        return;
      }
      if (name === "w:fldSimple") {
        context.fields.push({
          instruction: getXmlAttribute(node, "w:instr") ?? "",
          separated: true,
          discarded: false,
        });
        visit(record[name], run, hyperlink);
        context.fields.pop();
        return;
      }
      if (name === "w:fldChar") {
        const type = getXmlAttribute(node, "w:fldCharType");
        if (type === "begin") {
          context.fields.push({
            instruction: "",
            separated: false,
            discarded: false,
          });
        } else if (type === "separate") {
          const field = context.fields[context.fields.length - 1];
          if (field) {
            field.separated = true;
            const command = field.instruction.trim().split(/\s+/)[0]
              ?.toUpperCase();
            const isLayoutField = /^(?:TOC|PAGEREF)$/.test(command ?? "") ||
              (headerRules.layoutFieldStylePatterns.some((pattern) =>
                pattern.test(styleId ?? "")
              ) &&
                /^(?:SEQ|PAGE|NUMPAGES|PAGEREF)$/.test(command ?? ""));
            field.discarded = isLayoutField;
            if (isLayoutField) {
              context.warnings.push({
                code: "layout-field-discarded",
                message: `Se descartó el resultado del campo de maquetación ${command}: ${field.instruction.trim()}`,
                blockIndex,
                status: "pendiente",
              });
            }
          }
        } else if (type === "end" && context.fields.length) {
          context.fields.pop();
        }
        return;
      }
      if (name === "w:instrText") {
        const field = context.fields[context.fields.length - 1];
        if (field) {
          const value = record[name];
          const text = typeof value === "string"
            ? value
            : Array.isArray(value)
              ? value.map((part) => {
                  const textNode = asXmlRecord(part);
                  return String(textNode?.["#text"] ?? "");
                }).join("")
              : "";
          field.instruction += text;
        }
        return;
      }
      if (name === "w:t") {
        const textNode = asXmlRecord(record[name]);
        const rawText = typeof record[name] === "string"
          ? record[name] as string
          : typeof textNode?.["#text"] === "string"
            ? textNode["#text"] as string
            : "";
        const normalized = normalizeVisibleText(rawText);
        if (normalized.changed) {
          context.warnings.push({
            code: "text-normalized",
            message: `Se normalizaron caracteres no estándar en el texto: ${rawText}`,
            blockIndex,
            status: "pendiente",
          });
        }
        appendText(normalized.text, run, hyperlink);
        return;
      }
      if (name === "w:tab") {
        appendText(" ", run, hyperlink);
        return;
      }
      if (name === "w:br") {
        appendText("\n", run, hyperlink);
        return;
      }
      if (name === "w:noBreakHyphen") {
        appendText("-", run, hyperlink);
        return;
      }
      if (name === "w:softHyphen") return;
      if (name === "w:sym") {
        const rawChar = getXmlAttribute(node, "w:char");
        const codePoint = rawChar ? Number.parseInt(rawChar, 16) : Number.NaN;
        if (Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
          appendText(String.fromCodePoint(codePoint), run, hyperlink);
        } else {
          context.warnings.push({
            code: "unresolved-symbol",
            message: `No se pudo resolver el símbolo OOXML ${rawChar ?? "(sin código)"}.`,
            blockIndex,
            status: "pendiente",
          });
        }
        return;
      }
      if (name === "w:footnoteReference" || name === "w:endnoteReference") {
        const id = readWId(node);
        if (id !== null) {
          result.push({
            type: "noteRef",
            noteId: id,
            noteType: name === "w:footnoteReference" ? "footnote" : "endnote",
          });
        }
        return;
      }
      if (name === "w:hyperlink") {
        const relId = getXmlAttribute(node, "r:id");
        const anchor = getXmlAttribute(node, "w:anchor");
        visit(
          record[name],
          run,
          relId ? context.hyperlinkTargets.get(relId) ?? null
            : anchor ? `#${anchor}` : hyperlink
        );
        return;
      }
      if (name === "w:delText") return;
      if (name === "w:ins") {
        visit(record[name], run, hyperlink);
        return;
      }
      for (const [key, value] of Object.entries(record)) {
        if (key !== ":@" && !key.startsWith("#")) {
          visit(value, run, hyperlink);
        }
      }
    };

    const appendText = (
      text: string,
      run: unknown | null,
      explicitHyperlink: string | null
    ): void => {
      if (!text) return;
      if (
        context.fields.some((field) => !field.separated || field.discarded)
      ) {
        return;
      }
      const fieldInstruction = context.fields
        .map((field) => field.instruction)
        .join(" ");
      const hyperlinkField = fieldInstruction.match(
        /\bHYPERLINK\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i
      );
      const anchorField = fieldInstruction.match(/\\l\s+"([^"]+)"/i);
      const href = explicitHyperlink ??
        hyperlinkField?.[1] ??
        hyperlinkField?.[2] ??
        hyperlinkField?.[3] ??
        (anchorField ? `#${anchorField[1]}` : null);
      const citationField = context.fields.some((field) =>
        /\b(?:ZOTERO_ITEM|MENDELEY)\b/i.test(field.instruction)
      );
      const metadata = citationField
        ? context.fields.map((field) => citationMetadata(field.instruction))
          .find((item) => item !== undefined)
        : undefined;
      const props = run
        ? stylesResolver.resolveRunProps(paragraph, run)
        : { bold: false, italic: false, sizeHalfPoints: null };
      const formatting = {
        ...(props.bold ? { bold: true } : {}),
        ...(props.italic ? { italic: true } : {}),
        ...(props.sizeHalfPoints
          ? { sizeHalfPoints: props.sizeHalfPoints }
          : {}),
      };
      if (citationField) {
        result.push({ type: "fieldCitation", text, metadata, ...formatting });
      } else if (href) {
        result.push({ type: "link", text, href, ...formatting });
      } else {
        result.push({ type: "text", text, ...formatting });
      }
    };

    visit(paragraph);
    return result;
  }

  private readHyperlinkTargets(
    relationshipsXml: string | null
  ): Map<string, string> {
    if (!relationshipsXml) return new Map();
    const relationships = this.xmlParser.parse(relationshipsXml);
    const targets = new Map<string, string>();
    for (const relationship of collectXmlNodes(relationships, "Relationship")) {
      const id = getXmlAttribute(relationship, "Id");
      const target = getXmlAttribute(relationship, "Target");
      if (id && target) targets.set(id, target);
    }
    return targets;
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
      if (name === "mc:Fallback" || name === "w:del" || name === "w:instrText" || name === "w:delText") {
        return "";
      }
      if (name === "w:txbxContent") return "";
      if (name === "mc:AlternateContent") {
        const choice = Array.isArray(record["mc:Choice"])
          ? record["mc:Choice"][0]
          : record["mc:Fallback"];
        return choice ? visit(choice) : "";
      }
      if (name === "w:tab") return " ";
      if (name === "w:br") return "\n";
      if (name === "w:noBreakHyphen") return "-";
      if (name === "w:softHyphen") return "";
      if (name === "w:sym") {
        const rawChar = getXmlAttribute(node, "w:char");
        const codePoint = rawChar ? Number.parseInt(rawChar, 16) : Number.NaN;
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : "";
      }
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
    return this.extractRunText(paragraph);
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
        const record = asXmlRecord(child);
        if (name === "w:del" || name === "mc:Fallback") continue;
        if (name === "w:sdt") {
          const content = findElement(child, "w:sdtContent");
          if (content) visit(content);
          continue;
        }
        if (name === "w:ins") {
          visit(record?.[name]);
          continue;
        }
        if (name === "mc:AlternateContent") {
          const choice = Array.isArray(record?.["mc:Choice"])
            ? record["mc:Choice"][0]
            : record?.["mc:Fallback"];
          if (choice) visit(choice);
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
    extractedBlocks: Map<number, BodyBlock[]>,
    parseContext: ParseContext
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

    const paragraphByIndex = new Map(
      paragraphs.map((paragraph) => [paragraph.blockIndex, paragraph])
    );
    const joinedBlocks: BodyBlock[] = [];
    const joinedSourceIndexes: number[] = [];
    for (let index = 0; index < bodyBlocks.length; index++) {
      const current = bodyBlocks[index];
      const currentSourceIndex = sourceBlockIndexes[index];
      const previous = joinedBlocks[joinedBlocks.length - 1];
      const previousSourceIndex =
        joinedSourceIndexes[joinedSourceIndexes.length - 1];
      const previousParagraph = paragraphByIndex.get(previousSourceIndex);
      const currentParagraph = paragraphByIndex.get(currentSourceIndex);
      if (
        headerRules.paragraphJoining.enabled &&
        previous?.type === "paragraph" &&
        current.type === "paragraph" &&
        previousParagraph &&
        currentParagraph &&
        previousParagraph.styleId === currentParagraph.styleId &&
        previousParagraph.sizeHalfPoints === currentParagraph.sizeHalfPoints
      ) {
        const previousText = previous.runs
          .filter((run) => run.type !== "noteRef")
          .map((run) => run.text)
          .join("")
          .trimEnd();
        const currentText = current.runs
          .filter((run) => run.type !== "noteRef")
          .map((run) => run.text)
          .join("")
          .trimStart();
        const startsLowercase =
          headerRules.paragraphJoining.startsLowercase.test(currentText);
        if (
          previousText &&
          currentText &&
          !headerRules.paragraphJoining.terminalPunctuation.test(previousText) &&
          startsLowercase
        ) {
          previous.runs.push({ type: "text", text: " " });
          previous.runs.push(...current.runs);
          parseContext.warnings.push({
            code: "paragraphs-joined",
            message: `Se unieron estos fragmentos de párrafo: "${previousText}" + "${currentText}"`,
            blockIndex: previousSourceIndex,
            status: "pendiente",
          });
          continue;
        }
      }
      joinedBlocks.push(current);
      joinedSourceIndexes.push(currentSourceIndex);
    }

    const deduplicatedBlocks: BodyBlock[] = [];
    const deduplicatedSourceIndexes: number[] = [];
    for (let index = 0; index < joinedBlocks.length; index++) {
      const block = joinedBlocks[index];
      const previous = deduplicatedBlocks[deduplicatedBlocks.length - 1];
      if (
        previous &&
        JSON.stringify(previous) === JSON.stringify(block)
      ) {
        parseContext.warnings.push({
          code: "duplicate-block-removed",
          message: `Se eliminó un bloque consecutivo idéntico duplicado: ${this.bodyBlockText(block)}`,
          blockIndex: joinedSourceIndexes[index],
          status: "pendiente",
        });
        continue;
      }
      deduplicatedBlocks.push(block);
      deduplicatedSourceIndexes.push(joinedSourceIndexes[index]);
    }

    return {
      blocks: deduplicatedBlocks,
      sourceBlockIndexes: deduplicatedSourceIndexes,
    };
  }

  private bodyBlockText(block: BodyBlock): string {
    if ("runs" in block) {
      return block.runs
        .filter((run) => run.type !== "noteRef")
        .map((run) => run.text)
        .join("");
    }
    if (block.type === "table") {
      return [...block.headers, ...block.rows.flat()].join(" ");
    }
    if (block.type === "image") return block.caption ?? block.alt ?? block.fileName;
    return "";
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