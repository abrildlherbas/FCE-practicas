import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import { StylesResolver } from "../src/converter/docx/StylesResolver";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: true,
});

function resolveRunProps(
  stylesXml: string,
  paragraphXml: string
) {
  const parsed = xmlParser.parse(paragraphXml) as Array<
    Record<string, unknown>
  >;
  const paragraph = parsed[0];
  const paragraphChildren = paragraph?.["w:p"];

  if (!Array.isArray(paragraphChildren)) {
    throw new Error("El XML de prueba no contiene w:p");
  }

  const run = paragraphChildren.find(
    (child) =>
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      "w:r" in child
  );

  if (!run) {
    throw new Error("El XML de prueba no contiene w:r");
  }

  return new StylesResolver(stylesXml).resolveRunProps(
    paragraph,
    run
  );
}

describe("StylesResolver", () => {
  it("prioriza las propiedades del run y respeta valores falsos explícitos", () => {
    const stylesXml =
      '<w:styles><w:style w:styleId="Body"><w:rPr><w:sz w:val="24"/><w:b/><w:i/></w:rPr></w:style></w:styles>';
    const paragraphXml =
      '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:sz w:val="30"/><w:b w:val="0"/><w:i w:val="false"/></w:rPr><w:t>texto</w:t></w:r></w:p>';

    expect(resolveRunProps(stylesXml, paragraphXml)).toEqual({
      sizeHalfPoints: "30",
      bold: false,
      italic: false,
    });
  });

  it("hereda propiedades definidas en el estilo del párrafo", () => {
    const stylesXml =
      '<w:styles><w:style w:styleId="Body"><w:rPr><w:sz w:val="24"/><w:b/><w:i/></w:rPr></w:style></w:styles>';
    const paragraphXml =
      '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>texto</w:t></w:r></w:p>';

    expect(resolveRunProps(stylesXml, paragraphXml)).toEqual({
      sizeHalfPoints: "24",
      bold: true,
      italic: true,
    });
  });

  it("hereda las propiedades faltantes del estilo base", () => {
    const stylesXml =
      '<w:styles><w:style w:styleId="Base"><w:rPr><w:sz w:val="22"/><w:b/><w:i w:val="false"/></w:rPr></w:style><w:style w:styleId="Body"><w:basedOn w:val="Base"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style></w:styles>';
    const paragraphXml =
      '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>texto</w:t></w:r></w:p>';

    expect(resolveRunProps(stylesXml, paragraphXml)).toEqual({
      sizeHalfPoints: "26",
      bold: true,
      italic: false,
    });
  });

  it("usa w:docDefaults para las propiedades que no aparecen en los estilos", () => {
    const stylesXml =
      '<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/><w:b/><w:i w:val="false"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
    const paragraphXml =
      "<w:p><w:r><w:t>texto</w:t></w:r></w:p>";

    expect(resolveRunProps(stylesXml, paragraphXml)).toEqual({
      sizeHalfPoints: "20",
      bold: true,
      italic: false,
    });
  });

  it("devuelve valores predeterminados cuando no hay estilos ni docDefaults", () => {
    const paragraphXml =
      "<w:p><w:r><w:t>texto</w:t></w:r></w:p>";

    expect(resolveRunProps("<w:styles/>", paragraphXml)).toEqual({
      sizeHalfPoints: null,
      bold: false,
      italic: false,
    });
  });
});
