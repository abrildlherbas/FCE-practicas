import fs from "node:fs/promises";
import path from "node:path";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";
import JSZip from "jszip";

import {
  BodyBlock,
  ImageBlock,
  ParseWarning,
  TableBlock,
} from "../models/Article";

const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface ImageRelationship {
  target: string;
  isImage: boolean;
}

export interface ExtractedBodyBlocks {
  blocksByBodyIndex: Map<number, BodyBlock[]>;
  warnings: ParseWarning[];
}

function isElement(node: XmlNode): node is XmlElement {
  return node.nodeType === 1;
}

function childElements(element: XmlElement): XmlElement[] {
  return Array.from(element.childNodes).filter(isElement);
}

function bodyContentElements(body: XmlElement): XmlElement[] {
  const elements: XmlElement[] = [];
  const visit = (children: XmlElement[]): void => {
    for (const child of children) {
      if (
        child.namespaceURI === WORD_NS &&
        child.localName === "del"
      ) {
        continue;
      }
      if (
        child.namespaceURI === WORD_NS &&
        child.localName === "sdt"
      ) {
        const content = childElements(child).find(
          (element) =>
            element.namespaceURI === WORD_NS &&
            element.localName === "sdtContent"
        );
        if (content) visit(childElements(content));
        continue;
      }
      if (
        child.namespaceURI === WORD_NS &&
        child.localName === "ins"
      ) {
        visit(childElements(child));
        continue;
      }
      if (
        child.localName === "AlternateContent" &&
        child.namespaceURI === "http://schemas.openxmlformats.org/markup-compatibility/2006"
      ) {
        const branches = childElements(child);
        const choice = branches.find(
          (branch) => branch.localName === "Choice"
        ) ?? branches.find((branch) => branch.localName === "Fallback");
        if (choice) visit(childElements(choice));
        continue;
      }
      elements.push(child);
    }
  };
  visit(childElements(body));
  return elements;
}

function descendants(
  element: XmlElement,
  localName: string
): XmlElement[] {
  const results: XmlElement[] = [];

  for (const child of childElements(element)) {
    if (
      child.namespaceURI === WORD_NS &&
      child.localName === "del"
    ) {
      continue;
    }
    if (
      child.localName === "AlternateContent" &&
      child.namespaceURI === "http://schemas.openxmlformats.org/markup-compatibility/2006"
    ) {
      const branches = childElements(child);
      const choice = branches.find(
        (branch) => branch.localName === "Choice"
      ) ?? branches.find((branch) => branch.localName === "Fallback");
      if (choice) results.push(...descendants(choice, localName));
      continue;
    }
    if (child.localName === localName) {
      results.push(child);
    }
    results.push(...descendants(child, localName));
  }

  return results;
}

function parseXml(xml: string, name: string): XmlDocument {
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(`No se pudo leer ${name}: ${message}`);
    },
  }).parseFromString(xml, "application/xml");
}

function tableCellText(cell: XmlElement): string {
  return childElements(cell)
    .filter(
      (element) =>
        element.namespaceURI === WORD_NS &&
        element.localName === "p"
    )
    .map((paragraph) => visibleText(paragraph))
    .join("\n")
    .trim();
}

