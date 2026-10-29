export {};

import type { Article, ParseWarning } from "../converter/models/Article";
import type { ArticleEditState } from "../main/article-storage";

declare global {
  interface Window {
    electronAPI: {
      selectDocument(): Promise<string | null>;

      convertDocument(filePath: string): Promise<Article>;

      saveWarningStates(
        filePath: string,
        warnings: ParseWarning[]
      ): Promise<void>;

      preparePreview(html: string, filePath?: string): Promise<string>;

      activateDocument(filePath: string): Promise<void>;

      loadArticleEditState(filePath: string): Promise<ArticleEditState>;

      saveArticleEditState(
        filePath: string,
        state: ArticleEditState
      ): Promise<void>;

      setEditorDraftStatus(dirty: boolean): void;

      exportArticle(html: string): Promise<string | null>;

      openSavedArticleFolder(): Promise<void>;
    };
  }
}