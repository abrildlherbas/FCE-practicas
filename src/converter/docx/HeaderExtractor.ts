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

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseAffiliation(
  text: string,
  fallbackId: string
): { id: string; text: string } | null {
  const markerMatch = text.match(
    /^\s*\[?([ivxlcdm]+)\]?(?:\s+|(?=[A-Z]))(.+)/
  ) ?? text.match(
    /^\s*\[?([IVXLCDM]+)\]?\s+(.+)/
  );
  if (markerMatch) {
    return {
      id: markerMatch[1].toLowerCase(),
      text: normalizeText(markerMatch[2]),
    };
  }

  const labeledMatch = text.match(
    /^(?:afiliaci[oó]n|affiliation)\s*:\s*(.+)$/i
  );
  if (labeledMatch) {
    return { id: fallbackId, text: normalizeText(labeledMatch[1]) };
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAuthor(
  rawName: string,
  affiliationIds: Set<string>,
  orcid?: string
): Article["header"]["authors"][number] {
  let name = normalizeText(rawName).replace(/[,.;\s]+$/, "");
  const affiliationId = [...affiliationIds]
    .sort((left, right) => right.length - left.length)
    .find((id) =>
      new RegExp(`[\\s,.;]*${escapeRegExp(id)}$`, "i").test(name)
    );

  if (affiliationId) {
    name = name.replace(
      new RegExp(`[\\s,.;]*${escapeRegExp(affiliationId)}$`, "i"),
      ""
    );
  }

  return {
    name,
    affiliations: affiliationId ? [affiliationId] : [],
    ...(orcid ? { orcid } : {}),
  };
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
      keywords_en: [],
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
    const affiliationIds = new Set<string>();
    let fallbackAffiliationIndex = 1;
    for (const paragraph of candidates) {
      const affiliation = parseAffiliation(
        normalizeText(paragraph.text),
        `affiliation-${fallbackAffiliationIndex}`
      );
      if (affiliation) {
        affiliationIds.add(affiliation.id);
        fallbackAffiliationIndex++;
      }
    }
    const titleIndex = this.findTitleIndex(candidates);

    if (titleIndex >= 0) {
      header.title = normalizeText(candidates[titleIndex].text);
      consumedBlockIndexes.add(candidates[titleIndex].blockIndex);

      let capturedEnglishTitle = false;
      for (let index = titleIndex + 1; index < candidates.length; index++) {
        const paragraph = candidates[index];
        const size = sizeValue(paragraph.sizeHalfPoints);
        if (
          size !== null &&
          size >= headerRules.titleMinimumSizeHalfPoints &&
          !isMetadata(paragraph.text)
        ) {
          if (!capturedEnglishTitle) {
            header.title_en = normalizeText(paragraph.text);
            capturedEnglishTitle = true;
          } else {
            header.title_en = normalizeText(
              `${header.title_en} ${paragraph.text}`
            );
          }
          consumedBlockIndexes.add(paragraph.blockIndex);
          continue;
        }
        break;
      }
    }

    let abstractLanguage: "es" | "en" | null = null;
    let authorCollectionStarted = titleIndex >= 0;
    const abstractParagraphs: Record<"es" | "en", string[]> = {
      es: [],
      en: [],
    };

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
        abstractLanguage = /^resumen\b/i.test(text) ? "es" : "en";
        consumedBlockIndexes.add(paragraph.blockIndex);
        if (abstractMatch[1]) {
          abstractParagraphs[abstractLanguage].push(abstractMatch[1]);
        }
        continue;
      }

      const keywordMatch = matchPatterns(
        text,
        headerRules.keywordPatterns
      );
      if (keywordMatch) {
        if (/^(?:key\s*words|keywords)\b/i.test(text)) {
          appendUnique(header.keywords_en, splitList(keywordMatch[1]));
        } else {
          appendUnique(header.keywords, splitList(keywordMatch[1]));
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractLanguage = null;
        continue;
      }

      const jelMatch = matchPatterns(text, headerRules.jelPatterns);
      if (jelMatch) {
        if (header.jel_codes.length === 0) {
          header.jel_codes = splitList(jelMatch[1]);
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractLanguage = null;
        continue;
      }

      const affiliation = parseAffiliation(
        text,
        `affiliation-${header.affiliations.length + 1}`
      );
      if (
        affiliation &&
        matchPatterns(text, headerRules.affiliationPatterns)
      ) {
        if (!header.affiliations.some((item) => item.id === affiliation.id)) {
          header.affiliations.push(affiliation);
        } else {
          const existing = header.affiliations.find(
            (item) => item.id === affiliation.id
          );
          if (existing && !existing.text.includes(affiliation.text)) {
            existing.text = normalizeText(
              `${existing.text} ${affiliation.text}`
            );
          }
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        authorCollectionStarted = false;
        continue;
      }

      const authorMatch = matchPatterns(text, headerRules.authorPatterns);
      if (authorMatch) {
        header.authors.push(
          ...splitList(authorMatch[1]).map((name) =>
            parseAuthor(name, affiliationIds)
          )
        );
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
        abstractLanguage = null;
        continue;
      }

      const acceptedMatch = matchPatterns(
        text,
        headerRules.acceptedPatterns
      );
      if (acceptedMatch) {
        header.dates.accepted = normalizeText(acceptedMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractLanguage = null;
        continue;
      }

      const publishedMatch = matchPatterns(
        text,
        headerRules.publishedPatterns
      );
      if (publishedMatch) {
        header.dates.published = normalizeText(publishedMatch[1]);
        consumedBlockIndexes.add(paragraph.blockIndex);
        abstractLanguage = null;
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
        const authorText = text.slice(0, orcidMatch.index);
        if (authorText && authorCollectionStarted) {
          header.authors.push(
            parseAuthor(authorText, affiliationIds, orcidMatch[1])
          );
        }
        consumedBlockIndexes.add(paragraph.blockIndex);
        continue;
      }

      if (isBodyHeading(text)) {
        break;
      }

      if (abstractLanguage) {
        abstractParagraphs[abstractLanguage].push(text);
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
        header.authors.push(parseAuthor(text, affiliationIds));
        consumedBlockIndexes.add(paragraph.blockIndex);
      }
    }

    header.abstract = normalizeText(abstractParagraphs.es.join(" "));
    header.abstract_en = normalizeText(abstractParagraphs.en.join(" "));

    const values: Record<string, boolean> = {
      title: Boolean(header.title || header.title_en),
      authors: header.authors.length > 0,
      affiliations: header.affiliations.length > 0,
      abstract: Boolean(header.abstract || header.abstract_en),
      keywords: header.keywords.length > 0 || header.keywords_en.length > 0,
      jel_codes: header.jel_codes.length > 0,
      dates: Object.values(header.dates).some(Boolean),
    };

    for (const [field, message] of missingFieldWarnings) {
      if (!values[field]) {
        warnings.push({
          code: `header-missing-${field}`,
          message,
          status: "pendiente",
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
