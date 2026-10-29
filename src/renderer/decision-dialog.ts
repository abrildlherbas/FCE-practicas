export interface DialogChoice<T extends string> {
  button: HTMLButtonElement;
  value: T;
}

export async function showDecisionDialog<T extends string>(
  dialog: HTMLElement,
  choices: DialogChoice<T>[],
  escapeChoice: T
): Promise<T> {
  dialog.hidden = false;
  const buttons = choices.map(({ button }) => button);
  buttons[0]?.focus();

  return new Promise((resolve) => {
    let finish: (choice: T) => void;
    const clickHandlers = new Map(
      choices.map(({ button, value }) => [button, () => finish(value)])
    );
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(escapeChoice);
        return;
      }
      if (event.key !== "Tab" || buttons.length === 0) return;

      const currentIndex = buttons.indexOf(
        dialog.ownerDocument.activeElement as HTMLButtonElement
      );
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!event.shiftKey && currentIndex === buttons.length - 1) {
        event.preventDefault();
        buttons[0].focus();
      }
    };
    finish = (choice: T) => {
      dialog.hidden = true;
      dialog.removeEventListener("keydown", handleKeydown);
      for (const [button, handler] of clickHandlers) {
        button.removeEventListener("click", handler);
      }
      resolve(choice);
    };
    for (const [button, handler] of clickHandlers) {
      button.addEventListener("click", handler);
    }
    dialog.addEventListener("keydown", handleKeydown);
  });
}

export interface EditorCloseFlow {
  document: Document;
  closeButton: HTMLButtonElement;
  preview: HTMLElement;
  dialog: HTMLElement;
  saveButton: HTMLButtonElement;
  discardButton: HTMLButtonElement;
  continueButton: HTMLButtonElement;
  returnFocus: HTMLElement;
  isEditing(): boolean;
  hasUnsavedChanges(): boolean;
  saveChanges(): Promise<boolean>;
  discardChanges(): Promise<boolean>;
  closeEditor(): void;
}

export function attachEditorCloseFlow(flow: EditorCloseFlow): () => void {
  const requestClose = async () => {
    if (!flow.isEditing()) return;
    if (!flow.hasUnsavedChanges()) {
      flow.closeEditor();
      flow.returnFocus.focus();
      return;
    }

    const choice = await showDecisionDialog(
      flow.dialog,
      [
        { button: flow.saveButton, value: "save" },
        { button: flow.discardButton, value: "discard" },
        { button: flow.continueButton, value: "continue" },
      ],
      "continue"
    );
    if (choice === "continue") {
      flow.preview.focus();
      return;
    }

    const completed =
      choice === "save"
        ? await flow.saveChanges()
        : await flow.discardChanges();
    if (!completed) {
      flow.preview.focus();
      return;
    }
    flow.closeEditor();
    flow.returnFocus.focus();
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      !flow.dialog.hidden ||
      !flow.isEditing()
    ) {
      return;
    }
    event.preventDefault();
    void requestClose();
  };
  const handleCloseClick = () => void requestClose();

  flow.closeButton.addEventListener("click", handleCloseClick);
  flow.document.addEventListener("keydown", handleDocumentKeydown);

  return () => {
    flow.closeButton.removeEventListener("click", handleCloseClick);
    flow.document.removeEventListener("keydown", handleDocumentKeydown);
  };
}
