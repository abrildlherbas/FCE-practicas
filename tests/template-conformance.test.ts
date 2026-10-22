import axeCore from "axe-core";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import type { Article } from "../src/converter/models/Article";
import { validateBrandLogo } from "../src/renderer-html/brand-logo";
import { validateBrandColor } from "../src/renderer-html/contrast";
import { renderArticle } from "../src/renderer-html/renderArticle";

interface RenderedMagazine {
  color: string;
  logo: string;
  name: string;
  html: string;
  dom: JSDOM;
}

function createArticle(title: string): Article {
  return {
    document: {
      source: `${title}.docx`,
      format: "docx",
      normalizedFormat: "docx",
    },
    header: {
      title,
      authors: [],
      affiliations: [],
      keywords: [],
      keywords_en: [],
      jel_codes: [],
      dates: {},
    },
    body: [
      {
        type: "heading",
        level: 1,
        runs: [{ type: "text", text: "Introducción" }],
      },
      {
        type: "paragraph",
        runs: [{ type: "text", text: "Texto legible del artículo." }],
      },
    ],
    notes: [],
    references: [],
    warnings: [],
  };
}

function createMagazine(
  name: string,
  color: string,
  svg: string
): RenderedMagazine {
  const validatedLogo = validateBrandLogo(
    `${name}.svg`,
    new TextEncoder().encode(svg)
  );
  if (!validatedLogo.valid) {
    throw new Error(validatedLogo.error);
  }

  const html = renderArticle(createArticle(`Artículo de ${name}`), {
    color,
    logo: validatedLogo.logo,
    magazineName: name,
  });
  return {
    color,
    logo: validatedLogo.logo.dataUri,
    name,
    html,
    dom: new JSDOM(html),
  };
}

const magazines = [
  createMagazine(
    "Revista Azul",
    "#123A70",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123A70"/></svg>'
  ),
  createMagazine(
    "Revista Verde",
    "#14532D",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#14532D"/></svg>'
  ),
] as const;

function elementSequence(magazine: RenderedMagazine): string[] {
  const document = magazine.dom.window.document;
  return Array.from(document.body.children)
    .filter((element) =>
      element.matches(
        "header.revista-header, main.revista-main, footer.revista-footer"
      )
    )
    .map((element) => element.tagName.toLowerCase());
}

function normalizedLandmarkMarkup(
  magazine: RenderedMagazine,
  selector: "header.revista-header" | "footer.revista-footer"
): string {
  const element = magazine.dom.window.document.querySelector(selector);
  if (!element) return "";
  return element.outerHTML
    .replaceAll(magazine.name, "{{nombre_revista}}")
    .replaceAll(magazine.color, "{{revista-color}}")
    .replaceAll(magazine.logo, "{{logo-data-uri}}");
}

function duplicateIds(magazine: RenderedMagazine): string[] {
  const ids = Array.from(
    magazine.dom.window.document.querySelectorAll("[id]")
  ).map((element) => element.id);
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

function brandBackgroundsInsideMain(magazine: RenderedMagazine): string[] {
  const style = magazine.dom.window.document.querySelector("style")?.textContent ?? "";
  const rules = style.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const violations: string[] = [];

  for (const [, selectorText, declarations] of rules) {
    if (
      /background(?:-color)?\s*:[^;}]*var\(\s*--revista-color\s*\)/i.test(
        declarations
      ) &&
      /(?:^|,)\s*(?:main|\.revista-main)(?:[\s.#:[>,]|$)/i.test(selectorText)
    ) {
      violations.push(selectorText.trim());
    }
  }

  return violations;
}

describe("conformidad del template con dos revistas", () => {
  it.each(magazines)(
    "$name tiene un header, main y footer en el orden requerido",
    (magazine) => {
      const document = magazine.dom.window.document;
      expect(document.querySelectorAll("header.revista-header")).toHaveLength(1);
      expect(document.querySelectorAll("main.revista-main")).toHaveLength(1);
      expect(document.querySelectorAll("footer.revista-footer")).toHaveLength(1);
      expect(elementSequence(magazine)).toEqual(["header", "main", "footer"]);
    }
  );

  it("mantiene header y footer iguales, excepto los valores de marca inyectados", () => {
    expect(magazines[0].color).not.toBe(magazines[1].color);
    expect(magazines[0].logo).not.toBe(magazines[1].logo);
    for (const selector of [
      "header.revista-header",
      "footer.revista-footer",
    ] as const) {
      expect(normalizedLandmarkMarkup(magazines[0], selector)).not.toBe("");
      expect(normalizedLandmarkMarkup(magazines[0], selector)).toBe(
        normalizedLandmarkMarkup(magazines[1], selector)
      );
    }
  });

  it.each(magazines)(
    "$name expone los tres identificadores del header",
    (magazine) => {
      const header = magazine.dom.window.document.querySelector(
        "header.revista-header"
      );
      expect(header?.hasAttribute("data-obc-id")).toBe(true);
      expect(header?.hasAttribute("data-revista-id")).toBe(true);
      expect(header?.hasAttribute("data-articulo-id")).toBe(true);
    }
  );

  it.each(magazines)(
    "$name ordena el footer: datos, logo, licencia",
    (magazine) => {
      const footer = magazine.dom.window.document.querySelector(
        "footer.revista-footer"
      );
      const content = footer?.firstElementChild;
      expect(content?.children).toHaveLength(3);
      expect(content?.children[0].matches(".revista-datos-institucionales")).toBe(
        true
      );
      expect(content?.children[1].matches(".revista-logo")).toBe(true);
      expect(content?.children[2].matches(".revista-licencia")).toBe(true);
    }
  );

  it.each(magazines)(
    "$name usa solo un bloque de estilos sin estilos inline y con las dos variables de marca",
    (magazine) => {
      const document = magazine.dom.window.document;
      expect(document.querySelectorAll("[style]")).toHaveLength(0);
      const styles = Array.from(document.querySelectorAll("style"));
      expect(styles).toHaveLength(1);
      const declarations = Array.from(
        styles[0].textContent?.matchAll(/(--[\w-]+)\s*:/g) ?? [],
        (match) => match[1]
      );
      expect([...new Set(declarations)].sort()).toEqual([
        "--revista-color",
        "--revista-logo-url",
      ]);
    }
  );

  it.each(magazines)(
    "$name no aplica el color de marca como fondo dentro del Main",
    (magazine) => {
      expect(brandBackgroundsInsideMain(magazine)).toEqual([]);
    }
  );

  it.each(magazines)(
    "$name tiene un solo h1 y ningún id duplicado",
    (magazine) => {
      expect(
        magazine.dom.window.document.querySelectorAll("h1")
      ).toHaveLength(1);
      expect(duplicateIds(magazine)).toEqual([]);
    }
  );

  it.each(magazines)(
    "$name no tiene violaciones axe-core serias ni críticas",
    async (magazine) => {
      const results = await axeCore.run(
        magazine.dom.window.document.documentElement,
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        },
      );
      const severeViolations = results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? "")
      );

      expect(severeViolations).toEqual([]);
      const contrast = validateBrandColor(magazine.color);
      expect(contrast.valid).toBe(true);
      if (contrast.valid) {
        expect(contrast.contrastRatio).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});
