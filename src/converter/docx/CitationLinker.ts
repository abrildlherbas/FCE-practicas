import { citationRules } from "../config/citation-rules";
import type {
  BodyBlock,
  CitationMetadata,
  InlineRun,
  ParseWarning,
  Reference,
} from "../models/Article";

export interface CitationLinkResult {
  body: BodyBlock[];
  warnings: ParseWarning[];
}

interface Match {
  start: number;
  end: number;
  reference: Reference | null;
  warning?: ParseWarning;
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

function firstSurname(value: string): string {
  return value
    .replace(/^\s*&?\s*/, "")
    .split(/[\s,]+/)[0]
    ?.replace(/[.]+$/, "") ?? "";
}

function citationAuthors(value: string): string[] {
  const withoutEtAl = value.replace(/\s+et\s+al\.?$/iu, "").trim();
  const names = withoutEtAl
    .split(citationRules.authorSeparators)
    .map(firstSurname)
    .filter(Boolean);
  return names;
}

function referenceYear(reference: Reference): string | null {
  const year = reference.year?.toString();
  if (year) return year;
  return reference.raw.match(/\(((?:19|20)\d{2}[a-z]?)\)/iu)?.[1] ?? null;
}

function findSurname(
  text: string,
  surname: string,
  searchStart: number
): number {
  let index = text.indexOf(surname, searchStart);
  while (index >= 0) {
    const previous = index > 0 ? text[index - 1] : "";
    const next = text[index + surname.length] ?? "";
    const startsAtWordBoundary = !previous || !/\p{L}/u.test(previous);
    const endsAtWordBoundary = !next || !/\p{L}/u.test(next);
    if (startsAtWordBoundary && endsAtWordBoundary) return index;
    index = text.indexOf(surname, index + 1);
  }
  return -1;
}

function matchesReference(
  authorNames: string[],
  year: string,
  references: Reference[]
): Reference[] {
  return references.filter((reference) => {
    const referenceYearValue = referenceYear(reference);
    if (!referenceYearValue || normalized(referenceYearValue) !== normalized(year)) {
      return false;
    }

    const yearIndex = reference.raw.search(/\(((?:19|20)\d{2}[a-z]?)\)/iu);
    const authorText =
      yearIndex < 0 ? reference.raw : reference.raw.slice(0, yearIndex);
    const normalizedAuthorText = normalized(authorText);
    let previousIndex = -1;

    return authorNames.every((authorName, index) => {
      const searchStart = index === 0 ? 0 : previousIndex + 1;
      const authorIndex = findSurname(
        normalizedAuthorText,
        normalized(authorName),
        searchStart
      );
      if (authorIndex < 0 || (index === 0 && authorIndex !== 0)) return false;
      previousIndex = authorIndex;
      return true;
    });
  });
}

function matchesCitationMetadata(
  metadata: CitationMetadata | undefined,
  references: Reference[]
): Reference[] {
  if (!metadata) return [];
  let candidates = references;
  if (metadata.year !== undefined) {
    candidates = candidates.filter(
      (reference) => referenceYear(reference) === String(metadata.year)
    );
  }
  if (metadata.authors?.length) {
    candidates = candidates.filter((reference) => {
      if (metadata.year !== undefined) {
        return matchesReference(metadata.authors!, String(metadata.year), [
          reference,
        ]).length === 1;
      }
      const authorText = normalized(
        (reference.authors ?? [reference.raw])[0] ?? reference.raw
      );
      return metadata.authors!.every((author) =>
        authorText.includes(normalized(firstSurname(author)))
      );
    });
  }
  if (metadata.title) {
    const title = normalized(metadata.title);
    candidates = candidates.filter((reference) =>
      normalized(reference.raw).includes(title)
    );
  }
  return candidates;
}

function makeMatch(
  start: number,
  end: number,
  authorText: string,
  year: string,
  references: Reference[],
  blockIndex: number
): Match {
  const authorNames = citationAuthors(authorText);
  const candidates = matchesReference(authorNames, year, references);

  if (candidates.length === 1) {
    return { start, end, reference: candidates[0] };
  }

  const text = `${authorText}, ${year}`;
  return {
    start,
    end,
    reference: null,
    warning: {
      code: candidates.length > 1
        ? "ambiguous-citation"
        : "unmatched-citation",
      message: candidates.length > 1
        ? `La cita coincide con más de una referencia y quedó sin enlazar: ${text}`
        : `No se encontró una referencia para la cita y quedó sin enlazar: ${text}`,
      blockIndex,
      status: "pendiente",
    },
  };
}

function citationMatches(
  text: string,
  references: Reference[],
  blockIndex: number
): Match[] {
  const matches: Match[] = [];
  const parentheticalRanges: Array<[number, number]> = [];
  const parentheticalPattern = new RegExp(
    citationRules.parentheticalPattern.source,
    citationRules.parentheticalPattern.flags
  );
  let group: RegExpExecArray | null;

  while ((group = parentheticalPattern.exec(text)) !== null) {
    const groupStart = group.index + 1;
    const groupText = group[1];
    parentheticalRanges.push([group.index, group.index + group[0].length]);
    let offset = 0;

    for (const part of groupText.split(";")) {
      const leadingWhitespace = part.length - part.trimStart().length;
      const trimmed = part.trim();
      const segment = citationRules.segmentPattern.exec(trimmed);
      if (!segment) {
        if (
          /\b(?:19|20)\d{2}[a-z]?\b/iu.test(trimmed) &&
          !/^(?:19|20)\d{2}[a-z]?$/iu.test(trimmed)
        ) {
          matches.push({
            start: groupStart + offset + leadingWhitespace,
            end: groupStart + offset + leadingWhitespace + trimmed.length,
            reference: null,
            warning: {
              code: "ambiguous-citation",
              message: `No se pudo identificar con seguridad el autor de la cita: ${trimmed}`,
              blockIndex,
              status: "pendiente",
            },
          });
        }
      } else {
        const authorStart = groupStart + offset + leadingWhitespace;
        matches.push(makeMatch(
          authorStart,
          authorStart + trimmed.length,
          segment[1],
          segment[2],
          references,
          blockIndex
        ));
      }
      offset += part.length + 1;
    }
  }

  const narrativePattern = new RegExp(
    citationRules.narrativePattern.source,
    citationRules.narrativePattern.flags
  );
  let narrative: RegExpExecArray | null;
  while ((narrative = narrativePattern.exec(text)) !== null) {
    if (
      parentheticalRanges.some(
        ([start, end]) => narrative!.index >= start && narrative!.index < end
      )
    ) {
      continue;
    }
    const authorText = narrative[1];
    if (!authorText) continue;
    const citationStart = narrative.index;
    const year = narrative[2];
    const start = citationStart;
    const end = narrative.index + narrative[0].length;
    const result = makeMatch(
      start,
      end,
      authorText,
      year,
      references,
      blockIndex
    );
    matches.push(result);
  }

  return matches.sort((left, right) => left.start - right.start);
}

function isTextRun(run: InlineRun): run is Extract<InlineRun, { type: "text" }> {
  return run.type === "text";
}

export class CitationLinker {
  link(body: BodyBlock[], references: Reference[]): CitationLinkResult {
    const warnings: ParseWarning[] = [];
    const citationCounts = new Map<string, number>();
    const citedReferences = new Set<string>();
    const linkedBody = body.map((block, blockIndex) => {
      if (!("runs" in block)) return block;

      const output: InlineRun[] = [];
      let textGroup: Extract<InlineRun, { type: "text" }>[] = [];

      const flushTextGroup = (): void => {
        if (!textGroup.length) return;
        const text = textGroup.map((run) => run.text).join("");
        const matches = citationMatches(text, references, blockIndex);
        let cursor = 0;

        const appendText = (start: number, end: number): void => {
          if (start >= end) return;
          let position = start;
          let runStart = 0;
          for (const run of textGroup) {
            const runEnd = runStart + run.text.length;
            const overlapStart = Math.max(position, runStart);
            const overlapEnd = Math.min(end, runEnd);
            if (overlapStart < overlapEnd) {
              output.push({
                ...run,
                text: run.text.slice(overlapStart - runStart, overlapEnd - runStart),
              });
              position = overlapEnd;
            }
            runStart = runEnd;
            if (position >= end) break;
          }
        };

        for (const match of matches) {
          if (match.start < cursor || match.end <= match.start) continue;
          appendText(cursor, match.start);
          if (match.warning) warnings.push(match.warning);
          if (match.reference) {
            const referenceNumber = Number(
              match.reference.id.match(/(\d+)$/)?.[1] ?? 0
            );
            const occurrence =
              (citationCounts.get(match.reference.id) ?? 0) + 1;
            citationCounts.set(match.reference.id, occurrence);
            citedReferences.add(match.reference.id);
            const sourceRun = textGroup.find((run, index) => {
              const runStart = textGroup
                .slice(0, index)
                .reduce((total, item) => total + item.text.length, 0);
              return runStart <= match.start && runStart + run.text.length > match.start;
            });
            output.push({
              type: "citation",
              text: text.slice(match.start, match.end),
              referenceId: match.reference.id,
              citationId: `revista-cita-${referenceNumber}-${occurrence}`,
              bold: sourceRun?.bold,
              italic: sourceRun?.italic,
            });
          } else {
            appendText(match.start, match.end);
          }
          cursor = match.end;
        }
        appendText(cursor, text.length);
        textGroup = [];
      };

      for (const run of block.runs) {
        if (isTextRun(run)) {
          textGroup.push(run);
        } else {
          flushTextGroup();
          if (run.type === "fieldCitation") {
            const candidates = matchesCitationMetadata(
              run.metadata,
              references
            );
            if (candidates.length === 1) {
              const reference = candidates[0];
              const referenceNumber = Number(
                reference.id.match(/(\d+)$/)?.[1] ?? 0
              );
              const occurrence =
                (citationCounts.get(reference.id) ?? 0) + 1;
              citationCounts.set(reference.id, occurrence);
              citedReferences.add(reference.id);
              output.push({
                type: "citation",
                text: run.text,
                referenceId: reference.id,
                citationId: `revista-cita-${referenceNumber}-${occurrence}`,
                metadata: run.metadata,
                bold: run.bold,
                italic: run.italic,
              });
            } else {
              output.push(run);
              if (run.metadata) {
                warnings.push({
                  code: candidates.length > 1
                    ? "ambiguous-citation"
                    : "unmatched-citation",
                  message: candidates.length > 1
                    ? `Los metadatos de la cita coinciden con más de una referencia: ${run.text}`
                    : `No se encontró una referencia para los metadatos de la cita: ${run.text}`,
                  blockIndex,
                  status: "pendiente",
                });
              }
            }
          } else {
            output.push(run);
          }
        }
      }
      flushTextGroup();
      return { ...block, runs: output };
    });

    for (const reference of references) {
      if (citedReferences.has(reference.id)) continue;
      warnings.push({
        code: "uncited-reference",
        message: `La referencia no tiene citas detectadas en el texto: ${reference.raw}`,
        status: "pendiente",
      });
    }

    return { body: linkedBody, warnings };
  }
}