function visibleText(element: XmlElement): string {
  const parts: string[] = [];
  const visit = (node: XmlNode): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (isElement(node)) {
      if (
        node.namespaceURI === WORD_NS &&
        node.localName !== null &&
        ["del", "delText", "instrText"].includes(node.localName)
      ) return;
      if (
        node.localName === "AlternateContent" &&
        node.namespaceURI === "http://schemas.openxmlformats.org/markup-compatibility/2006"
      ) {
        const branches = childElements(node);
        const choice = branches.find(
          (branch) => branch.localName === "Choice"
        ) ?? branches.find((branch) => branch.localName === "Fallback");
        if (choice) visit(choice);
        return;
      }
      if (node.namespaceURI === WORD_NS && node.localName === "tab") {
        parts.push(" ");
        return;
      }
      if (node.namespaceURI === WORD_NS && node.localName === "br") {
        parts.push("\n");
        return;
      }
      if (node.namespaceURI === WORD_NS && node.localName === "noBreakHyphen") {
        parts.push("-");
        return;
      }
      if (
        node.namespaceURI === WORD_NS &&
        node.localName === "softHyphen"
      ) return;
      if (node.namespaceURI === WORD_NS && node.localName === "sym") {
        const symChar = node.getAttributeNS(WORD_NS, "char");
        const code = symChar ? Number.parseInt(symChar, 16) : Number.NaN;
        if (
          Number.isInteger(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff)
        ) {
          parts.push(String.fromCodePoint(code));
        }
        return;
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  };
  visit(element);
  return parts.join("");
}

function isHeaderRow(row: XmlElement): boolean {
  const rowProperties = childElements(row).find(
    (element) =>
      element.namespaceURI === WORD_NS &&
      element.localName === "trPr"
  );
  if (!rowProperties) return false;

  const headerMarker = childElements(rowProperties).find(
    (element) =>
      element.namespaceURI === WORD_NS &&
      element.localName === "tblHeader"
  );
  if (!headerMarker) return false;

  const value = (
    headerMarker.getAttributeNS(WORD_NS, "val") ?? ""
  ).toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

function convertTable(table: XmlElement): TableBlock {
  const rows = childElements(table).filter(
    (element) =>
      element.namespaceURI === WORD_NS &&
      element.localName === "tr"
  );
  const headerRows = rows.filter(isHeaderRow);
  const cellsForRow = (row: XmlElement): string[] =>
    childElements(row)
      .filter(
        (element) =>
          element.namespaceURI === WORD_NS &&
          element.localName === "tc"
      )
      .map(tableCellText);
  const headerCellRows = headerRows.map(cellsForRow);
  const headerColumnCount = Math.max(
    0,
    ...headerCellRows.map((cells) => cells.length)
  );
  const tableProperties = childElements(table).find(
    (element) =>
      element.namespaceURI === WORD_NS &&
      element.localName === "tblPr"
  );
  const captionElement = tableProperties
    ? childElements(tableProperties).find(
        (element) =>
          element.namespaceURI === WORD_NS &&
          element.localName === "tblCaption"
      )
    : undefined;
  const caption = captionElement?.getAttributeNS(WORD_NS, "val")?.trim();

  return {
    type: "table",
    ...(caption ? { caption } : {}),
    headers: Array.from(
      { length: headerColumnCount },
      (_, columnIndex) =>
        headerCellRows
          .map((cells) => cells[columnIndex])
          .filter(Boolean)
          .join(" / ")
    ),
    rows: rows
      .filter((row) => !headerRows.includes(row))
      .map(cellsForRow),
  };
}

function readImageRelationships(
  relationshipsXml: string | null
): Map<string, ImageRelationship> {
  if (!relationshipsXml) return new Map();

  const document = parseXml(
    relationshipsXml,
    "word/_rels/document.xml.rels"
  );
  const relationships = new Map<string, ImageRelationship>();

  for (const relation of Array.from(
    document.getElementsByTagName("*")
  )) {
    if (relation.localName !== "Relationship") continue;

    const id = relation.getAttribute("Id");
    const target = relation.getAttribute("Target");
    const type = relation.getAttribute("Type") ?? "";
    if (!id || !target) continue;

    relationships.set(id, {
      target,
      isImage: type.endsWith("/image"),
    });
  }

  return relationships;
}

function getImageIds(container: XmlElement): string[] {
  const imageElements = [
    ...descendants(container, "blip"),
    ...descendants(container, "imagedata"),
  ];

  return imageElements
    .map(
      (element) =>
        element.getAttributeNS(RELATIONSHIP_NS, "embed") ||
        element.getAttributeNS(RELATIONSHIP_NS, "id")
    )
    .filter((id): id is string => id !== "");
}

function getImageAlt(container: XmlElement): string | undefined {
  for (const element of [
    ...descendants(container, "docPr"),
    ...descendants(container, "cNvPr"),
    ...descendants(container, "shape"),
  ]) {
    const alt =
      (element.getAttribute("descr") ?? "").trim() ||
      (element.getAttribute("alt") ?? "").trim() ||
      (element.getAttribute("title") ?? "").trim();
    if (alt) return alt;
  }

  return undefined;
}

function getImageCaption(container: XmlElement): string | undefined {
  const caption = descendants(container, "caption").find(
    (element) => element.namespaceURI === WORD_NS
  );
  const text = caption?.textContent?.trim();
  return text || undefined;
}

function toZipPath(target: string): string {
  const packagePath = target.startsWith("/")
    ? target.slice(1)
    : path.posix.join("word", target);
  const normalized = path.posix.normalize(packagePath);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`La ruta de imagen OOXML no es válida: ${target}`);
  }

  return normalized;
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export class DocxBodyBlockExtractor {
  async extract(
    documentXml: string,
    relationshipsXml: string | null,
    zip: JSZip,
    sourcePath: string
  ): Promise<ExtractedBodyBlocks> {
    const document = parseXml(documentXml, "word/document.xml");
    const body = Array.from(
      document.getElementsByTagNameNS(WORD_NS, "body")
    )[0];
    if (!body) {
      throw new Error("El archivo DOCX no contiene w:body.");
    }

    const relationships =
      readImageRelationships(relationshipsXml);
    const blocksByBodyIndex = new Map<number, BodyBlock[]>();
    const warnings: ParseWarning[] = [];
    const bodyChildren = bodyContentElements(body);
    const assetsDirectory = path.join(
      path.dirname(sourcePath),
      `${path.parse(sourcePath).name}_assets`
    );
    const writtenRelationships = new Set<string>();
    let assetsDirectoryCreated = false;

    for (const [blockIndex, element] of bodyChildren.entries()) {
      const blocks: BodyBlock[] = [];

      if (
        element.namespaceURI === WORD_NS &&
        element.localName === "tbl"
      ) {
        blocks.push(convertTable(element));
      }
      for (const textBox of descendants(element, "txbxContent")) {
        for (const paragraph of descendants(textBox, "p")) {
          const text = visibleText(paragraph).trim();
          if (text) {
            blocks.push({
              type: "paragraph",
              runs: [{ type: "text", text }],
            });
          }
        }
      }

      const imageContainers = descendants(element, "drawing").concat(
        descendants(element, "pict")
      );
      for (const container of imageContainers) {
        const imageIds = getImageIds(container);
        const alt = getImageAlt(container);
        const caption = getImageCaption(container);
        if (imageIds.length === 0) {
          warnings.push({
            code: "unrecognized-image",
            message:
              "Se encontró un dibujo o imagen OOXML sin una relación de imagen reconocible.",
            blockIndex,
            status: "pendiente",
          });
          continue;
        }

        for (const rId of imageIds) {
          const relationship = relationships.get(rId);
          if (!relationship?.isImage) {
            warnings.push({
              code: "unresolved-image-relationship",
              message: `No se pudo resolver la relación ${rId} de una imagen.`,
              blockIndex,
              status: "pendiente",
            });
            continue;
          }

          const zipPath = toZipPath(relationship.target);
          const imageFile = zip.file(zipPath);
          if (!imageFile) {
            warnings.push({
              code: "missing-image-file",
              message: `No se encontró el archivo de imagen ${zipPath} dentro del DOCX.`,
              blockIndex,
              status: "pendiente",
            });
            continue;
          }

          const fileName = `${safeFilePart(rId)}_${path.posix.basename(zipPath)}`;
          if (!writtenRelationships.has(rId)) {
            if (!assetsDirectoryCreated) {
              await fs.mkdir(assetsDirectory, { recursive: true });
              assetsDirectoryCreated = true;
            }
            await fs.writeFile(
              path.join(assetsDirectory, fileName),
              await imageFile.async("nodebuffer")
            );
            writtenRelationships.add(rId);
          }

          const imageBlock: ImageBlock = {
            type: "image",
            rId,
            fileName,
            ...(alt ? { alt } : {}),
            ...(caption ? { caption } : {}),
          };
          blocks.push(imageBlock);

          if (!alt) {
            warnings.push({
              code: "image-missing-alt",
              message: `La imagen ${rId} no tiene texto alternativo.`,
              blockIndex,
              status: "pendiente",
            });
          }
        }
      }

      if (blocks.length > 0) {
        blocksByBodyIndex.set(blockIndex, blocks);
      }
    }

    return { blocksByBodyIndex, warnings };
  }
}
