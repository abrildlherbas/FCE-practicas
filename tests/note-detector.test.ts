import { describe, expect, it } from "vitest";

import { NoteDetector } from "../src/converter/docx/NoteDetector";

describe("NoteDetector", () => {
  it("detecta notas cortas numeradas y extrae referencias de una sección", () => {
    const result = new NoteDetector().detect(
      [
        {
          blockIndex: 0,
          text: "Introducción",
          sizeHalfPoints: "32",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 1,
          text: "El texto principal del cuerpo del artículo.",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 2,
          text: "[1] Nota aclaratoria.",
          sizeHalfPoints: "18",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 3,
          text: "Más contenido del cuerpo.",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 4,
          text: "Referencias bibliográficas",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 5,
          text: "Smith, J. (2020). Un estudio. https://doi.org/10.1234/example",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 6,
          text: "Entrada de referencia no reconocida",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
      ],
      [],
      0
    );

    expect(result.notes).toEqual([
      {
        id: 1,
        type: "footnote",
        text: "Nota aclaratoria.",
        anchor: { blockIndex: 2, offset: 0 },
      },
    ]);
    expect(result.consumedNoteBlockIndexes.has(2)).toBe(true);
    expect(result.referenceHeadingBlockIndex).toBe(4);
    expect([...result.referenceBlockIndexes]).toEqual([5, 6]);
    expect(result.references).toEqual([
      {
        id: "revista-ref-1",
        raw: "Smith, J. (2020). Un estudio. https://doi.org/10.1234/example",
        authors: ["Smith, J."],
        year: 2020,
      },
      { id: "revista-ref-2", raw: "Entrada de referencia no reconocida" },
    ]);
    expect(result.warnings).toEqual([
      {
        code: "unclassified-reference",
        message:
          "La entrada de referencias se conserva como texto, pero no se pudieron reconocer autor y año. Texto: Entrada de referencia no reconocida",
        blockIndex: 6,
        status: "pendiente",
      },
    ]);
  });

  it("detecta un marcador de nota en superíndice", () => {
    const result = new NoteDetector().detect(
      [
        {
          blockIndex: 0,
          text: "Introducción",
          sizeHalfPoints: "32",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 1,
          text: "Texto normal del cuerpo.",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 2,
          text: "2 Nota en superíndice.",
          sizeHalfPoints: "18",
          hasSuperscriptPrefix: true,
        },
      ],
      [],
      0
    );

    expect(result.notes[0]?.text).toBe("Nota en superíndice.");
    expect(result.consumedNoteBlockIndexes.has(2)).toBe(true);
  });

  it("prefiere notas nativas y no aplica la heurística", () => {
    const nativeNote = {
      id: 7,
      type: "footnote" as const,
      text: "Nota nativa",
    };
    const result = new NoteDetector().detect(
      [
        {
          blockIndex: 0,
          text: "Introducción",
          sizeHalfPoints: "32",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 1,
          text: "[1] Posible nota heurística",
          sizeHalfPoints: "18",
          hasSuperscriptPrefix: false,
        },
      ],
      [nativeNote],
      0
    );

    expect(result.notes).toEqual([nativeNote]);
    expect(result.consumedNoteBlockIndexes.size).toBe(0);
  });

  it("advierte cuando el marcador existe pero el tamaño no confirma una nota", () => {
    const result = new NoteDetector().detect(
      [
        {
          blockIndex: 0,
          text: "Introducción",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
        {
          blockIndex: 1,
          text: "[1] Posible nota",
          sizeHalfPoints: "24",
          hasSuperscriptPrefix: false,
        },
      ],
      [],
      0
    );

    expect(result.notes).toEqual([]);
    expect(result.warnings).toEqual([
      {
        code: "ambiguous-note-size",
        message:
          "El párrafo tiene un posible marcador de nota, pero no se pudo confirmar que su tamaño sea menor al del cuerpo. Texto: [1] Posible nota",
        blockIndex: 1,
        status: "pendiente",
      },
    ]);
  });
});
