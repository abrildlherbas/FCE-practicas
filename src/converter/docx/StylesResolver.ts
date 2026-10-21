import { XMLParser } from "fast-xml-parser";

export interface ResolvedRunProps {
  sizeHalfPoints: string | null;
  bold: boolean;
  italic: boolean;
}

type XmlRecord = Record<string, unknown>;

function asRecord(value: unknown): XmlRecord | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as XmlRecord;
}

function elementName(node: unknown): string | null {
  const record = asRecord(node);
  if (!record) return null;

  return Object.keys(record).find(
    (key) => key !== ":@" && !key.startsWith("#")
  ) ?? null;
}

function directChild(
  node: unknown,
  name: string
): unknown | null {
  const record = asRecord(node);
  const currentName = elementName(node);
  const children = currentName ? record?.[currentName] : null;

  if (!Array.isArray(children)) return null;

  return children.find(
    (child) => elementName(child) === name
  ) ?? null;
}

function attribute(
  node: unknown,
  name: string
): string | null {
  const record = asRecord(node);
  const attributes = asRecord(record?.[":@"]);
  const value = attributes?.[`@_w:${name}`];

  return value === undefined ? null : String(value);
}

function findElements(
  node: unknown,
  name: string,
  results: unknown[] = []
): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      findElements(child, name, results);
    }

    return results;
  }

  const record = asRecord(node);
  if (!record) return results;

  if (elementName(node) === name) {
    results.push(node);
    return results;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key !== ":@" && !key.startsWith("#")) {
      findElements(value, name, results);
    }
  }

  return results;
}

function readOnOff(node: unknown): boolean | undefined {
  if (!node) return undefined;

  const value = attribute(node, "val");
  if (value === null) return true;

  return !["0", "false", "off"].includes(
    value.trim().toLowerCase()
  );
}

export class StylesResolver {
  private readonly stylesById = new Map<string, unknown>();
  private readonly documentDefaults: unknown;

  constructor(stylesXml: string | null) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      preserveOrder: true,
    });
    const parsedStyles: unknown = stylesXml
      ? parser.parse(stylesXml)
      : [];

    for (const style of findElements(parsedStyles, "w:style")) {
      const id = attribute(style, "styleId");
      if (id) this.stylesById.set(id, style);
    }

    this.documentDefaults =
      findElements(parsedStyles, "w:docDefaults")[0] ?? null;
  }

  resolveRunProps(
    paragraph: unknown,
    run: unknown
  ): ResolvedRunProps {
    const directRunProperties = directChild(run, "w:rPr");
    const paragraphProperties = directChild(paragraph, "w:pPr");
    const paragraphStyleId = attribute(
      directChild(paragraphProperties, "w:pStyle"),
      "val"
    );

    return {
      sizeHalfPoints:
        this.resolveProperty(
          directRunProperties,
          "w:sz",
          "val"
        ) ??
        this.resolveParagraphStyleProperty(
          paragraphStyleId,
          "w:sz",
          "val"
        ) ??
        this.resolveDefaultSize(),
      bold:
        this.resolveOnOff(directRunProperties, "w:b") ??
        this.resolveParagraphStyleOnOff(paragraphStyleId, "w:b") ??
        this.resolveDefaultOnOff("w:b") ??
        false,
      italic:
        this.resolveOnOff(directRunProperties, "w:i") ??
        this.resolveParagraphStyleOnOff(paragraphStyleId, "w:i") ??
        this.resolveDefaultOnOff("w:i") ??
        false,
    };
  }

  getParagraphStyleId(paragraph: unknown): string | null {
    const paragraphProperties = directChild(paragraph, "w:pPr");
    return attribute(
      directChild(paragraphProperties, "w:pStyle"),
      "val"
    );
  }

  isSuperscript(paragraph: unknown, run: unknown): boolean {
    const runProperties = directChild(run, "w:rPr");
    const paragraphStyleId = this.getParagraphStyleId(paragraph);
    const verticalAlign =
      attribute(
        directChild(runProperties, "w:vertAlign"),
        "val"
      ) ??
      this.resolveParagraphStyleProperty(
        paragraphStyleId,
        "w:vertAlign",
        "val"
      ) ??
      this.resolveDefaultProperty("w:vertAlign", "val");

    return verticalAlign?.toLowerCase() === "superscript";
  }

  private resolveParagraphStyleProperty(
    styleId: string | null,
    propertyName: string,
    attributeName: string
  ): string | null {
    let currentStyleId = styleId;
    const visited = new Set<string>();

    while (currentStyleId && !visited.has(currentStyleId)) {
      visited.add(currentStyleId);
      const style = this.stylesById.get(currentStyleId);
      if (!style) return null;

      const runProperties = directChild(style, "w:rPr");
      const value = this.resolveProperty(
        runProperties,
        propertyName,
        attributeName
      );
      if (value !== null) return value;

      currentStyleId = attribute(
        directChild(style, "w:basedOn"),
        "val"
      );
    }

    return null;
  }

  private resolveParagraphStyleOnOff(
    styleId: string | null,
    propertyName: "w:b" | "w:i"
  ): boolean | undefined {
    let currentStyleId = styleId;
    const visited = new Set<string>();

    while (currentStyleId && !visited.has(currentStyleId)) {
      visited.add(currentStyleId);
      const style = this.stylesById.get(currentStyleId);
      if (!style) return undefined;

      const runProperties = directChild(style, "w:rPr");
      const value = this.resolveOnOff(runProperties, propertyName);
      if (value !== undefined) return value;

      currentStyleId = attribute(
        directChild(style, "w:basedOn"),
        "val"
      );
    }

    return undefined;
  }

  private resolveDefaultSize(): string | null {
    return this.resolveDefaultProperty("w:sz", "val");
  }

  private resolveDefaultProperty(
    propertyName: string,
    attributeName: string
  ): string | null {
    const defaultRunProperties = directChild(
      directChild(this.documentDefaults, "w:rPrDefault"),
      "w:rPr"
    );
    return this.resolveProperty(
      defaultRunProperties,
      propertyName,
      attributeName
    );
  }

  private resolveDefaultOnOff(
    propertyName: "w:b" | "w:i"
  ): boolean | undefined {
    const defaultRunProperties = directChild(
      directChild(this.documentDefaults, "w:rPrDefault"),
      "w:rPr"
    );
    return this.resolveOnOff(defaultRunProperties, propertyName);
  }

  private resolveProperty(
    runProperties: unknown,
    propertyName: string,
    attributeName: string
  ): string | null {
    const property = directChild(runProperties, propertyName);
    return attribute(property, attributeName);
  }

  private resolveOnOff(
    runProperties: unknown,
    propertyName: "w:b" | "w:i"
  ): boolean | undefined {
    return readOnOff(directChild(runProperties, propertyName));
  }
}
