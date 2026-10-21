import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";
import { afterAll, describe, expect, it } from "vitest";

import { DocxParser } from "../src/converter/docx/parser";
import { renderArticle } from "../src/renderer-html/renderArticle";

const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fixturePath = fileURLToPath(
  new URL("./fixtures/Carbonel_Cielo.docx", import.meta.url)
);
const temporaryDirectories: string[] = [];

function parseXml(xml: string, label: string): XmlDocument {
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(`No se pudo leer ${label}: ${message}`);
    },
  }).parseFromString(xml, "application/xml");
}

function collectText(node: XmlNode): string {
  if (node.nodeType === 3 || node.nodeType === 4) {
    return node.nodeValue ?? "";
  }

  let text = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text += collectText(child);
  }
  return text;
}

function paragraphText(paragraph: XmlElement): string {
  const parts: string[] = [];

  const visit = (node: XmlNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        const element = child as XmlElement;
        if (
          element.namespaceURI === WORD_NS &&
          element.localName === "p"
        ) {
          continue;
        }
        if (
          element.namespaceURI === WORD_NS &&
          element.localName === "t"
        ) {
          parts.push(collectText(element));
          continue;
        }
      }
      visit(child);
    }
  };

  visit(paragraph);
  return parts.join("");
}

function extractWordParagraphs(documentXml: string): string[] {
  const document = parseXml(documentXml, "word/document.xml");
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(WORD_NS, "p")
  );
  return paragraphs
    .map(paragraphText)
    .filter((text) => text.trim().length > 0);
}

function extractVisibleHtmlText(html: string): string {
  const document = parseXml(
    html.replace(/^\s*<!doctype html>\s*/i, ""),
    "HTML generado"
  );
  const article = document.getElementsByTagName("article").item(0);
  if (!article) {
    throw new Error("El HTML generado no contiene el artículo.");
  }

  const blockElements = new Set([
    "p",
    "section",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "tr",
    "td",
    "th",
    "caption",
    "figure",
  ]);
  const parts: string[] = [];

  const visit = (node: XmlNode): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType === 1) {
      const element = node as XmlElement;
      if (element.localName === "style" || element.localName === "script") {
        return;
      }
      const elementName = element.localName ?? "";
      if (blockElements.has(elementName)) parts.push(" ");
      for (let child = element.firstChild; child; child = child.nextSibling) {
        visit(child);
      }
      if (blockElements.has(elementName)) parts.push(" ");
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  };

  visit(article);
  return parts.join("");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  return normalized ? normalized.split(" ") : [];
}

function missingParagraphs(
  paragraphs: string[],
  htmlWords: string[]
): string[] {
  const visibleText = compactText(htmlWords.join(" "));
  return paragraphs.filter((paragraph) => {
    const paragraphText = compactText(paragraph);
    return paragraphText.length > 0 && !visibleText.includes(paragraphText);
  });
}

function compactText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function findJoinedWordPairs(
  paragraphs: string[],
  htmlText: string
): string[] {
  const htmlTokens = words(htmlText)
    .map(compactText)
    .filter((word) => word.length > 0);
  const htmlTextWithoutSeparators = htmlTokens.join("");
  const htmlWordBoundaries = new Set<number>();
  let htmlOffset = 0;
  for (const word of htmlTokens) {
    htmlOffset += word.length;
    htmlWordBoundaries.add(htmlOffset);
  }
  const joinedPairs = new Set<string>();

  for (const paragraph of paragraphs) {
    const paragraphWords = words(paragraph)
      .map((word) => ({ original: word, compact: compactText(word) }))
      .filter((word) => word.compact.length > 0);
    const compactParagraph = paragraphWords
      .map((word) => word.compact)
      .join("");
    if (!compactParagraph) continue;

    let paragraphOffset = htmlTextWithoutSeparators.indexOf(compactParagraph);
    while (paragraphOffset !== -1) {
      let wordOffset = 0;
      for (let index = 0; index < paragraphWords.length - 1; index++) {
        wordOffset += paragraphWords[index].compact.length;
        if (!htmlWordBoundaries.has(paragraphOffset + wordOffset)) {
          joinedPairs.add(
            `${paragraphWords[index].original} ${paragraphWords[index + 1].original}`
          );
        }
      }
      paragraphOffset = htmlTextWithoutSeparators.indexOf(
        compactParagraph,
        paragraphOffset + 1
      );
    }
  }

  return [...joinedPairs];
}

function describeSequenceDifference(
  sourceWords: string[],
  htmlWords: string[]
): string {
  let index = 0;
  while (
    index < sourceWords.length &&
    index < htmlWords.length &&
    sourceWords[index] === htmlWords[index]
  ) {
    index++;
  }

  return [
    `Primera diferencia en la palabra ${index + 1}.`,
    `Word: ${JSON.stringify(sourceWords.slice(index, index + 12))}`,
    `HTML: ${JSON.stringify(htmlWords.slice(index, index + 12))}`,
    `Cantidad de palabras: Word ${sourceWords.length}; HTML ${htmlWords.length}.`,
  ].join("\n");
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("fidelidad del contenido de Carbonel_Cielo", () => {
  it("conserva en el HTML la secuencia completa de palabras del Word", async () => {
    const zip = await JSZip.loadAsync(await fs.readFile(fixturePath));
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) {
      throw new Error("La fixture no contiene word/document.xml.");
    }

    const sourceParagraphs = extractWordParagraphs(
      await documentFile.async("text")
    );
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "article-fidelity-")
    );
    temporaryDirectories.push(temporaryDirectory);
    const article = await new DocxParser().parse(
      zip,
      path.join(temporaryDirectory, "source", "Carbonel_Cielo.docx")
    );
    const html = renderArticle(article);
    const sourceWords = words(sourceParagraphs.join(" "));
    const visibleHtmlText = extractVisibleHtmlText(html);
    const htmlWords = words(visibleHtmlText);
    const missing = missingParagraphs(sourceParagraphs, htmlWords);
    const joinedWordPairs = findJoinedWordPairs(
      sourceParagraphs,
      visibleHtmlText
    );
    const diagnostics = [
      `Párrafos no encontrados ni considerando diferencias de formato (${missing.length}):`,
      ...missing.map(
        (paragraph, index) => `${index + 1}. ${JSON.stringify(paragraph)}`
      ),
      `Posibles palabras pegadas (${joinedWordPairs.length}; primeros 20):`,
      ...joinedWordPairs
        .slice(0, 20)
        .map((pair) => `- ${JSON.stringify(pair)}`),
      describeSequenceDifference(sourceWords, htmlWords),
    ].join("\n");

    expect(
      htmlWords,
      `El HTML no conserva el texto del Word.\n${diagnostics}`
    ).toEqual(sourceWords);
  });
});
