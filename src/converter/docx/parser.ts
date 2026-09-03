import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import {
  Article,
  BodyBlock,
  Note,
} from "../models/Article";

export class DocxParser {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    preserveOrder: true,
  });

  async parse(
    zip: JSZip,
    sourcePath: string
  ): Promise<Article> {
    const documentXml = await this.readRequired(
      zip,
      "word/document.xml"
    );

    const footnotesXml = await this.readOptional(
      zip,
      "word/footnotes.xml"
    );

    const endnotesXml = await this.readOptional(
      zip,
      "word/endnotes.xml"
    );

    const document = this.xmlParser.parse(documentXml);

    const footnotes = footnotesXml
      ? this.parseNotes(footnotesXml, "footnote")
      : [];

    const endnotes = endnotesXml
      ? this.parseNotes(endnotesXml, "endnote")
      : [];

    const body = this.parseBody(document);

    this.attachNoteAnchors(
      body,
      [...footnotes, ...endnotes]
    );

    return {
      document: {
        source: path.basename(sourcePath),
        format: "docx",
        normalizedFormat: "docx",
      },

      header: {
        authors: [],
        keywords: [],
        jel_codes: [],
        dates: {},
      },

      body,

      notes: [
        ...footnotes,
        ...endnotes,
      ],

      references: [],
    };
  }

  private async readRequired(
    zip: JSZip,
    filePath: string
  ): Promise<string> {
    const file = zip.file(filePath);

    if (!file) {
      throw new Error(
        `El archivo DOCX no contiene ${filePath}`
      );
    }

    return file.async("text");
  }

  private async readOptional(
    zip: JSZip,
    filePath: string
  ): Promise<string | null> {
    const file = zip.file(filePath);

    if (!file) {
      return null;
    }

    return file.async("text");
  }

  private parseBody(document: any): BodyBlock[] {
    const bodyBlocks: BodyBlock[] = [];

    const body = this.findElement(
      document,
      "w:body"
    );

    if (!body) {
      return bodyBlocks;
    }

    const paragraphs = this.findElements(
      body,
      "w:p"
    );

    for (const paragraph of paragraphs) {
      const text = this.extractParagraphText(paragraph);

      if (!text.trim()) {
        continue;
      }

      const headingLevel =
        this.getHeadingLevel(paragraph);

      if (headingLevel !== null) {
        bodyBlocks.push({
          type: "heading",
          level: headingLevel,
          text,
        });

        continue;
      }

      bodyBlocks.push({
        type: "paragraph",
        text,
      });
    }

    return bodyBlocks;
  }

  private extractParagraphText(
    paragraph: any
  ): string {
    const texts = this.findElements(
      paragraph,
      "w:t"
    );

    return texts
      .map((node) => this.extractText(node))
      .join("");
  }

  private getHeadingLevel(
    paragraph: any
  ): number | null {
    const properties = this.findElement(
      paragraph,
      "w:pPr"
    );

    if (!properties) {
      return null;
    }

    const style = this.findElement(
      properties,
      "w:pStyle"
    );

    if (!style) {
      return null;
    }

    const styleId =
      style["@_w:val"] ??
      style["@_w:val"];

    if (!styleId) {
      return null;
    }

    const match = String(styleId).match(
      /Heading([1-9])/i
    );

    if (!match) {
      return null;
    }

    return Number(match[1]);
  }

  private parseNotes(
    xml: string,
    type: "footnote" | "endnote"
  ): Note[] {
    const parsed = this.xmlParser.parse(xml);

    const noteElements = this.findElements(
      parsed,
      `w:${type}`
    );

    const notes: Note[] = [];

    for (const note of noteElements) {
      const rawId =
        note["@_w:id"] ??
        note["@_w:id"];

      if (rawId === undefined) {
        continue;
      }

      const id = Number(rawId);

      // Word utiliza IDs negativos y 0 para
      // elementos estructurales especiales.
      if (id < 1) {
        continue;
      }

      const textNodes = this.findElements(
        note,
        "w:t"
      );

      const text = textNodes
        .map((node) => this.extractText(node))
        .join("");

      notes.push({
        id,
        type,
        text,
      });
    }

    return notes;
  }

  private attachNoteAnchors(
    body: BodyBlock[],
    notes: Note[]
  ): void {
    /*
     * Buscamos nuevamente las referencias directamente
     * dentro de los bloques. En esta primera versión
     * usamos una estrategia sencilla.
     *
     * La posición exacta se implementará cuando
     * pasemos de "texto plano" a runs inline.
     */
  }

  private extractText(node: any): string {
    if (typeof node === "string") {
      return node;
    }

    if (node?.["#text"] !== undefined) {
      return String(node["#text"]);
    }

    return "";
  }

  private findElement(
    root: any,
    name: string
  ): any | null {
    if (!root) {
      return null;
    }

    if (Array.isArray(root)) {
      for (const item of root) {
        const result = this.findElement(
          item,
          name
        );

        if (result) {
          return result;
        }
      }

      return null;
    }

    if (typeof root !== "object") {
      return null;
    }

    if (root[name]) {
      return root[name];
    }

    for (const value of Object.values(root)) {
      const result = this.findElement(
        value,
        name
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  private findElements(
    root: any,
    name: string
  ): any[] {
    const results: any[] = [];

    this.collectElements(
      root,
      name,
      results
    );

    return results;
  }

  private collectElements(
    root: any,
    name: string,
    results: any[]
  ): void {
    if (!root) {
      return;
    }

    if (Array.isArray(root)) {
      for (const item of root) {
        this.collectElements(
          item,
          name,
          results
        );
      }

      return;
    }

    if (typeof root !== "object") {
      return;
    }

    if (root[name]) {
      const value = root[name];

      if (Array.isArray(value)) {
        results.push(...value);
      } else {
        results.push(value);
      }
    }

    for (const value of Object.values(root)) {
      this.collectElements(
        value,
        name,
        results
      );
    }
  }
}