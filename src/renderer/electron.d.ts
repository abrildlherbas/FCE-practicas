export {};

declare global {
  interface Window {
    electronAPI: {
      selectDocument(): Promise<string | null>;

      convertDocument(
        filePath: string
      ): Promise<unknown>;
    };
  }
}