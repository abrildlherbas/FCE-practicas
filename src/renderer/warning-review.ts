import type { Article, ParseWarning } from "../converter/models/Article";

export function pendingWarnings(warnings: ParseWarning[]): ParseWarning[] {
  return warnings.filter((warning) => warning.status === "pendiente");
}

export function resolveWarning(
  article: Article,
  warning: ParseWarning
): void {
  const target = article.warnings.find(
    (candidate) =>
      candidate.code === warning.code &&
      candidate.message === warning.message &&
      candidate.blockId === warning.blockId &&
      candidate.status === "pendiente"
  );
  if (target) target.status = "resuelto";
}

export function focusWarningBlock(
  previewDocument: Document,
  blockId: string | undefined
): HTMLElement | null {
  if (!blockId) return null;

  previewDocument
    .querySelectorAll<HTMLElement>("[data-bloque-id].warning-highlight")
    .forEach((element) => element.classList.remove("warning-highlight"));
  const block = Array.from(
    previewDocument.querySelectorAll<HTMLElement>("[data-bloque-id]")
  ).find((element) => element.dataset.bloqueId === blockId) ?? null;
  if (!block) return null;

  let highlightStyle = previewDocument.getElementById(
    "warning-highlight-style"
  );
  if (!highlightStyle) {
    highlightStyle = previewDocument.createElement("style");
    highlightStyle.id = "warning-highlight-style";
    highlightStyle.textContent =
      ".warning-highlight{outline:3px solid #c2410c!important;outline-offset:4px!important;background-color:#fff4cc!important}";
    previewDocument.head.append(highlightStyle);
  }

  block.classList.add("warning-highlight");
  block.scrollIntoView?.({ behavior: "smooth", block: "center" });
  return block;
}
