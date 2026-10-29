import { describe, expect, it } from "vitest";

import { CitationLinker } from "../src/converter/docx/CitationLinker";
import type { BodyBlock, Reference } from "../src/converter/models/Article";

const references: Reference[] = [
  {
    id: "revista-ref-1",
    raw: "Smith, J. (2020). Estudio.",
    authors: ["Smith, J."],
    year: 2020,
  },
  {
    id: "revista-ref-2",
    raw: "Smith, J., Jones, A. (2021). Otro estudio.",
    authors: ["Smith, J.", "Jones, A."],
    year: 2021,
  },
  {
    id: "revista-ref-3",
    raw: "García, A., Pérez, M., López, R. (2022). Un estudio.",
    authors: ["García, A.", "Pérez, M.", "López, R."],
    year: 2022,
  },
  {
    id: "revista-ref-4",
    raw: "Lee, K. (2023). Otro trabajo.",
    authors: ["Lee, K."],
    year: 2023,
  },
];

function paragraph(text: string): BodyBlock[] {
  return [{ type: "paragraph", runs: [{ type: "text", text }] }];
}

describe("CitationLinker", () => {
  it.each([
    ["cita parentética", "(Smith, 2020)", "revista-ref-1"],
    ["dos apellidos unidos por y", "(Smith y Jones, 2021)", "revista-ref-2"],
    ["et al. parentético", "(García et al., 2022)", "revista-ref-3"],
    ["citas múltiples separadas por punto y coma", "(Smith, 2020; Lee et al., 2023)", "revista-ref-1"],
    ["cita narrativa", "Smith (2020)", "revista-ref-1"],
    ["cita narrativa con et al.", "García et al. (2022)", "revista-ref-3"],
  ])("enlaza %s", (_label, text, referenceId) => {
    const result = new CitationLinker().link(paragraph(text), references);
    const block = result.body[0];
    const citations = block && "runs" in block
      ? block.runs.filter((run) => run.type === "citation")
      : [];

    expect(citations).toHaveLength(
      text.includes(";") ? 2 : 1
    );
    expect(citations[0]).toMatchObject({ referenceId });
    expect(
      result.warnings.filter(({ code }) =>
        ["ambiguous-citation", "unmatched-citation"].includes(code)
      )
    ).toEqual([]);
  });

  it("enlaza apellidos compuestos en citas narrativas", () => {
    const compoundReference: Reference[] = [{
      id: "revista-ref-1",
      raw: "Torres Carbonell, C. (2024). Estudio.",
      authors: ["Torres Carbonell, C."],
      year: 2024,
    }];
    const result = new CitationLinker().link(
      paragraph("Torres Carbonell (2024)"),
      compoundReference
    );
    const block = result.body[0];

    expect(
      block && "runs" in block
        ? block.runs.filter((run) => run.type === "citation")
        : []
    ).toMatchObject([{
      type: "citation",
      text: "Torres Carbonell (2024)",
      referenceId: "revista-ref-1",
    }]);
    expect(result.warnings).toEqual([]);
  });

  it("advierte citas sin referencia y referencias no citadas", () => {
    const result = new CitationLinker().link(
      paragraph("(Desconocido, 2019)."),
      references.slice(0, 1)
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmatched-citation",
          message: expect.stringContaining("Desconocido, 2019"),
          blockIndex: 0,
          start: 1,
          end: 18,
          affectedText: "Desconocido, 2019",
        }),
        expect.objectContaining({
          code: "uncited-reference",
          message: expect.stringContaining("Smith, J. (2020)"),
        }),
      ])
    );
  });

  it("mantiene offsets absolutos del bloque cuando la cita sigue a una nota", () => {
    const result = new CitationLinker().link(
      [{
        type: "paragraph",
        runs: [
          { type: "text", text: "Texto " },
          { type: "noteRef", noteId: 2, noteType: "footnote" },
          { type: "text", text: " (Desconocido, 2019)" },
        ],
      }],
      references.slice(0, 1)
    );

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "unmatched-citation",
        start: 9,
        end: 26,
        affectedText: "Desconocido, 2019",
      })
    );
  });

  it("no elige entre referencias ambiguas", () => {
    const duplicates: Reference[] = [
      references[0],
      {
        id: "revista-ref-5",
        raw: "Smith, B. (2020). Otro estudio.",
        authors: ["Smith, B."],
        year: 2020,
      },
    ];
    const result = new CitationLinker().link(
      paragraph("(Smith, 2020)."),
      duplicates
    );

    const ambiguousBlock = result.body[0];
    expect(
      ambiguousBlock && "runs" in ambiguousBlock
        ? ambiguousBlock.runs
            .filter((run) => run.type === "text")
            .map((run) => run.text)
            .join("")
        : ""
    ).toBe("(Smith, 2020).");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "ambiguous-citation",
        message: expect.stringContaining("Smith, 2020"),
      })
    );
  });

  it("reconoce citas divididas entre varios runs", () => {
    const result = new CitationLinker().link(
      [
        {
          type: "paragraph",
          runs: [
            { type: "text", text: "(Smith" },
            { type: "text", text: ", 2020)" },
          ],
        },
      ],
      references.slice(0, 1)
    );
    const block = result.body[0];

    expect(
      block && "runs" in block
        ? block.runs.filter((run) => run.type === "citation")
        : []
    ).toMatchObject([
      {
        type: "citation",
        text: "Smith, 2020",
        referenceId: "revista-ref-1",
      },
    ]);
  });
});
