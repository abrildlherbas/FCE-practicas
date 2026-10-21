import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

const pagePath = fileURLToPath(
  new URL("../src/renderer/index.html", import.meta.url)
);

function parsePage(html: string): XmlDocument {
  const content = html
    .replace(/^<!doctype html>\s*/i, "")
    .replace(/\shidden(?=[\s>])/g, ' hidden="hidden"');
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(content, "application/xml");
}

function byId(document: XmlDocument, id: string): XmlElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element;
}

describe("flujo de revisión de la aplicación", () => {
  it("muestra tres pasos, el estado inicial y una vista previa protegida", async () => {
    const html = await fs.readFile(pagePath, "utf8");
    const document = parsePage(html);
    const steps = Array.from(document.getElementsByTagName("*")).filter(
      (element) => element.hasAttribute("data-step-indicator")
    );
    const preview = byId(document, "articlePreview");

    expect(steps).toHaveLength(3);
    expect(
      steps.map((step) =>
        (step.textContent ?? "").replace(/\s+/g, " ").trim()
      )
    ).toEqual([
      "1 Elegir Word",
      "2 Revisar",
      "3 Aprobar y guardar",
    ]);
    expect(byId(document, "articleStatus").textContent?.trim()).toBe(
      "Pendiente"
    );
    expect(byId(document, "stepChoose").hasAttribute("hidden")).toBe(false);
    expect(byId(document, "stepReview").hasAttribute("hidden")).toBe(true);
    expect(byId(document, "stepApprove").hasAttribute("hidden")).toBe(true);
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("title")).toBe("Vista previa del artículo");
    expect(byId(document, "warningList").getAttribute("aria-live")).toBe(
      "polite"
    );
    expect(byId(document, "appMessage").getAttribute("aria-live")).toBe(
      "polite"
    );
  });

  it("usa textos sencillos para revisar, aprobar y guardar", async () => {
    const html = await fs.readFile(pagePath, "utf8");
    const visibleText = parsePage(html).documentElement.textContent ?? "";

    expect(visibleText).toContain("Puntos para revisar");
    expect(visibleText).toContain("Así se verá el documento guardado.");
    expect(visibleText).toContain("Aprobar artículo");
    expect(visibleText).toContain("Guardar artículo");
    expect(visibleText).not.toMatch(
      /\b(parser|renderer|JSON|HTML|metadatos|relación OOXML)\b/i
    );
  });
});
