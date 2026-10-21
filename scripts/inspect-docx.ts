import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type XmlRecord = Record<string, unknown>;

interface XmlElement {
  name: string;
  children: unknown;
  attributes: XmlRecord;
}

interface ParagraphInfo {
  index: number;
  style: string | null;
  fontSize: string | null;
  hasFrame: boolean;
  runCount: number;
  text: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: true,
});

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

function getElement(value: unknown): XmlElement | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const name = Object.keys(record).find(
    (key) => key !== ":@" && !key.startsWith("#")
  );

  if (!name) {
    return null;
  }

  return {
    name,
    children: record[name],
    attributes: asRecord(record[":@"]) ?? {},
  };
}

function directChildren(
  siblings: unknown,
  name: string
): XmlElement[] {
  if (!Array.isArray(siblings)) {
    return [];
  }

  const results: XmlElement[] = [];

  for (const sibling of siblings) {
    const element = getElement(sibling);

    if (element?.name === name) {
      results.push(element);
    }
  }

  return results;
}

function firstDirectChild(
  siblings: unknown,
  name: string
): XmlElement | null {
  return directChildren(siblings, name)[0] ?? null;
}

function findElement(
  value: unknown,
  name: string
): XmlElement | null {
  if (Array.isArray(value)) {
    for (const sibling of value) {
      const found = findElement(sibling, name);
      if (found) return found;
    }

    return null;
  }

  const element = getElement(value);

  if (!element) {
    return null;
  }

  if (element.name === name) {
    return element;
  }

  return findElement(element.children, name);
}

function collectElements(
  value: unknown,
  name: string,
  results: XmlElement[] = []
): XmlElement[] {
  if (Array.isArray(value)) {
    for (const sibling of value) {
      collectElements(sibling, name, results);
    }

    return results;
  }

  const element = getElement(value);

  if (!element) {
    return results;
  }

  if (element.name === name) {
    results.push(element);
  }

  collectElements(element.children, name, results);
  return results;
}

function attribute(
  element: XmlElement | null,
  name: string
): string | null {
  const value = element?.attributes[`@_w:${name}`];
  return value === undefined ? null : String(value);
}

function elementText(element: XmlElement | null): string {
  if (!element) {
    return "";
  }

  if (Array.isArray(element.children)) {
    return element.children
      .map((child) => {
        const record = asRecord(child);
        if (record?.["#text"] !== undefined) {
          return String(record["#text"]);
        }

        const childElement = getElement(child);

        if (childElement?.name === "w:t") {
          return elementText(childElement);
        }

        return childElement
          ? elementText(childElement)
          : "";
      })
      .join("");
  }

  const record = asRecord(element.children);
  const text = record?.["#text"];
  return text === undefined ? "" : String(text);
}

function getProperty(
  properties: XmlElement | null,
  name: string
): XmlElement | null {
  return properties
    ? firstDirectChild(properties.children, name)
    : null;
}

function styleSize(
  styleId: string | null,
  styles: Map<string, XmlElement>,
  visited = new Set<string>()
): string | null {
  if (!styleId || visited.has(styleId)) {
    return null;
  }

  visited.add(styleId);
  const style = styles.get(styleId);

  if (!style) {
    return null;
  }

  const runProperties = getProperty(style, "w:rPr");
  const size = attribute(getProperty(runProperties, "w:sz"), "val");

  if (size) {
    return size;
  }

  const baseStyle = attribute(
    getProperty(style, "w:basedOn"),
    "val"
  );
  return styleSize(baseStyle, styles, visited);
}

function resolveFirstRunSize(
  paragraph: XmlElement,
  firstRun: XmlElement | null,
  styles: Map<string, XmlElement>,
  documentDefaults: XmlElement | null
): string | null {
  if (!firstRun) {
    return null;
  }

  const runProperties = getProperty(firstRun, "w:rPr");
  const directSize = attribute(
    getProperty(runProperties, "w:sz"),
    "val"
  );

  if (directSize) {
    return directSize;
  }

  const characterStyle = attribute(
    getProperty(runProperties, "w:rStyle"),
    "val"
  );
  const characterStyleSize = styleSize(characterStyle, styles);

  if (characterStyleSize) {
    return characterStyleSize;
  }

  const paragraphProperties = firstDirectChild(
    paragraph.children,
    "w:pPr"
  );
  const paragraphStyle = attribute(
    getProperty(paragraphProperties, "w:pStyle"),
    "val"
  );
  const paragraphStyleSize = styleSize(paragraphStyle, styles);

  if (paragraphStyleSize) {
    return paragraphStyleSize;
  }

  const defaultRunProperties = findElement(
    documentDefaults?.children,
    "w:rPr"
  );
  return attribute(
    getProperty(defaultRunProperties, "w:sz"),
    "val"
  );
}

