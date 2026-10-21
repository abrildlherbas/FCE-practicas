import { describe, expect, it } from "vitest";

import { HeaderExtractor } from "../src/converter/docx/HeaderExtractor";

describe("HeaderExtractor", () => {
  it("extrae los metadatos configurados y retira sus bloques", () => {
    const result = new HeaderExtractor().extract([
      {
        blockIndex: 0,
        text: "https://doi.org/10.1000/example",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 1,
        text: "Título del artículo",
        styleId: null,
        sizeHalfPoints: "30",
      },
      {
        blockIndex: 2,
        text: "Article title in English",
        styleId: null,
        sizeHalfPoints: "30",
      },
      {
        blockIndex: 3,
        text: "Ana Pérez",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 4,
        text: "iInstituto de Investigación",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 5,
        text: "RESUMEN",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 6,
        text: "Este es el resumen.",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 7,
        text: "Palabras clave: economía, producción",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 8,
        text: "Código JEL: Q12; Q18",
        styleId: null,
        sizeHalfPoints: "24",
      },
      {
        blockIndex: 9,
        text: "Recibido: 14/03/2026",
        styleId: null,
        sizeHalfPoints: "22",
      },
      {
        blockIndex: 10,
        text: "Aceptado: 22/05/2026",
        styleId: null,
        sizeHalfPoints: "22",
      },
      {
        blockIndex: 11,
        text: "Publicado: 30/06/2026",
        styleId: null,
        sizeHalfPoints: "22",
      },
      {
        blockIndex: 12,
        text: "Introducción",
        styleId: null,
        sizeHalfPoints: "32",
      },
      {
        blockIndex: 13,
        text: "El cuerpo no se debe consumir.",
        styleId: null,
        sizeHalfPoints: "24",
      },
    ]);

    expect(result.header).toMatchObject({
      title: "Título del artículo",
      authors: ["Ana Pérez"],
      affiliations: ["Instituto de Investigación"],
      abstract: "Este es el resumen.",
      keywords: ["economía", "producción"],
      jel_codes: ["Q12", "Q18"],
      dates: {
        received: "14/03/2026",
        accepted: "22/05/2026",
        published: "30/06/2026",
      },
      doi: "10.1000/example",
    });
    expect([...result.consumedBlockIndexes].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("deja vacíos los campos ausentes y agrega advertencias", () => {
    const result = new HeaderExtractor().extract([]);

    expect(result.header).toEqual({
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
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "header-missing-title",
      "header-missing-authors",
      "header-missing-affiliations",
      "header-missing-abstract",
      "header-missing-keywords",
      "header-missing-jel_codes",
      "header-missing-dates",
    ]);
  });
});
