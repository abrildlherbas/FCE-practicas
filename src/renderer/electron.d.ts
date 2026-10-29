export {};

import type { Article, ParseWarning } from "../converter/models/Article";

declare global {
  interface Window {
    electronAPI: {
      selectDocument(): Promise<string | null>;

      convertDocument(filePath: string): Promise<Article>;

      saveWarningStates(
        filePath: string,
        warnings: ParseWarning[]
      ): Promise<void>;

      preparePreview(html: string): Promise<string>;

      exportArticle(html: string): Promise<string | null>;

      openSavedArticleFolder(): Promise<void>;
    };
  }
}