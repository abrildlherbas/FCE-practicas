import type {
  Article,
  ParseWarning,
} from "../converter/models/Article";

export interface NumberedWarning {
  warning: ParseWarning;
  number: number;
}

export type WarningFilter = "todos" | "pendientes" | "resueltos";

export function warningCounts(warnings: ParseWarning[]): {
  pending: number;
  resolved: number;
} {
  const pending = warnings.filter(
    (warning) => warning.status === "pendiente"
  ).length;
  return { pending, resolved: warnings.length - pending };
}

export function pendingWarnings(warnings: ParseWarning[]): ParseWarning[] {
  return warnings.filter((warning) => warning.status === "pendiente");
}

export function numberedWarnings(warnings: ParseWarning[]): NumberedWarning[] {
  return warnings
    .map((warning, index) => ({
      warning,
      number: warning.ordinal ?? index + 1,
    }))
    .sort((left, right) => left.number - right.number);
}

export function filterWarnings(
  warnings: NumberedWarning[],
  filter: WarningFilter
): NumberedWarning[] {
  if (filter === "todos") return warnings;
  const status = filter === "pendientes" ? "pendiente" : "resuelto";
  return warnings.filter((entry) => entry.warning.status === status);
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
      candidate.id === warning.id &&
      candidate.start === warning.start &&
      candidate.end === warning.end &&
      candidate.status === "pendiente"
  );
  if (target) target.status = "resuelto";
}

function rangeForWarning(
  previewDocument: Document,
  block: HTMLElement,
  warning: Pick<ParseWarning, "start" | "end" | "affectedText">
): Range | null {
  const { start, end, affectedText } = warning;
  if (
    start === undefined ||
    end === undefined ||
    start < 0 ||
    end <= start
  ) {
    return null;
  }

  const textNodes = warningTextNodes(previewDocument, block);
  let totalLength = 0;
  for (const textNode of textNodes) totalLength += textNode.length;
  if (end > totalLength) return null;

  const range = previewDocument.createRange();
  let offset = 0;
  let hasStart = false;
  let selectedText = "";
  for (const textNode of textNodes) {
    const nodeEnd = offset + textNode.length;
    const overlapStart = Math.max(start, offset);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapStart < overlapEnd) {
      selectedText += textNode.data.slice(
        overlapStart - offset,
        overlapEnd - offset
      );
      if (!hasStart) {
        range.setStart(textNode, overlapStart - offset);
        hasStart = true;
      }
      range.setEnd(textNode, overlapEnd - offset);
    }
    offset = nodeEnd;
  }
  if (!hasStart || range.collapsed) return null;
  if (affectedText !== undefined && selectedText !== affectedText) {
    return null;
  }
  return range;
}

function warningTextNodes(document: Document, block: HTMLElement): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(block, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 3) continue;
    const textNode = node as Text;
    if (textNode.parentElement?.closest("[data-app-warning-marker]")) {
      continue;
    }
    textNodes.push(textNode);
  }
  return textNodes;
}

function wrapWarningRange(
  previewDocument: Document,
  block: HTMLElement,
  warning: Pick<ParseWarning, "start" | "end" | "affectedText">,
  attribute: string,
  className: string
): HTMLElement | null {
  if (!rangeForWarning(previewDocument, block, warning)) return null;
  const { start, end } = warning;
  if (start === undefined || end === undefined) return null;

  const nodes = warningTextNodes(previewDocument, block);
  let offset = 0;
  const selected: Array<{ node: Text; start: number; end: number }> = [];
  for (const node of nodes) {
    const nodeEnd = offset + node.length;
    const overlapStart = Math.max(start, offset);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapStart < overlapEnd) {
      selected.push({
        node,
        start: overlapStart - offset,
        end: overlapEnd - offset,
      });
    }
    offset = nodeEnd;
  }

  let lastAnnotation: HTMLElement | null = null;
  for (const segment of selected) {
    const selectedNode = segment.node.splitText(segment.start);
    selectedNode.splitText(segment.end - segment.start);
    const annotation = previewDocument.createElement("span");
    annotation.setAttribute(attribute, "");
    annotation.className = className;
    const parent = selectedNode.parentNode;
    if (!parent) continue;
    parent.replaceChild(annotation, selectedNode);
    annotation.append(selectedNode);
    lastAnnotation = annotation;
  }
  return lastAnnotation;
}

export function focusWarningBlock(
  previewDocument: Document,
  warning: Pick<
    ParseWarning,
    "blockId" | "start" | "end" | "affectedText"
  >
): HTMLElement | null {
  const { blockId } = warning;
  if (!blockId || !/^b-\d+$/.test(blockId)) return null;

  previewDocument
    .querySelector<HTMLElement>("[data-bloque-id].warning-highlight")
    ?.classList.remove("warning-highlight");
  unwrapWarningDecorations(
    previewDocument,
    "[data-app-warning-focus-highlight]"
  );
  previewDocument.defaultView?.getSelection()?.removeAllRanges();
  const block = previewDocument.querySelector<HTMLElement>(
    `[data-bloque-id="${blockId}"]`
  );
  if (!block) return null;

  let highlightStyle = previewDocument.getElementById(
    "warning-highlight-style"
  );
  if (!highlightStyle) {
    highlightStyle = previewDocument.createElement("style");
    highlightStyle.id = "warning-highlight-style";
    highlightStyle.textContent =
      ".warning-highlight{outline:3px solid #c2410c!important;outline-offset:4px!important;background-color:#fff4cc!important}.warning-highlight::selection,.warning-highlight *::selection{background:#fdba74;color:#431407}.warning-focus-range{background:#fdba74!important;text-decoration:underline;text-decoration-color:#9a3412;text-decoration-thickness:2px}";
    previewDocument.head.append(highlightStyle);
  }

  if (!block.hasAttribute("tabindex")) {
    block.tabIndex = -1;
    block.setAttribute("data-app-warning-focus-tabindex", "");
  }
  block.classList.add("warning-highlight");
  block.focus({ preventScroll: true });
  block.scrollIntoView?.({ behavior: "smooth", block: "center" });
  wrapWarningRange(
    previewDocument,
    block,
    warning,
    "data-app-warning-focus-highlight",
    "warning-focus-range"
  );
  const range = rangeForWarning(previewDocument, block, warning);
  if (range) {
    previewDocument.defaultView
      ?.getSelection()
      ?.addRange(range);
  }
  return block;
}

