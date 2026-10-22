export interface Article {
  document: {
    source: string;
    format: "doc" | "docx";
    normalizedFormat: "docx";
  };

  header: {
    title?: string;
    title_en?: string;
    sourceParagraphs?: string[];
    authors: ArticleAuthor[];
    affiliations: ArticleAffiliation[];
    abstract?: string;
    abstract_en?: string;
    keywords: string[];
    keywords_en: string[];
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

export interface ArticleAuthor {
  name: string;
  affiliations: string[];
  orcid?: string;
}

export interface ArticleAffiliation {
  id: string;
  text: string;
}

export interface ParseWarning {
  code: string;
  message: string;
  blockIndex?: number;
  blockId?: string;
  status: "pendiente" | "resuelto";
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
  id: string;
  raw: string;
  authors?: string[];
  year?: number;
}

export type InlineRun =
  | { type: "text"; text: string; bold?: boolean; italic?: boolean }
  | { type: "noteRef"; noteId: number; noteType: "footnote" | "endnote" }
  | {
      type: "citation";
      text: string;
      referenceId: string;
      citationId: string;
      bold?: boolean;
      italic?: boolean;
    };

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