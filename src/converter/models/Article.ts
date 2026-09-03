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

export type BodyBlock =
  | {
      type: "heading";
      level: number;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "table";
      id: string;
      caption?: string;
      headers: string[];
      rows: string[][];
    }
  | {
      type: "figure";
      id: string;
      caption?: string;
      src: string;
      alt?: string;
    };

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