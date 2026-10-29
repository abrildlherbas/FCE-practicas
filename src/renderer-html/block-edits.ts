export interface ManualBlockEdit {
  blockId: string;
  originalHtml: string;
  html: string;
}

export type RegenerationChoice = "keep" | "discard" | "cancel";

export type BlockEditConflict = ManualBlockEdit;

export interface ReconciledBlockEdits {
  html: string;
  edits: ManualBlockEdit[];
  conflicts: BlockEditConflict[];
}

export function captureManualBlockEdits(
  originalDocument: Document,
  editedDocument: Document,
  existingEdits: ManualBlockEdit[]
): ManualBlockEdit[] {
  const editsById = new Map(
    existingEdits.map((edit) => [edit.blockId, edit])
  );
  const editedBlocks = new Map(
    Array.from(
      editedDocument.querySelectorAll<HTMLElement>("[data-bloque-id]")
    ).map((block) => [block.dataset.bloqueId ?? "", block])
  );

  for (const originalBlock of Array.from(
    originalDocument.querySelectorAll<HTMLElement>("[data-bloque-id]")
  )) {
    const blockId = originalBlock.dataset.bloqueId;
    if (!blockId) continue;

    const originalHtml = originalBlock.outerHTML;
    const editedHtml = editedBlocks.get(blockId)?.outerHTML ?? "";
    const existing = editsById.get(blockId);
    if (editedHtml === originalHtml) {
      if (!existing) continue;
      if (existing.html === originalHtml) {
        editsById.delete(blockId);
      }
      continue;
    }

    if (existing && editedHtml === existing.originalHtml) {
      editsById.delete(blockId);
      continue;
    }

    editsById.set(blockId, {
      blockId,
      originalHtml: existing?.originalHtml ?? originalHtml,
      html: editedHtml,
    });
  }

  return Array.from(editsById.values());
}

function editedElement(
  document: Document,
  edit: ManualBlockEdit
): HTMLElement | null | undefined {
  if (!edit.html) return null;
  const template = document.createElement("template");
  template.innerHTML = edit.html;
  const elements = Array.from(template.content.children);
  if (
    elements.length !== 1 ||
    (elements[0] as HTMLElement).dataset.bloqueId !== edit.blockId
  ) {
    return undefined;
  }
  return document.importNode(elements[0], true) as HTMLElement;
}

export function reconcileManualBlockEdits(
  document: Document,
  edits: ManualBlockEdit[]
): ReconciledBlockEdits {
  const conflicts: BlockEditConflict[] = [];

  for (const edit of edits) {
    const block = Array.from(
      document.querySelectorAll<HTMLElement>("[data-bloque-id]")
    ).find((element) => element.dataset.bloqueId === edit.blockId);
    if (!block || block.outerHTML !== edit.originalHtml) {
      conflicts.push(edit);
      continue;
    }

    const replacement = editedElement(document, edit);
    if (replacement === undefined) {
      conflicts.push(edit);
      continue;
    }
    if (replacement) block.replaceWith(replacement);
    else block.remove();
  }

  const doctype = document.doctype ? "<!doctype html>\n" : "";
  return {
    html: `${doctype}${document.documentElement.outerHTML}`,
    edits,
    conflicts,
  };
}

export function prepareRegeneration(
  document: Document,
  edits: ManualBlockEdit[],
  choice: RegenerationChoice
): ReconciledBlockEdits | null {
  if (choice === "cancel") return null;
  if (choice === "discard") {
    const doctype = document.doctype ? "<!doctype html>\n" : "";
    return {
      html: `${doctype}${document.documentElement.outerHTML}`,
      edits: [],
      conflicts: [],
    };
  }
  return reconcileManualBlockEdits(document, edits);
}