function formatSize(size: string | null): string {
  if (!size) {
    return "sin resolver";
  }

  const halfPoints = Number(size);
  if (!Number.isFinite(halfPoints)) {
    return `${size} (medios puntos)`;
  }

  const points = halfPoints / 2;
  return `${size} (${Number.isInteger(points) ? points : points.toFixed(1)} pt)`;
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function markdownCell(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function preview(text: string, length = 80): string {
  const normalized = normalizedText(text);
  const shortened = normalized.slice(0, length);
  return markdownCell(
    normalized.length > length ? `${shortened}…` : shortened
  );
}

function frequencyTable(
  entries: Array<[string, number]>
): string[] {
  if (entries.length === 0) {
    return ["- Ninguno"];
  }

  return entries.map(([name, count]) => `- ${name}: ${count}`);
}

function countNotes(xml: string | null, noteName: string): number {
  if (!xml) {
    return 0;
  }

  const parsed: unknown = xmlParser.parse(xml);
  return collectElements(parsed, noteName).filter((note) => {
    const id = Number(attribute(note, "id"));
    return Number.isFinite(id) && id > 0;
  }).length;
}

function buildReport(
  paragraphs: ParagraphInfo[],
  footnotesPresent: boolean,
  footnotesCount: number,
  endnotesPresent: boolean,
  endnotesCount: number,
  tableCount: number,
  drawingCount: number
): string {
  const styleCounts = new Map<string, number>();
  const sizeCounts = new Map<string, number>();

  for (const paragraph of paragraphs) {
    const style = paragraph.style ?? "sin estilo";
    styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);

    const size = formatSize(paragraph.fontSize);
    sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
  }

  const sortedCounts = (counts: Map<string, number>) =>
    [...counts.entries()].sort(
      ([left], [right]) => left.localeCompare(right, "es")
    );

  const shortest = [...paragraphs]
    .sort(
      (left, right) =>
        normalizedText(left.text).length -
          normalizedText(right.text).length ||
        left.index - right.index
    )
    .slice(0, 10);

  const lines = [
    "# Inspección del DOCX",
    "",
    "## Resumen",
    "",
    `- Párrafos hijos directos de \`w:body\`: ${paragraphs.length}`,
    "- Estilos de párrafo:",
    ...frequencyTable(sortedCounts(styleCounts)),
    "- Tamaños resueltos del primer run (el valor OOXML \`w:sz\` está en medios puntos):",
    ...frequencyTable(sortedCounts(sizeCounts)),
    `- \`footnotes.xml\`: ${footnotesPresent ? `sí (${footnotesCount} notas)` : "no"}`,
    `- \`endnotes.xml\`: ${endnotesPresent ? `sí (${endnotesCount} notas)` : "no"}`,
    `- Elementos \`w:tbl\`: ${tableCount}`,
    `- Elementos \`w:drawing\`: ${drawingCount}`,
    "",
    "## Párrafos del cuerpo",
    "",
    "| Índice | pStyle | w:sz primer run | w:framePr | Runs | Texto (primeros 80 caracteres) |",
    "| ---: | --- | --- | :---: | ---: | --- |",
    ...paragraphs.map(
      (paragraph) =>
        `| ${paragraph.index} | ${markdownCell(paragraph.style ?? "—")} | ${markdownCell(formatSize(paragraph.fontSize))} | ${paragraph.hasFrame ? "sí" : "no"} | ${paragraph.runCount} | ${preview(paragraph.text) || "—"} |`
    ),
    "",
    "## 10 párrafos más cortos",
    "",
    "| Índice | Caracteres | Texto |",
    "| ---: | ---: | --- |",
    ...shortest.map((paragraph) => {
      const text = normalizedText(paragraph.text);
      return `| ${paragraph.index} | ${text.length} | ${preview(text)} |`;
    }),
    "",
  ];

  return lines.join("\n");
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Uso: npx tsx scripts/inspect-docx.ts <archivo.docx>");
  }

  const absolutePath = path.resolve(inputPath);
  const zip = await JSZip.loadAsync(await fs.readFile(absolutePath));
  const documentFile = zip.file("word/document.xml");

  if (!documentFile) {
    throw new Error("El archivo DOCX no contiene word/document.xml");
  }

  const documentXml = await documentFile.async("text");
  const document: unknown = xmlParser.parse(documentXml);
  const body = findElement(document, "w:body");

  if (!body) {
    throw new Error("No se encontró w:body en word/document.xml");
  }

  const stylesFile = zip.file("word/styles.xml");
  const parsedStyles: unknown = stylesFile
    ? xmlParser.parse(await stylesFile.async("text"))
    : [];
  const styleElements = collectElements(parsedStyles, "w:style");
  const styles = new Map<string, XmlElement>();

  for (const style of styleElements) {
    const id = attribute(style, "styleId");
    if (id) styles.set(id, style);
  }

  const documentDefaults = findElement(parsedStyles, "w:docDefaults");
  const paragraphs = directChildren(body.children, "w:p").map(
    (paragraph, index): ParagraphInfo => {
      const paragraphProperties = firstDirectChild(
        paragraph.children,
        "w:pPr"
      );
      const style = attribute(
        getProperty(paragraphProperties, "w:pStyle"),
        "val"
      );
      const runs = collectElements(paragraph.children, "w:r");
      const firstRun = runs[0] ?? null;

      return {
        index: index + 1,
        style,
        fontSize: resolveFirstRunSize(
          paragraph,
          firstRun,
          styles,
          documentDefaults
        ),
        hasFrame:
          getProperty(paragraphProperties, "w:framePr") !== null,
        runCount: runs.length,
        text: collectElements(paragraph.children, "w:t")
          .map(elementText)
          .join(""),
      };
    }
  );

  const footnotesFile = zip.file("word/footnotes.xml");
  const endnotesFile = zip.file("word/endnotes.xml");
  const footnotesXml = footnotesFile
    ? await footnotesFile.async("text")
    : null;
  const endnotesXml = endnotesFile
    ? await endnotesFile.async("text")
    : null;

  const report = buildReport(
    paragraphs,
    footnotesFile !== null,
    countNotes(footnotesXml, "w:footnote"),
    endnotesFile !== null,
    countNotes(endnotesXml, "w:endnote"),
    collectElements(document, "w:tbl").length,
    collectElements(document, "w:drawing").length
  );

  const reportPath = path.join(
    path.dirname(absolutePath),
    `${path.parse(absolutePath).name}.inspection.md`
  );

  await fs.writeFile(reportPath, report, "utf8");
  console.log(report);
  console.log(`\nReporte guardado en: ${reportPath}`);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
