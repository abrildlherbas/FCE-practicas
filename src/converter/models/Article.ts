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
    abstract?: string;
    keywords: string[];
    jel_codes: string[];

    doi?: string;
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
  text: string;
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

export type BodyBlock = HeadingBlock | ParagraphBlock;