import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { attachEditorCloseFlow } from "../src/renderer/decision-dialog";

function createFlow(hasUnsavedChanges = true) {
  const dom = new JSDOM(`
    <button id="edit">Editar</button>
    <button id="close" aria-label="Volver a la vista previa">├ù</button>
    <iframe id="preview"></iframe>
    <section id="dialog" role="dialog" aria-modal="true" hidden>
      <button id="save">Guardar y cerrar</button>
      <button id="discard">Descartar cambios</button>
      <button id="continue">Seguir editando</button>
    </section>
  `);
  const document = dom.window.document;
  const returnFocus = document.querySelector<HTMLButtonElement>("#edit")!;
  const closeButton = document.querySelector<HTMLButtonElement>("#close")!;
  const preview = document.querySelector<HTMLIFrameElement>("#preview")!;
  const dialog = document.querySelector<HTMLElement>("#dialog")!;
  let editing = true;
  let dirty = hasUnsavedChanges;
  let saved = false;
  let discarded = false;
  let closed = false;
  const detach = attachEditorCloseFlow({
    document,
    closeButton,
    preview,
    dialog,
    saveButton: document.querySelector<HTMLButtonElement>("#save")!,
    discardButton: document.querySelector<HTMLButtonElement>("#discard")!,
    continueButton: document.querySelector<HTMLButtonElement>("#continue")!,
    returnFocus,
    isEditing: () => editing,
    hasUnsavedChanges: () => dirty,
    saveChanges: async () => {
      saved = true;
      dirty = false;
      return true;
    },
    discardChanges: async () => {
      discarded = true;
      dirty = false;
      return true;
    },
    closeEditor: () => {
      editing = false;
      closed = true;
    },
  });
  return {
    dom,
    document,
    returnFocus,
    preview,
    dialog,
    closeButton,
    saved: () => saved,
    discarded: () => discarded,
    closed: () => closed,
    detach,
  };
}

async function flushEvents(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("cierre del modo edici├│n", () => {
  it("el bot├│n ├ù sin cambios vuelve a la vista y devuelve el foco al control anterior", async () => {
    const flow = createFlow(false);
    flow.closeButton.click();
    await flushEvents();

    expect(flow.closed()).toBe(true);
    expect(flow.document.activeElement).toBe(flow.returnFocus);
    expect(flow.dialog.hidden).toBe(true);
    flow.detach();
  });

  it("Escape abre el di├ílogo y enfoca su primera opci├│n", async () => {
    const flow = createFlow();
    flow.document.dispatchEvent(
      new flow.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(flow.dialog.hidden).toBe(false);
    expect(flow.document.activeElement?.textContent).toBe("Guardar y cerrar");
    flow.detach();
  });

  it("Guardar y cerrar conserva los cambios y devuelve el foco al control anterior", async () => {
    const flow = createFlow();
    flow.closeButton.click();
    flow.document.querySelector<HTMLButtonElement>("#save")!.click();
    await flushEvents();

    expect(flow.saved()).toBe(true);
    expect(flow.discarded()).toBe(false);
    expect(flow.closed()).toBe(true);
    expect(flow.document.activeElement).toBe(flow.returnFocus);
    flow.detach();
  });

  it("Descartar cambios elimina el borrador y cierra el editor", async () => {
    const flow = createFlow();
    flow.closeButton.click();
    flow.document.querySelector<HTMLButtonElement>("#discard")!.click();
    await flushEvents();

    expect(flow.discarded()).toBe(true);
    expect(flow.saved()).toBe(false);
    expect(flow.closed()).toBe(true);
    expect(flow.document.activeElement).toBe(flow.returnFocus);
    flow.detach();
  });

  it("Seguir editando y Escape desde el di├ílogo vuelven a enfocar la vista", async () => {
    const flow = createFlow();
    flow.closeButton.click();
    flow.document.querySelector<HTMLButtonElement>("#continue")!.click();
    await flushEvents();

    expect(flow.closed()).toBe(false);
    expect(flow.document.activeElement).toBe(flow.preview);

    flow.closeButton.click();
    flow.document.querySelector<HTMLButtonElement>("#save")!.dispatchEvent(
      new flow.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
    await flushEvents();
    expect(flow.dialog.hidden).toBe(true);
    expect(flow.document.activeElement).toBe(flow.preview);
    flow.detach();
  });

  it("mantiene el foco dentro del di├ílogo al recorrer sus opciones con Tab", async () => {
    const flow = createFlow();
    flow.closeButton.click();
    const saveButton = flow.document.querySelector<HTMLButtonElement>("#save")!;
    const continueButton =
      flow.document.querySelector<HTMLButtonElement>("#continue")!;

    saveButton.dispatchEvent(
      new flow.dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(flow.document.activeElement).toBe(continueButton);

    continueButton.dispatchEvent(
      new flow.dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      })
    );
    expect(flow.document.activeElement).toBe(saveButton);
    flow.detach();
  });
});
