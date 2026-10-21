import { Article, ParseWarning } from "../models/Article";
import { headerRules } from "../config/header-rules";

export interface HeaderParagraph {
  blockIndex: number;
  text: string;
  styleId: string | null;
  sizeHalfPoints: string | null;
}

export interface HeaderExtraction {
  header: Article["header"];
  consumedBlockIndexes: Set<number>;
  warnings: ParseWarning[];
}

const missingFieldWarnings = [
  ["title", "No se detectó el título del artículo."],
  ["authors", "No se detectaron autores."],
  ["affiliations", "No se detectaron afiliaciones."],
  ["abstract", "No se detectó el resumen."],
  ["keywords", "No se detectaron palabras clave."],
  ["jel_codes", "No se detectaron códigos JEL."],
  ["dates", "No se detectaron fechas editoriales."],
] as const;

function matchPatterns(
  text: string,
  patterns: readonly RegExp[]
): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match;
  }

  return null;
}

function splitList(value: string): string[] {
  return value
    .replace(/[.!]\s*$/, "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBodyHeading(text: string): boolean {
  return headerRules.bodyHeadingPatterns.some((pattern) =>
    pattern.test(text)
  );
}

function isMetadata(text: string): boolean {
  return Boolean(
    matchPatterns(text, [
      ...headerRules.keywordPatterns,
      ...headerRules.jelPatterns,
      ...headerRules.receivedPatterns,
      ...headerRules.acceptedPatterns,
      ...headerRules.publishedPatterns,
      ...headerRules.sectionPatterns,
      ...headerRules.affiliationPatterns,
      ...headerRules.authorPatterns,
    ]) ||
      headerRules.abstractPatterns.some((pattern) =>
        pattern.test(text)
      )
  );
}

function sizeValue(size: string | null): number | null {
  if (size === null) return null;
  const parsed = Number(size);
  return Number.isFinite(parsed) ? parsed : null;
}

export class HeaderExtractor {
  extract(paragraphs: HeaderParagraph[]): HeaderExtraction {
    const header: Article["header"] = {
      title: "",
      authors: [],
      affiliations: [],
      abstract: "",
      keywords: [],
      jel_codes: [],
      dates: {
        received: "",
        accepted: "",
        published: "",
      },
    };
    const consumedBlockIndexes = new Set<number>();
    const warnings: ParseWarning[] = [];
    const candidates = paragraphs.slice(0, headerRules.maxHeaderBlocks);
    const titleIndex = this.findTitleIndex(candidates);

    if (titleIndex >= 0) {
      header.title = normalizeText(candidates[titleIndex].text);
      consumedBlockIndexes.add(candidates[titleIndex].blockIndex);

      for (let index = titleIndex + 1; index < candidates.length; index++) {
        const paragraph = candidates[index];
        const size = sizeValue(paragraph.sizeHalfPoints);
        if (
          size !== null &&
          size >= headerRules.titleMinimumSizeHalfPoints &&
          !isMetadata(paragraph.text)
        ) {
          consumedBlockIndexes.add(paragraph.blockIndex);
          continue;
        }
        break;
      }
    }

    let abstractStarted = false;
    let captureAbstract = false;
    let authorCollectionStarted = titleIndex >= 0;
    const abstractParagraphs: string[] = [];

    for (const paragraph of candidates) {
      if (consumedBlockIndexes.has(paragraph.blockIndex)) {
        continue;
      }

      const text = normalizeText(paragraph.text);
      if (!text) continue;

      const abstractMatch = matchPatterns(
        text,
        headerRules.abstractPatterns
      );
      if (abstractMatch) {
        abstractStarted = true;
        captureAbstract = abstractParagraphs.length === 0;
        consumedBlockIndexes.add(paragraph.blockIndex);
        if (captureAbstract && abstractMatch[1]) {
          abstractParagraphs.push(abstractMatch[1]);
        }
        continue;
      }

      const keywordMatch = matchPatterns(
        text,
        headerRules.keywordPatterns
      );
      if (keywordMatch) {
        if (header.keywords.length === 0) {
          header.keywords = splitList(keywordMatch[1]);
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractStarted = false;
        captureAbstract = false;
        continue;
      }

      const jelMatch = matchPatterns(text, headerRules.jelPatterns);
      if (jelMatch) {
        if (header.jel_codes.length === 0) {
          header.jel_codes = splitList(jelMatch[1]);
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractStarted = false;
        captureAbstract = false;
        continue;
      }

      const affiliationMatch = matchPatterns(
        text,
        headerRules.affiliationPatterns
      );
      if (affiliationMatch) {
        header.affiliations.push(normalizeText(affiliationMatch[1]));
        consumedBlockIndexes.add(paragraph.blockIndex);
        authorCollectionStarted = false;
        continue;
      }

      const authorMatch = matchPatterns(text, headerRules.authorPatterns);
      if (authorMatch) {
        header.authors.push(...splitList(authorMatch[1]));
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      const receivedMatch = matchPatterns(
        text,
        headerRules.receivedPatterns
      );
      if (receivedMatch) {
        header.dates.received = normalizeText(receivedMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractStarted = false;
        captureAbstract = false;
        continue;
      }

      const acceptedMatch = matchPatterns(
        text,
        headerRules.acceptedPatterns
      );
      if (acceptedMatch) {
        header.dates.accepted = normalizeText(acceptedMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractStarted = false;
        captureAbstract = false;
        continue;
      }

      const publishedMatch = matchPatterns(
        text,
        headerRules.publishedPatterns
      );
      if (publishedMatch) {
        header.dates.published = normalizeText(publishedMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractStarted = false;
        captureAbstract = false;
        continue;
      }

      const sectionMatch = matchPatterns(
        text,
        headerRules.sectionPatterns
      );
      if (sectionMatch) {
        header.section = normalizeText(sectionMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      const doiMatch = matchPatterns(text, headerRules.doiPatterns);
      if (doiMatch) {
        header.doi = doiMatch[1].replace(/[.,;]+$/, "");
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      const orcidMatch = headerRules.orcidPattern.exec(text);
      if (orcidMatch) {
        header.orcid ??= orcidMatch[1];
        const authorText = normalizeText(
          text.slice(0, orcidMatch.index).replace(/[,.;\s]+$/, "")
        );
        if (authorText && authorCollectionStarted) {
          header.authors.push(authorText);
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      if (isBodyHeading(text)) {
        break;
      }

      if (abstractStarted) {
        if (captureAbstract) abstractParagraphs.push(text);
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      if (
        authorCollectionStarted &&
        paragraph.blockIndex > (titleIndex >= 0
          ? candidates[titleIndex].blockIndex
          : -1) &&
        !isMetadata(text) &&
        !headerRules.orcidPattern.test(text) &&
        text.length <= 180
      ) {
        header.authors.push(text.replace(/[,.;\s]+$/, ""));
        consumedBlockIndexes.add(paragraph.blockIndex);
      }
    }

    header.abstract = normalizeText(abstractParagraphs.join(" "));

    const values: Record<string, boolean> = {
      title: Boolean(header.title),
      authors: header.authors.length > 0,
      affiliations: header.affiliations.length > 0,
      abstract: Boolean(header.abstract),
      keywords: header.keywords.length > 0,
      jel_codes: header.jel_codes.length > 0,
      dates: Object.values(header.dates).some(Boolean),
    };

    for (const [field, message] of missingFieldWarnings) {
      if (!values[field]) {
        warnings.push({
          code: `header-missing-${field}`,
          message,
        });
      }
    }

    return { header, consumedBlockIndexes, warnings };
  }

  private findTitleIndex(paragraphs: HeaderParagraph[]): number {
    const firstBodyHeadingIndex = paragraphs.findIndex((paragraph) =>
      isBodyHeading(normalizeText(paragraph.text))
    );
    const searchEnd =
      firstBodyHeadingIndex === -1
        ? paragraphs.length
        : firstBodyHeadingIndex;

    for (let index = 0; index < searchEnd; index++) {
      const paragraph = paragraphs[index];
      const text = normalizeText(paragraph.text);
      if (!text || isMetadata(text)) continue;
      const styleId = paragraph.styleId;

      if (
        styleId &&
        headerRules.titleStylePatterns.some((pattern) =>
          pattern.test(styleId)
        )
      ) {
        return index;
      }

      const size = sizeValue(paragraph.sizeHalfPoints);
      if (
        size !== null &&
        size >= headerRules.titleMinimumSizeHalfPoints
      ) {
        return index;
      }
    }

    return -1;
  }
}
