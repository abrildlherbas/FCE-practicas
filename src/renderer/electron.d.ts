export {};

import type { Article } from "../converter/models/Article";

declare global {
  interface Window {
    electronAPI: {
      selectDocument(): Promise<string | null>;

      convertDocument(filePath: string): Promise<Article>;

      preparePreview(html: string): Promise<string>;

      exportArticle(html: string): Promise<string | null>;

      openSavedArticleFolder(): Promise<void>;
    };
  }
}