function addWarningMarker(
  document: Document,
  block: HTMLElement,
  entry: NumberedWarning
): void {
  const marker = document.createElement("sup");
  marker.className = "warning-annotation-marker";
  marker.setAttribute("data-app-warning-marker", entry.warning.id ?? "");
  marker.setAttribute(
    "aria-label",
    `Error ${entry.number}: ${entry.warning.message}`
  );
  marker.setAttribute("contenteditable", "false");
  marker.textContent = String(entry.number);
  block.append(marker);
}

export function annotateWarningFragments(
  previewDocument: Document,
  warnings: NumberedWarning[]
): void {
  clearWarningAnnotations(previewDocument);
  const entriesByBlock = new Map<string, NumberedWarning[]>();
  for (const entry of warnings) {
    const blockId = entry.warning.blockId;
    if (!blockId) continue;
    const entries = entriesByBlock.get(blockId) ?? [];
    entries.push(entry);
    entriesByBlock.set(blockId, entries);
  }
  if (!entriesByBlock.size) return;

  const style = previewDocument.createElement("style");
  style.setAttribute("data-app-warning-style", "");
  style.textContent =
    "[data-app-warning-annotation]{background:#fff0c2;text-decoration:underline;text-decoration-color:#c2410c;text-decoration-thickness:2px;text-underline-offset:2px}.warning-annotation-block{outline:2px dashed #c2410c!important;outline-offset:3px!important}.warning-annotation-marker{display:inline-block;margin-inline:.25em;border-radius:999px;padding:0 .4em;background:#c2410c;color:#fff;font:700 .75em/1.6 sans-serif;vertical-align:super}";
  previewDocument.head.append(style);

  for (const [blockId, entries] of entriesByBlock) {
    if (!/^b-\d+$/.test(blockId)) continue;
    const block = previewDocument.querySelector<HTMLElement>(
      `[data-bloque-id="${blockId}"]`
    );
    if (!block) continue;

    for (const entry of entries.sort(
      (left, right) =>
        (right.warning.start ?? -1) - (left.warning.start ?? -1)
    )) {
      const range = rangeForWarning(
        previewDocument,
        block,
        entry.warning
      );
        if (range) {
          const lastAnnotation = wrapWarningRange(
            previewDocument,
            block,
            entry.warning,
            "data-app-warning-annotation",
            "warning-annotation-fragment"
          );
          if (lastAnnotation?.parentElement) {
          const marker = previewDocument.createElement("sup");
          marker.className = "warning-annotation-marker";
          marker.setAttribute(
            "data-app-warning-marker",
            entry.warning.id ?? ""
          );
          marker.setAttribute(
            "aria-label",
            `Error ${entry.number}: ${entry.warning.message}`
          );
          marker.setAttribute("contenteditable", "false");
          marker.textContent = String(entry.number);
          lastAnnotation.after(marker);
          continue;
        }
      }

      block.classList.add("warning-annotation-block");
      addWarningMarker(previewDocument, block, entry);
    }
  }
}

export function clearWarningAnnotations(previewDocument: Document): void {
  unwrapWarningDecorations(
    previewDocument,
    "[data-app-warning-marker]"
  );
  unwrapWarningDecorations(
    previewDocument,
    "[data-app-warning-annotation]"
  );
  unwrapWarningDecorations(
    previewDocument,
    "[data-app-warning-focus-highlight]"
  );
  previewDocument
    .querySelectorAll(".warning-highlight, .warning-annotation-block")
    .forEach((element) =>
      element.classList.remove(
        "warning-highlight",
        "warning-annotation-block"
      )
    );
  previewDocument
    .querySelectorAll("[data-app-warning-focus-tabindex]")
    .forEach((element) => {
      element.removeAttribute("tabindex");
      element.removeAttribute("data-app-warning-focus-tabindex");
    });
  previewDocument
    .querySelectorAll(
      "#warning-highlight-style, [data-app-warning-style]"
    )
    .forEach((style) => style.remove());
  previewDocument.defaultView?.getSelection()?.removeAllRanges();
}

function unwrapWarningDecorations(
  previewDocument: Document,
  selector: string
): void {
  previewDocument
    .querySelectorAll<HTMLElement>(selector)
    .forEach((annotation) => {
      const parent = annotation.parentNode;
      if (!parent) return;
      if (annotation.tagName === "SUP") {
        annotation.remove();
        return;
      }
      while (annotation.firstChild) {
        parent.insertBefore(annotation.firstChild, annotation);
      }
      annotation.remove();
    });
}
