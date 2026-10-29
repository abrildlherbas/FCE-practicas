import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  prepareRegeneration,
  type ManualBlockEdit,
} from "../src/renderer-html/block-edits";

function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

describe("reaplicaci├│n de ediciones por bloque", () => {
  it("reaplica el HTML editado cuando el bloque original sigue coincidiendo", () => {
    const original = '<p data-bloque-id="b-0">Texto original</p>';
    const edits: ManualBlockEdit[] = [
      {
        blockId: "b-0",
        originalHtml: original,
        html: '<p data-bloque-id="b-0"><strong>Texto editado</strong></p>',
      },
    ];
    const result = prepareRegeneration(
      parse(`<html><body>${original}</body></html>`),
      edits,
      "keep"
    );

    expect(result?.conflicts).toEqual([]);
    expect(result?.edits).toEqual(edits);
    expect(result?.html).toContain(
      '<p data-bloque-id="b-0"><strong>Texto editado</strong></p>'
    );
  });

  it("conserva como conflicto la edici├│n si el bloque cambi├│", () => {
    const edit: ManualBlockEdit = {
      blockId: "b-0",
      originalHtml: '<p data-bloque-id="b-0">Texto original</p>',
      html: '<p data-bloque-id="b-0">Texto editado</p>',
    };
    const result = prepareRegeneration(
      parse('<html><body><p data-bloque-id="b-0">Texto nuevo</p></body></html>'),
      [edit],
      "keep"
    );

    expect(result?.conflicts).toEqual([edit]);
    expect(result?.edits).toEqual([edit]);
    expect(result?.html).toContain("Texto nuevo");
    expect(result?.html).not.toContain("Texto editado");
  });

  it("descartar elimina los cambios y cancelar no modifica el documento ni los datos", () => {
    const document = parse(
      '<html><body><p data-bloque-id="b-0">Texto original</p></body></html>'
    );
    const before = document.documentElement.outerHTML;
    const edits: ManualBlockEdit[] = [
      {
        blockId: "b-0",
        originalHtml: '<p data-bloque-id="b-0">Texto original</p>',
        html: '<p data-bloque-id="b-0">Texto editado</p>',
      },
    ];

    expect(prepareRegeneration(document, edits, "cancel")).toBeNull();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(edits[0].html).toContain("Texto editado");

    const discarded = prepareRegeneration(document, edits, "discard");
    expect(discarded?.edits).toEqual([]);
    expect(discarded?.html).toContain("Texto original");
  });

  it("preserva el borrado manual de un bloque coincidente", () => {
    const original = '<p data-bloque-id="b-0">Texto original</p>';
    const result = prepareRegeneration(
      parse(`<html><body>${original}</body></html>`),
      [{ blockId: "b-0", originalHtml: original, html: "" }],
      "keep"
    );

    expect(result?.html).not.toContain("data-bloque-id");
    expect(result?.conflicts).toEqual([]);
  });
});
