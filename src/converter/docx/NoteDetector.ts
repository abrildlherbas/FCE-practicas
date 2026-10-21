import { Note, ParseWarning, Reference } from "../models/Article";
import { noteRules } from "../config/note-rules";

export interface NoteParagraph {
  blockIndex: number;
  text: string;
  sizeHalfPoints: string | null;
  hasSuperscriptPrefix: boolean;
}

export interface NoteDetectionResult {
  notes: Note[];
  references: Reference[];
  consumedNoteBlockIndexes: Set<number>;
  referenceBlockIndexes: Set<number>;
  referenceHeadingBlockIndex: number | null;
  warnings: ParseWarning[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolvedSize(paragraph: NoteParagraph): number | null {
  if (paragraph.sizeHalfPoints === null) return null;
  const size = Number(paragraph.sizeHalfPoints);
  return Number.isFinite(size) ? size : null;
}

function extractReference(raw: string): Reference {
  const doiMatch = noteRules.doiPattern.exec(raw);
  const authorYearMatch = noteRules.authorYearPattern.exec(raw);
  const authorText = authorYearMatch?.[1].trim();
  const hasRecognizableAuthor =
    authorText !== undefined &&
    noteRules.surnamePattern.test(authorText);
  const authors = hasRecognizableAuthor
    ? authorText
        .split(/\s*(?:;|&| y | and )\s*/i)
        .map((author) => author.trim())
        .filter(Boolean)
    : undefined;

  const reference: Reference = { raw };
  if (authors?.length) reference.authors = authors;
  if (authorYearMatch && hasRecognizableAuthor) {
    const year = Number.parseInt(authorYearMatch[2], 10);
    if (Number.isFinite(year)) reference.year = year;
  }
  if (doiMatch) {
    reference.doi = doiMatch[1].replace(/[.,;]+$/, "");
  }

  return reference;
}

function noteTextWithoutMarker(
  text: string,
  hasSuperscriptPrefix: boolean
): string {
  for (const pattern of noteRules.noteStartPatterns) {
    if (pattern.test(text)) return text.replace(pattern, "").trim();
  }

  if (hasSuperscriptPrefix) {
    return text
      .replace(noteRules.superscriptNoteStartPattern, "")
      .trim();
  }

  return text;
}

export class NoteDetector {
  detect(
    paragraphs: NoteParagraph[],
    nativeNotes: Note[],
    bodyStartBlockIndex: number | null
  ): NoteDetectionResult {
    const notes = [...nativeNotes];
    const consumedNoteBlockIndexes = new Set<number>();
    const referenceBlockIndexes = new Set<number>();
    const warnings: ParseWarning[] = [];
    const referenceHeadingIndex = paragraphs.findIndex((paragraph) =>
      noteRules.referenceHeadingPatterns.some((pattern) =>
        pattern.test(normalizedText(paragraph.text))
      )
    );
    const referenceHeadingBlockIndex =
      referenceHeadingIndex < 0
        ? null
        : paragraphs[referenceHeadingIndex].blockIndex;

    const referenceParagraphs =
      referenceHeadingIndex < 0
        ? []
        : paragraphs.slice(referenceHeadingIndex + 1);

    for (const paragraph of referenceParagraphs) {
      const raw = normalizedText(paragraph.text);
      referenceBlockIndexes.add(paragraph.blockIndex);
      if (!raw) continue;

      const reference = extractReference(raw);
      if (reference.authors === undefined && reference.doi === undefined) {
        warnings.push({
          code: "unclassified-reference",
          message:
            "La entrada de referencias se conserva como texto, pero no se pudieron reconocer autor, año ni DOI.",
          blockIndex: paragraph.blockIndex,
        });
      }
    }

    const references: Reference[] = [];

    for (const paragraph of referenceParagraphs) {
      const raw = normalizedText(paragraph.text);
      if (!raw) continue;

      if (/^https?:\/\//i.test(raw) && references.length > 0) {
        references[references.length - 1].raw += ` ${raw}`;
        const last = references[references.length - 1];
        const doiMatch = noteRules.doiPattern.exec(last.raw);
        if (doiMatch) {
          last.doi = doiMatch[1].replace(/[.,;]+$/, "");
        }
        continue;
      }

      references.push(extractReference(raw));
    }

    if (nativeNotes.length === 0) {
      const contentSizes = paragraphs
        .filter((paragraph) => {
          const text = normalizedText(paragraph.text);
          return (
            text.length > 0 &&
            paragraph.blockIndex >= (bodyStartBlockIndex ?? 0) &&
            !referenceBlockIndexes.has(paragraph.blockIndex)
          );
        })
        .map(resolvedSize)
        .filter((size): size is number => size !== null);
      const bodySize = median(contentSizes);

      if (bodySize !== null) {
        for (const paragraph of paragraphs) {
          if (
            paragraph.blockIndex < (bodyStartBlockIndex ?? 0) ||
            referenceBlockIndexes.has(paragraph.blockIndex)
          ) {
            continue;
          }

          const text = normalizedText(paragraph.text);
          if (!text) continue;

          const hasNumberPrefix = noteRules.noteStartPatterns.some(
            (pattern) => pattern.test(text)
          );
          const hasSuperscriptPrefix =
            paragraph.hasSuperscriptPrefix &&
            noteRules.superscriptNoteStartPattern.test(text);

          const size = resolvedSize(paragraph);
          if (size === null || size >= bodySize) {
            if (hasNumberPrefix || hasSuperscriptPrefix) {
              warnings.push({
                code: "ambiguous-note-size",
                message:
                  "El párrafo tiene un posible marcador de nota, pero no se pudo confirmar que su tamaño sea menor al del cuerpo.",
                blockIndex: paragraph.blockIndex,
              });
            }
            continue;
          }

          if (hasNumberPrefix || hasSuperscriptPrefix) {
            const noteText = noteTextWithoutMarker(
              text,
              hasSuperscriptPrefix
            );

            if (!noteText) {
              warnings.push({
                code: "ambiguous-note",
                message:
                  "Se encontró un marcador de nota sin texto reconocible.",
                blockIndex: paragraph.blockIndex,
              });
              continue;
            }

            notes.push({
              id: notes.length + 1,
              type: "footnote",
              text: noteText,
              anchor: {
                blockIndex: paragraph.blockIndex,
                offset: 0,
              },
            });
            consumedNoteBlockIndexes.add(paragraph.blockIndex);
          } else if (paragraph.hasSuperscriptPrefix) {
            warnings.push({
              code: "ambiguous-note",
              message:
                "El párrafo tiene texto en superíndice y tamaño menor al cuerpo, pero no se pudo identificar su marcador de nota.",
              blockIndex: paragraph.blockIndex,
            });
          }
        }
      }
    }

    return {
      notes,
      references,
      consumedNoteBlockIndexes,
      referenceBlockIndexes,
      referenceHeadingBlockIndex,
      warnings,
    };
  }
}
