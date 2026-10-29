import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type { Article, ParseWarning } from "../src/converter/models/Article";
import {
  annotateWarningFragments,
  clearWarningAnnotations,
  filterWarnings,
  focusWarningBlock,
  numberedWarnings,
  pendingWarnings,
  resolveWarning,
  warningCounts,
} from "../src/renderer/warning-review";

const warning: ParseWarning = {
  code: "unclassified-element",
  message: "Texto sin ubicar",
  blockIndex: 2,
  blockId: "b-1",
  start: 6,
  end: 14,
  affectedText: "afectado",
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
  it("enfoca, desplaza y resalta el rango en artículos extensos", () => {
    const paragraphs = Array.from({ length: 240 }, (_, index) =>
      `<p data-bloque-id="b-${index}">${index === 232 ? "Texto afectado" : `Párrafo ${index}`}</p>`
    ).join("");
    const document = new JSDOM(
      `<!doctype html><html><head></head><body>${paragraphs}</body></html>`
    ).window.document;
    const target = document.querySelector<HTMLElement>(
      '[data-bloque-id="b-232"]'
    )!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    expect(
      focusWarningBlock(document, {
        ...warning,
        blockId: "b-232",
      })
    ).toBe(target);
    expect(target.classList.contains("warning-highlight")).toBe(true);
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(
      document.querySelector("[data-app-warning-focus-highlight]")
        ?.textContent
    ).toBe("afectado");
    expect(document.defaultView?.getSelection()?.toString()).toBe(
      "afectado"
    );
    expect(document.getElementById("warning-highlight-style")).not.toBeNull();
  });

  it("no resalta un rango obsoleto si el texto editado ya no coincide", () => {
    const document = new JSDOM(
      '<!doctype html><html><head></head><body><p data-bloque-id="b-1">Texto modificado</p></body></html>'
    ).window.document;
    const target = document.querySelector<HTMLElement>(
      '[data-bloque-id="b-1"]'
    )!;

    expect(focusWarningBlock(document, warning)).toBe(target);
    expect(document.defaultView?.getSelection()?.toString()).toBe("");
    expect(target.classList.contains("warning-highlight")).toBe(true);
  });

  it("informa ausencia del bloque sin intentar recorrer todos los nodos", () => {
    const document = new JSDOM(
      '<!doctype html><html><head></head><body><p data-bloque-id="b-0">Texto</p></body></html>'
    ).window.document;

    expect(
      focusWarningBlock(document, { ...warning, blockId: "b-241" })
    ).toBeNull();
  });

  it("marca el error como resuelto y lo quita de pendientes", () => {
    const currentArticle = article();
    const currentWarning = currentArticle.warnings[0]!;

    resolveWarning(currentArticle, currentWarning);

    expect(currentWarning.status).toBe("resuelto");
    expect(pendingWarnings(currentArticle.warnings)).toEqual([]);
  });

  it("sincroniza ordinales, varios fragmentos por bloque y etiquetas accesibles", () => {
    const first: ParseWarning = {
      ...warning,
      id: "warning:first",
      ordinal: 12,
      start: 0,
      end: 11,
      affectedText: "Fragmento A",
      message: "Primero",
    };
    const second: ParseWarning = {
      ...warning,
      id: "warning:second",
      ordinal: 13,
      start: 14,
      end: 25,
      affectedText: "fragmento B",
      message: "Segundo",
    };
    const currentArticle = article();
    currentArticle.warnings = [first, second];
    const document = new JSDOM(
      '<!doctype html><html><head></head><body><p data-bloque-id="b-1">Fragmento A y fragmento B</p></body></html>'
    ).window.document;

    annotateWarningFragments(
      document,
      filterWarnings(numberedWarnings(currentArticle.warnings), "pendientes")
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-app-warning-marker]"
        )
      ).map((marker) => marker.textContent)
    ).toEqual(["12", "13"]);
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-app-warning-marker]"
        )
      ).map((marker) => marker.getAttribute("aria-label"))
    ).toEqual(["Error 12: Primero", "Error 13: Segundo"]);
    expect(
      Array.from(
        document.querySelectorAll("[data-app-warning-annotation]")
      ).map((fragment) => fragment.textContent)
    ).toEqual(["Fragmento A", "fragmento B"]);

    resolveWarning(currentArticle, first);
    const afterResolve = numberedWarnings(currentArticle.warnings);
    expect(filterWarnings(afterResolve, "pendientes").map(({ number }) => number))
      .toEqual([13]);
    expect(filterWarnings(afterResolve, "resueltos").map(({ number }) => number))
      .toEqual([12]);
    expect(warningCounts(currentArticle.warnings)).toEqual({
      pending: 1,
      resolved: 1,
    });

    clearWarningAnnotations(document);
    expect(document.body.innerHTML).toBe(
      '<p data-bloque-id="b-1">Fragmento A y fragmento B</p>'
    );
    expect(document.body.innerHTML).not.toContain("data-app-warning-marker");
    expect(document.body.innerHTML).not.toContain("data-app-warning-annotation");
  });
});
