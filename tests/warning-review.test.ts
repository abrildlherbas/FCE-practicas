import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type { Article, ParseWarning } from "../src/converter/models/Article";
import {
  focusWarningBlock,
  pendingWarnings,
  resolveWarning,
} from "../src/renderer/warning-review";

const warning: ParseWarning = {
  code: "unclassified-element",
  message: "Texto sin ubicar",
  blockIndex: 2,
  blockId: "b-1",
  status: "pendiente",
};

function article(): Article {
  return {
    document: {
      source: "articulo.docx",
      format: "docx",
      normalizedFormat: "docx",
    },
    header: {
      authors: [],
      affiliations: [],
      keywords: [],
      keywords_en: [],
      jel_codes: [],
      dates: {},
    },
    body: [],
    notes: [],
    references: [],
    warnings: [{ ...warning }],
  };
}

describe("revisión de errores", () => {
  it("desplaza y resalta el bloque asociado al error", () => {
    const document = new JSDOM(
      '<!doctype html><html><head></head><body><p data-bloque-id="b-0">Otro</p><p data-bloque-id="b-1">Texto afectado</p></body></html>'
    ).window.document;
    const target = document.querySelector<HTMLElement>(
      '[data-bloque-id="b-1"]'
    )!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    expect(focusWarningBlock(document, warning.blockId)).toBe(target);
    expect(target.classList.contains("warning-highlight")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(document.getElementById("warning-highlight-style")).not.toBeNull();
  });

  it("marca el error como resuelto y lo quita de pendientes", () => {
    const currentArticle = article();
    const currentWarning = currentArticle.warnings[0]!;

    resolveWarning(currentArticle, currentWarning);

    expect(currentWarning.status).toBe("resuelto");
    expect(pendingWarnings(currentArticle.warnings)).toEqual([]);
  });
});
