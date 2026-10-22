import axeCore from "axe-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const templateVersionPath = fileURLToPath(
  new URL("../src/template/VERSION", import.meta.url)
);
const examplesDirectory = fileURLToPath(
  new URL("../examples/", import.meta.url)
);

interface MagazineFixture {
  name: string;
  fileName: string;
  color: string;
  ids: {
    obc: string;
    revista: string;
    articulo: string;
  };
}

const magazines: MagazineFixture[] = [
  {
    name: "Revista Azul",
    fileName: "ejemplo-revista-a.html",
    color: "#123A70",
    ids: { obc: "obc-azul", revista: "revista-azul", articulo: "articulo-azul" },
  },
  {
    name: "Revista Coral",
    fileName: "ejemplo-revista-b.html",
    color: "#D94635",
    ids: { obc: "obc-coral", revista: "revista-coral", articulo: "articulo-coral" },
  },
];

async function loadMagazine(magazine: MagazineFixture): Promise<JSDOM> {
  const html = await fs.readFile(
    path.join(examplesDirectory, magazine.fileName),
    "utf8"
  );
  return new JSDOM(html);
}

describe("conformidad del template con dos revistas", () => {
  it.each(magazines)(
    "$name tiene header, main y footer en orden y un solo título principal",
    async (magazine) => {
      const { document } = (await loadMagazine(magazine)).window;
      const header = document.querySelector("header.header");
      const main = document.querySelector("main");
      const footer = document.querySelector("footer.footer");
      const bodyHeading = document.querySelector(".article-body h3");

      expect(document.querySelectorAll("header.header")).toHaveLength(1);
      expect(document.querySelectorAll("main")).toHaveLength(1);
      expect(document.querySelectorAll("footer.footer")).toHaveLength(1);
      expect(header).not.toBeNull();
      expect(main).not.toBeNull();
      expect(footer).not.toBeNull();
      expect(
        header!.compareDocumentPosition(main!) &
          document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        main!.compareDocumentPosition(footer!) &
          document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(document.querySelectorAll("h1")).toHaveLength(1);
      expect(bodyHeading?.textContent).toBe("Introducción");
    }
  );

  it("mantiene idéntico el footer y limita las diferencias del header a valores inyectados", async () => {
    const [first, second] = await Promise.all(
      magazines.map(async (magazine) =>
        (await loadMagazine(magazine)).window.document
      )
    );
    const firstHeader = first.querySelector("header.header");
    const secondHeader = second.querySelector("header.header");
    const firstFooter = first.querySelector("footer.footer");
    const secondFooter = second.querySelector("footer.footer");

    expect(firstFooter?.outerHTML).toBe(secondFooter?.outerHTML);
    expect(firstHeader?.textContent).toContain(magazines[0].name);
    expect(secondHeader?.textContent).toContain(magazines[1].name);
    expect(firstHeader?.innerHTML).not.toBe(secondHeader?.innerHTML);
  });

  it.each(magazines)(
    "$name expone los tres identificadores del artículo",
    async ({ ids, ...magazine }) => {
      const header = (await loadMagazine(magazine)).window.document.querySelector(
        "header.header"
      );

      expect(header?.getAttribute("data-obc-id")).toBe(ids.obc);
      expect(header?.getAttribute("data-revista-id")).toBe(ids.revista);
      expect(header?.getAttribute("data-articulo-id")).toBe(ids.articulo);
    }
  );

  it.each(magazines)(
    "$name usa solo el bloque de color en style y no tiene estilos inline",
    async (magazine) => {
      const { color } = magazine;
      const document = (await loadMagazine(magazine)).window.document;
      const styles = Array.from(document.querySelectorAll("style"));

      expect(document.querySelectorAll("[style]")).toHaveLength(0);
      expect(styles).toHaveLength(1);
      expect(styles[0]?.textContent?.replace(/\s+/g, "")).toBe(
        `:root{--revista-color:${color}}`
      );
    }
  );

  it.each(magazines)(
    "$name no duplica ids y no tiene violaciones axe-core serias o críticas",
    async (magazine) => {
      const document = (await loadMagazine(magazine)).window.document;
      const ids = Array.from(document.querySelectorAll("[id]")).map(
        (element) => element.id
      );
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const results = await axeCore.run(document.documentElement, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      });
      const severeViolations = results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? "")
      );

      expect(duplicateIds).toEqual([]);
      expect(severeViolations).toEqual([]);
    }
  );

  it("publica la versión desde src/template/VERSION", async () => {
    const expectedVersion = (await fs.readFile(templateVersionPath, "utf8")).trim();
    const document = (await loadMagazine(magazines[0])).window.document;

    expect(
      document.querySelector('meta[name="template-version"]')?.getAttribute("content")
    ).toBe(expectedVersion);
  });
});
