export interface Article {
  document: {
    source: string;
    format: "doc" | "docx";
    normalizedFormat: "docx";
  };

  header: {
    title?: string;
    title_en?: string;
    authors: string[];
    affiliations: string[];
    abstract?: string;
    keywords: string[];
    jel_codes: string[];

    doi?: string;
    orcid?: string;
    section?: string;

    dates: {
      received?: string;
      accepted?: string;
      published?: string;
    };
  };

  body: BodyBlock[];

  notes: Note[];

  references: Reference[];

  warnings: ParseWarning[];
}

export interface ParseWarning {
  code: string;
  message: string;
  blockIndex?: number;
}

export interface Note {
  id: number;
  type: "footnote" | "endnote";
  text: string;

  anchor?: {
    blockIndex: number;
    offset: number;
  };
}

export interface Reference {
  raw: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

export type InlineRun =
  | { type: "text"; text: string; bold?: boolean; italic?: boolean }
  | { type: "noteRef"; noteId: number; noteType: "footnote" | "endnote" };

export interface HeadingBlock {
  type: "heading";
  level: number;
  runs: InlineRun[];
}

export interface ParagraphBlock {
  type: "paragraph";
  runs: InlineRun[];
}

export interface TableBlock {
  type: "table";
  headers: string[];
  rows: string[][];
}

export interface ImageBlock {
  type: "image";
  rId: string;
  fileName: string;
  alt?: string;
}

export type BodyBlock =
  | HeadingBlock
  | ParagraphBlock
  | TableBlock
  | ImageBlock;