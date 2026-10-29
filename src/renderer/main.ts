import type { Article } from "../converter/models/Article";
import {
  captureManualBlockEdits,
  prepareRegeneration,
  type ManualBlockEdit,
  type RegenerationChoice,
} from "../renderer-html/block-edits";
import {
  attachEditorCloseFlow,
  showDecisionDialog,
} from "./decision-dialog";
import { renderArticle } from "../renderer-html/renderArticle";
import type { ArticleEditState } from "../main/article-storage";
import {
  annotateWarningFragments,
  clearWarningAnnotations,
  filterWarnings,
  focusWarningBlock,
  numberedWarnings,
  pendingWarnings,
  warningCounts,
  type WarningFilter,
} from "./warning-review";

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No se encontró un elemento necesario: ${selector}`);
  }
  return element;
}

const selectButton = getElement<HTMLButtonElement>("#selectButton");
const brandColorInput = getElement<HTMLInputElement>("#brandColor");
const brandColorStatus = getElement<HTMLElement>("#brandColorStatus");
const changeDocumentButton =
  getElement<HTMLButtonElement>("#changeDocumentButton");
const newDocumentButton =
  getElement<HTMLButtonElement>("#newDocumentButton");
const approveButton = getElement<HTMLButtonElement>("#approveButton");
const backToReviewButton =
  getElement<HTMLButtonElement>("#backToReviewButton");
const exportButton = getElement<HTMLButtonElement>("#exportButton");
const openFolderButton =
  getElement<HTMLButtonElement>("#openFolderButton");
const downloadArticleLink =
  getElement<HTMLAnchorElement>("#downloadArticleLink");
const articleStatus = getElement<HTMLSpanElement>("#articleStatus");
const appMessage = getElement<HTMLParagraphElement>("#appMessage");
const fileName = getElement<HTMLParagraphElement>("#fileName");
const approvedFileName =
  getElement<HTMLParagraphElement>("#approvedFileName");
const savedLocation = getElement<HTMLElement>("#savedLocation");
const savedFilePath = getElement<HTMLElement>("#savedFilePath");
const warningSummary =
  getElement<HTMLParagraphElement>("#warningSummary");
const warningList = getElement<HTMLUListElement>("#warningList");
const preview = getElement<HTMLIFrameElement>("#articlePreview");
const pendingWarningCount =
  getElement<HTMLSpanElement>("#pendingWarningCount");
const pendingWarningTabCount =
  getElement<HTMLSpanElement>("#pendingWarningTabCount");
const resolvedWarningCount =
  getElement<HTMLSpanElement>("#resolvedWarningCount");
const warningFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-warning-filter]")
);
const expandPreviewButton =
  getElement<HTMLButtonElement>("#expandPreviewButton");
const editHtmlButton = getElement<HTMLButtonElement>("#editHtmlButton");
const saveHtmlEditButton =
  getElement<HTMLButtonElement>("#saveHtmlEditButton");
const cancelHtmlEditButton =
  getElement<HTMLButtonElement>("#cancelHtmlEditButton");
const closeHtmlEditButton =
  getElement<HTMLButtonElement>("#closeHtmlEditButton");
const editWarning = getElement<HTMLParagraphElement>("#editWarning");
const regenerationDialog = getElement<HTMLElement>("#regenerationDialog");
const manualEditCount = getElement<HTMLSpanElement>("#manualEditCount");
const regenerateKeepButton =
  getElement<HTMLButtonElement>("#regenerateKeepButton");
const regenerateDiscardButton =
  getElement<HTMLButtonElement>("#regenerateDiscardButton");
const regenerateCancelButton =
  getElement<HTMLButtonElement>("#regenerateCancelButton");
const closeEditDialog = getElement<HTMLElement>("#closeEditDialog");
const saveAndCloseEditButton =
  getElement<HTMLButtonElement>("#saveAndCloseEditButton");
const discardAndCloseEditButton =
  getElement<HTMLButtonElement>("#discardAndCloseEditButton");
const continueEditingButton =
  getElement<HTMLButtonElement>("#continueEditingButton");
const editConflicts = getElement<HTMLElement>("#editConflicts");
const editConflictList = getElement<HTMLUListElement>("#editConflictList");
const panels = [
  getElement<HTMLElement>("#stepChoose"),
  getElement<HTMLElement>("#stepReview"),
  getElement<HTMLElement>("#stepApprove"),
];
const stepIndicators = Array.from(
  document.querySelectorAll<HTMLElement>("[data-step-indicator]")
);

if (stepIndicators.length !== 3) {
  throw new Error("No se pudo preparar el recorrido de revisión.");
}

let currentArticle: Article | null = null;
let currentHtml = "";
let currentExportHtml = "";
let currentFilePath = "";
let downloadedHtmlUrl: string | null = null;
let isApproved = false;
let isBusy = false;
let hasManualEdits = false;
let isPreviewEditing = false;
let warningFilter: WarningFilter = "pendientes";
let isPreviewDirty = false;
let currentManualEdits: ManualBlockEdit[] = [];
let draftSaveTimer: number | null = null;
let selectedBrandColor: string | null = null;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
if (HEX_COLOR_PATTERN.test(brandColorInput.value)) {
  selectedBrandColor = brandColorInput.value.toUpperCase();
}

function showMessage(message: string): void {
  appMessage.textContent = message;
  appMessage.hidden = false;
}

function clearMessage(): void {
  appMessage.textContent = "";
  appMessage.hidden = true;
}

function showStep(step: number): void {
  panels.forEach((panel, index) => {
    panel.hidden = index !== step - 1;
  });

  stepIndicators.forEach((indicator, index) => {
    const indicatorStep = index + 1;
    indicator.classList.toggle("is-current", indicatorStep === step);
    indicator.classList.toggle("is-complete", indicatorStep < step);
    if (indicatorStep === step) {
      indicator.setAttribute("aria-current", "step");
    } else {
      indicator.removeAttribute("aria-current");
    }
  });
}

function serializeDocument(document: Document): string {
  const doctype = document.doctype ? "<!doctype html>\n" : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}

function showEditConflicts(conflicts: ManualBlockEdit[]): void {
  editConflictList.replaceChildren();
  for (const conflict of conflicts) {
    const item = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `El bloque ${conflict.blockId} cambió`;
    const content = document.createElement("pre");
    content.textContent = conflict.html || "(La edición eliminó este bloque.)";
    details.append(summary, content);
    item.append(details);
    editConflictList.append(item);
  }
  editConflicts.hidden = conflicts.length === 0;
}

async function saveArticleState(
  filePath: string,
  state: ArticleEditState
): Promise<void> {
  await window.electronAPI.saveArticleEditState(filePath, state);
}

function setStatus(status: "pendiente" | "con-advertencias" | "aprobado"): void {
  articleStatus.dataset.status = status;
  articleStatus.textContent =
    status === "con-advertencias"
      ? "Con advertencias"
      : status === "aprobado"
        ? "Aprobado"
        : "Pendiente";
}

function friendlyWarning(code: string, message: string): string {
  const simpleMessages: Record<string, string> = {
    "unclassified-element":
      "Encontramos contenido que no pudimos ubicar. Revisa si falta una parte del artículo.",
    "short-paragraph-cluster":
      "Encontramos varios fragmentos muy breves seguidos. Comprueba que el texto se lea completo.",
    "unresolved-run-size":
      "No pudimos confirmar el tamaño de letra de una parte del texto. Revisa cómo se ve.",
    "image-missing-alt":
      "Una imagen no tiene una descripción para quienes usan lectores de pantalla.",
    "unresolved-image-relationship":
      "No pudimos encontrar una imagen del documento. Comprueba que aparezca en la vista.",
    "missing-image-file":
      "Falta una imagen del documento. Comprueba que aparezca en la vista.",
    "unrecognized-image":
      "Hay un elemento visual que no pudimos mostrar. Comprueba que no falte contenido.",
    "uncertain-reference":
      "Hay una referencia que conviene revisar antes de guardar.",
    "unmatched-citation":
      "Hay una cita en el texto que no coincide con ninguna referencia.",
    "ambiguous-citation":
      "Una cita puede corresponder a más de una referencia. Revisa cuál es la correcta.",
    "uncited-reference":
      "Hay una referencia que no encontramos citada en el texto.",
    "unclassified-reference":
      "Hay una referencia que no pudimos ordenar. Revísala antes de guardar.",
    "ambiguous-note-size":
      "Hay una nota cuya letra se parece al texto principal. Comprueba si está en el lugar correcto.",
    "ambiguous-note":
      "Encontramos un texto breve que podría ser una nota. Comprueba dónde debe aparecer.",
    "missing-header-field":
      "No encontramos algunos datos iniciales del artículo. Comprueba el título, los autores y las fechas.",
  };

  return simpleMessages[code] ??
    (message.trim()
      ? "Hay una parte del documento que conviene revisar antes de guardarlo."
      : "Encontramos algo que conviene revisar antes de guardar.");
}

function renderWarnings(article: Article): void {
  warningList.replaceChildren();
  const allWarnings = numberedWarnings(article.warnings);
  const { pending: pendingCount, resolved: resolvedCount } =
    warningCounts(article.warnings);
  pendingWarningCount.textContent = String(pendingCount);
  pendingWarningTabCount.textContent = String(pendingCount);
  pendingWarningCount.setAttribute(
    "aria-label",
    `${pendingCount} errores pendientes`
  );
  resolvedWarningCount.textContent = String(resolvedCount);
  resolvedWarningCount.setAttribute(
    "aria-label",
    `${resolvedCount} errores resueltos`
  );
  warningSummary.textContent =
    `Pendientes: ${pendingCount} · Resueltos: ${resolvedCount}`;
  for (const button of warningFilterButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.warningFilter === warningFilter)
    );
  }

  const warnings = filterWarnings(allWarnings, warningFilter);
  if (warnings.length === 0) {
    const item = document.createElement("li");
    item.className = "no-warnings";
    item.textContent =
      warningFilter === "pendientes"
        ? "No hay errores pendientes."
        : warningFilter === "resueltos"
          ? "No hay errores resueltos."
          : "No se encontraron errores.";
    warningList.append(item);
  } else {
    for (const { warning, number } of warnings) {
    const item = document.createElement("li");
    item.className = `warning-item${warning.status === "resuelto" ? " is-resolved" : ""}`;
    item.dataset.warningId = warning.id ?? "";
    item.dataset.warningOrdinal = String(number);
    const numberBadge = document.createElement("span");
    numberBadge.className = "warning-number";
    numberBadge.textContent = String(number);
    numberBadge.setAttribute("aria-label", `Error ${number}`);
    item.append(numberBadge);
    const description = friendlyWarning(warning.code, warning.message);

    const status = document.createElement("span");
    status.className = "warning-status";
    status.textContent =
      warning.status === "resuelto" ? "Resuelto" : "Pendiente";
    item.append(status);

    const actions = document.createElement("div");
    actions.className = "warning-actions";
    if (warning.blockId) {
      const targetButton = document.createElement("button");
      targetButton.type = "button";
      targetButton.className = "warning-target";
      targetButton.textContent = description;
      targetButton.addEventListener("click", () => {
        const block = preview.contentDocument
          ? focusWarningBlock(preview.contentDocument, warning)
          : null;
        if (!block) {
          showMessage(
            "El bloque asociado a este error ya no está en la vista previa. Puede haber cambiado durante la edición manual."
          );
        }
      });
      item.append(targetButton);
    } else {
      const details = document.createElement("p");
      details.className = "warning-details";
      details.textContent = description;
      item.append(details);
    }

    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className =
      warning.status === "resuelto" ? "warning-reopen" : "warning-resolve";
    statusButton.textContent =
      warning.status === "resuelto" ? "Reabrir" : "Marcar como resuelto";
    statusButton.addEventListener("click", () => {
      void updateWarningStatus(
        article,
        warning,
        warning.status === "resuelto" ? "pendiente" : "resuelto"
      );
    });
    actions.append(statusButton);
    item.append(actions);
    warningList.append(item);
    }
  }
  setStatus(pendingCount ? "con-advertencias" : "pendiente");
}

async function updateWarningStatus(
  article: Article,
  warning: Article["warnings"][number],
  status: Article["warnings"][number]["status"]
): Promise<void> {
  const previousStatus = warning.status;
  warning.status = status;
  try {
    await window.electronAPI.saveWarningStates(
      currentFilePath,
      article.warnings
    );
  } catch (error) {
    warning.status = previousStatus;
    console.error(error);
    showMessage(
      "No pudimos guardar el estado del error. Comprueba los permisos del documento e inténtalo otra vez."
    );
    renderWarnings(article);
    return;
  }

  isApproved = false;
  renderWarnings(article);
  if (isPreviewEditing && preview.contentDocument) {
    annotateWarningFragments(
      preview.contentDocument,
      filterWarnings(numberedWarnings(article.warnings), "pendientes")
    );
  }
}

function setBusy(busy: boolean): void {
  isBusy = busy;
  selectButton.disabled = busy;
  brandColorInput.disabled = busy;
  changeDocumentButton.disabled = busy;
  newDocumentButton.disabled = busy;
  approveButton.disabled = busy;
  exportButton.disabled = busy;
  openFolderButton.disabled = busy;
  expandPreviewButton.disabled = busy;
  editHtmlButton.disabled = busy;
  saveHtmlEditButton.disabled = busy;
  cancelHtmlEditButton.disabled = busy;
  closeHtmlEditButton.disabled = busy;
}

function resetToStart(): void {
  if (draftSaveTimer !== null) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  currentArticle = null;
  currentHtml = "";
  currentExportHtml = "";
  currentFilePath = "";
  hasManualEdits = false;
  currentManualEdits = [];
  isPreviewEditing = false;
  isPreviewDirty = false;
  window.electronAPI.setEditorDraftStatus(false);
  editWarning.hidden = true;
  closeHtmlEditButton.hidden = true;
  editConflicts.hidden = true;
  preview.classList.remove("is-expanded", "is-editing");
  isApproved = false;
  preview.removeAttribute("srcdoc");
  fileName.textContent = "";
  approvedFileName.textContent = "";
  savedFilePath.textContent = "";
  savedLocation.hidden = true;
  openFolderButton.hidden = true;
  downloadArticleLink.hidden = true;
  downloadArticleLink.removeAttribute("href");
  downloadArticleLink.removeAttribute("download");
  if (downloadedHtmlUrl) {
    URL.revokeObjectURL(downloadedHtmlUrl);
    downloadedHtmlUrl = null;
  }
  clearMessage();
  setStatus("pendiente");
  showStep(1);
  selectButton.focus();
}

async function askRegenerationChoice(
  count: number
): Promise<RegenerationChoice> {
  manualEditCount.textContent = String(count);
  return showDecisionDialog(
    regenerationDialog,
    [
      { button: regenerateKeepButton, value: "keep" },
      { button: regenerateDiscardButton, value: "discard" },
      { button: regenerateCancelButton, value: "cancel" },
    ],
    "cancel"
  );
}

async function chooseAndPrepareDocument(): Promise<void> {
  if (isBusy) return;
  if (isPreviewEditing) {
    showMessage("Cierra la edición antes de regenerar el artículo.");
    return;
  }

  let choice: RegenerationChoice = "keep";
  let alreadyAsked = false;
  if (currentManualEdits.length > 0) {
    const previousFocus = document.activeElement as HTMLElement | null;
    choice = await askRegenerationChoice(currentManualEdits.length);
    alreadyAsked = true;
    previousFocus?.focus();
    if (choice === "cancel") return;
  }

  clearMessage();
  if (!selectedBrandColor) {
    showMessage("Elegí un color hexadecimal válido en formato #RRGGBB.");
    brandColorInput.focus();
    return;
  }

  let filePath: string | null;
  try {
    filePath = await window.electronAPI.selectDocument();
  } catch (error) {
    console.error(error);
    showMessage("No pudimos abrir el selector de documentos. Inténtalo otra vez.");
    return;
  }
  if (!filePath) return;

  const previousFilePath = currentFilePath;
  if (filePath !== previousFilePath) {
    choice = "keep";
    alreadyAsked = false;
  }
  setBusy(true);
  showMessage("Estamos preparando el artículo. Esto puede tardar un momento.");
  try {
    const storedState = await window.electronAPI.loadArticleEditState(filePath);
    if (storedState.edits.length > 0 && !alreadyAsked) {
      const previousFocus = document.activeElement as HTMLElement | null;
      choice = await askRegenerationChoice(storedState.edits.length);
      previousFocus?.focus();
      if (choice === "cancel") {
        clearMessage();
        return;
      }
    }

    const article = await window.electronAPI.convertDocument(filePath);
    const html = renderArticle(article, {
      color: selectedBrandColor,
    });
    const basePreviewHtml = await window.electronAPI.preparePreview(html, filePath);
    const baseDocument = new DOMParser().parseFromString(
      basePreviewHtml,
      "text/html"
    );
    const regeneration = prepareRegeneration(
      baseDocument,
      storedState.edits,
      choice
    );
    if (!regeneration) return;
    const previewHtml = await window.electronAPI.preparePreview(
      regeneration.html,
      filePath
    );
    const discardDraft = choice === "discard";
    const restoreDraft =
      !discardDraft &&
      storedState.draftHtml &&
      storedState.draftBaseHtml === previewHtml
        ? storedState.draftHtml
        : null;
    const nextState: ArticleEditState = {
      edits: regeneration.edits,
      draftHtml: discardDraft ? null : storedState.draftHtml,
      draftBaseHtml: discardDraft ? null : storedState.draftBaseHtml,
    };
    await saveArticleState(filePath, nextState);
    await window.electronAPI.activateDocument(filePath);

    currentArticle = article;
    warningFilter = "pendientes";
    currentHtml = html;
    currentFilePath = filePath;
    currentManualEdits = regeneration.edits;
    hasManualEdits = currentManualEdits.length > 0;
    currentHtml = previewHtml;
    currentExportHtml = previewHtml;
    isPreviewDirty = false;
    isApproved = false;
    editWarning.hidden = !hasManualEdits;
    savedFilePath.textContent = "";
    savedLocation.hidden = true;
    openFolderButton.hidden = true;
    downloadArticleLink.hidden = true;
    downloadArticleLink.removeAttribute("href");
    downloadArticleLink.removeAttribute("download");
    if (downloadedHtmlUrl) {
      URL.revokeObjectURL(downloadedHtmlUrl);
      downloadedHtmlUrl = null;
    }
    fileName.textContent = filePath.split(/[\\/]/).pop() ?? "Documento Word";
    approvedFileName.textContent = fileName.textContent;
    showEditConflicts(regeneration.conflicts);
    if (
      !discardDraft &&
      storedState.draftHtml &&
      storedState.draftBaseHtml !== previewHtml
    ) {
      const draftItem = document.createElement("li");
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Hay un borrador de otra versión para revisar";
      const content = document.createElement("pre");
      content.textContent = storedState.draftHtml;
      details.append(summary, content);
      draftItem.append(details);
      editConflictList.append(draftItem);
      editConflicts.hidden = false;
    }
    if (restoreDraft) {
      preview.addEventListener(
        "load",
        () => {
          beginPreviewEditing();
          isPreviewDirty = true;
          window.electronAPI.setEditorDraftStatus(true);
          showMessage("Se recuperó el borrador guardado automáticamente.");
        },
        { once: true }
      );
    }
    preview.srcdoc = restoreDraft ?? previewHtml;
    preview.setAttribute("sandbox", "allow-same-origin");
    renderWarnings(article);
    if (!restoreDraft) clearMessage();
    showStep(2);
    document.querySelector<HTMLButtonElement>("#review-title")?.focus();
  } catch (error) {
    console.error(error);
    showMessage(
      "No pudimos preparar este documento. Comprueba que sea un archivo Word válido e inténtalo de nuevo."
    );
  } finally {
    setBusy(false);
  }
}

selectButton.addEventListener("click", chooseAndPrepareDocument);
changeDocumentButton.addEventListener("click", chooseAndPrepareDocument);
newDocumentButton.addEventListener("click", resetToStart);

for (const button of warningFilterButtons) {
  button.addEventListener("click", () => {
    const filter = button.dataset.warningFilter;
    if (
      filter !== "todos" &&
      filter !== "pendientes" &&
      filter !== "resueltos"
    ) {
      return;
    }
    warningFilter = filter;
    if (currentArticle) renderWarnings(currentArticle);
  });
}

expandPreviewButton.addEventListener("click", () => {
  const expanded = preview.classList.toggle("is-expanded");
  expandPreviewButton.textContent = expanded
    ? "Cerrar vista ampliada"
    : "Ampliar vista";
});

let editorInputHandler: (() => void) | null = null;
let draftSavePromise: Promise<void> = Promise.resolve();
let discardPreviewOnExit = false;

function removeWarningHighlights(previewDocument: Document): void {
  previewDocument
    .querySelectorAll(".warning-highlight")
    .forEach((element) => element.classList.remove("warning-highlight"));
  previewDocument.getElementById("warning-highlight-style")?.remove();
}

function beginPreviewEditing(): void {
  const previewDocument = preview.contentDocument;
  if (!previewDocument) {
    showMessage("No pudimos abrir la vista previa para editarla.");
    return;
  }

  if (currentArticle) {
    annotateWarningFragments(
      previewDocument,
      filterWarnings(
        numberedWarnings(currentArticle.warnings),
        "pendientes"
      )
    );
  }
  isPreviewEditing = true;
  previewDocument.designMode = "on";
  preview.classList.add("is-editing", "is-expanded");
  editHtmlButton.hidden = true;
  expandPreviewButton.hidden = true;
  saveHtmlEditButton.hidden = false;
  cancelHtmlEditButton.hidden = false;
  closeHtmlEditButton.hidden = false;
  editWarning.hidden = false;
  editorInputHandler = () => scheduleDraftAutosave();
  previewDocument.addEventListener("input", editorInputHandler);
  window.electronAPI.setEditorDraftStatus(isPreviewDirty);
  showMessage(
    "Puedes editar el artículo directamente en la vista ampliada. Los estilos se mantienen."
  );
}

function scheduleDraftAutosave(): void {
  isPreviewDirty = true;
  window.electronAPI.setEditorDraftStatus(true);
  if (draftSaveTimer !== null) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = null;
    const previewDocument = preview.contentDocument;
    if (!previewDocument || !currentFilePath) return;
    removeWarningHighlights(previewDocument);
    clearWarningAnnotations(previewDocument);
    const state: ArticleEditState = {
      edits: currentManualEdits,
      draftHtml: serializeDocument(previewDocument),
      draftBaseHtml: currentExportHtml,
    };
    draftSavePromise = draftSavePromise
      .catch(() => undefined)
      .then(() => saveArticleState(currentFilePath, state));
    void draftSavePromise.catch((error: unknown) => {
      console.error(error);
      showMessage("No pudimos guardar el borrador automáticamente.");
    });
  }, 450);
}

async function commitPreviewEdit(): Promise<boolean> {
  const previewDocument = preview.contentDocument;
  if (!previewDocument || !currentFilePath) {
    showMessage("No pudimos guardar la edición del artículo.");
    return false;
  }
  if (draftSaveTimer !== null) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  await draftSavePromise.catch(() => undefined);
  removeWarningHighlights(previewDocument);
  clearWarningAnnotations(previewDocument);
  const originalDocument = new DOMParser().parseFromString(
    currentExportHtml,
    "text/html"
  );
  const edits = captureManualBlockEdits(
    originalDocument,
    previewDocument,
    currentManualEdits
  );
  const editedHtml = serializeDocument(previewDocument);
  let preparedHtml: string;
  try {
    preparedHtml = await window.electronAPI.preparePreview(
      editedHtml,
      currentFilePath
    );
    await saveArticleState(currentFilePath, {
      edits,
      draftHtml: null,
      draftBaseHtml: null,
    });
  } catch (error) {
    console.error(error);
    previewDocument.designMode = "on";
    showMessage("No pudimos guardar la edición. Tus cambios siguen en pantalla.");
    return false;
  }
  currentHtml = editedHtml;
  currentExportHtml = preparedHtml;
  currentManualEdits = edits;
  hasManualEdits = edits.length > 0;
  isPreviewDirty = false;
  window.electronAPI.setEditorDraftStatus(false);
  return true;
}

function leavePreviewEditing(): void {
  const previewDocument = preview.contentDocument;
  if (previewDocument) {
    previewDocument.designMode = "off";
    if (editorInputHandler) {
      previewDocument.removeEventListener("input", editorInputHandler);
    }
  }
  editorInputHandler = null;
  isPreviewEditing = false;
  isApproved = false;
  preview.classList.remove("is-editing", "is-expanded");
  editHtmlButton.hidden = false;
  expandPreviewButton.hidden = false;
  saveHtmlEditButton.hidden = true;
  cancelHtmlEditButton.hidden = true;
  closeHtmlEditButton.hidden = true;
  editWarning.hidden = !hasManualEdits;
  if (discardPreviewOnExit) {
    preview.srcdoc = currentExportHtml;
    discardPreviewOnExit = false;
  }
  setStatus(
    currentArticle && pendingWarnings(currentArticle.warnings).length
      ? "con-advertencias"
      : "pendiente"
  );
}

async function discardPreviewEdit(): Promise<boolean> {
  if (!currentFilePath) return false;
  if (draftSaveTimer !== null) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  try {
    await draftSavePromise.catch(() => undefined);
    await saveArticleState(currentFilePath, {
      edits: currentManualEdits,
      draftHtml: null,
      draftBaseHtml: null,
    });
    isPreviewDirty = false;
    window.electronAPI.setEditorDraftStatus(false);
    discardPreviewOnExit = true;
    return true;
  } catch (error) {
    console.error(error);
    showMessage("No pudimos descartar el borrador. Tus cambios siguen en pantalla.");
    return false;
  }
}

editHtmlButton.addEventListener("click", beginPreviewEditing);
let editorExitMessage = "";
attachEditorCloseFlow({
  document,
  closeButton: closeHtmlEditButton,
  preview,
  dialog: closeEditDialog,
  saveButton: saveAndCloseEditButton,
  discardButton: discardAndCloseEditButton,
  continueButton: continueEditingButton,
  returnFocus: editHtmlButton,
  isEditing: () => isPreviewEditing,
  hasUnsavedChanges: () => isPreviewDirty,
  saveChanges: async () => {
    const saved = await commitPreviewEdit();
    if (saved) editorExitMessage = "La edición quedó guardada.";
    return saved;
  },
  discardChanges: async () => {
    const discarded = await discardPreviewEdit();
    if (discarded) editorExitMessage = "Los cambios sin guardar se descartaron.";
    return discarded;
  },
  closeEditor: () => {
    leavePreviewEditing();
    if (editorExitMessage) showMessage(editorExitMessage);
    else clearMessage();
    editorExitMessage = "";
  },
});

saveHtmlEditButton.addEventListener("click", async () => {
  if (await commitPreviewEdit()) {
    leavePreviewEditing();
    editHtmlButton.focus();
    showMessage("La edición quedó guardada y se usará al exportar el artículo.");
  }
});

cancelHtmlEditButton.addEventListener("click", () => {
  closeHtmlEditButton.click();
});

brandColorInput.addEventListener("input", () => {
  const color = brandColorInput.value;
  const isValid = HEX_COLOR_PATTERN.test(color);
  brandColorStatus.classList.toggle("is-error", !isValid);
  if (isValid) {
    selectedBrandColor = color.toUpperCase();
    brandColorStatus.textContent = "Color listo.";
    return;
  }

  selectedBrandColor = null;
  brandColorStatus.textContent =
    "Escribí un color hexadecimal válido en formato #RRGGBB.";
});

approveButton.addEventListener("click", () => {
  if (!currentArticle) return;
  isApproved = true;
  setStatus("aprobado");
  clearMessage();
  showStep(3);
  document.querySelector<HTMLHeadingElement>("#approval-title")?.focus();
});

backToReviewButton.addEventListener("click", () => {
  if (!currentArticle) return;
  isApproved = false;
  setStatus(
    pendingWarnings(currentArticle.warnings).length
      ? "con-advertencias"
      : "pendiente"
  );
  clearMessage();
  showStep(2);
  document.querySelector<HTMLHeadingElement>("#review-title")?.focus();
});

exportButton.addEventListener("click", async () => {
  if (!currentArticle || !currentFilePath || !isApproved || isBusy) return;

  setBusy(true);
  clearMessage();
  try {
    const savedPath = await window.electronAPI.exportArticle(currentHtml);
    if (!savedPath) return;
    savedFilePath.textContent = savedPath;
    savedLocation.hidden = false;
    openFolderButton.hidden = false;
    if (downloadedHtmlUrl) URL.revokeObjectURL(downloadedHtmlUrl);
    downloadedHtmlUrl = URL.createObjectURL(
      new Blob([currentExportHtml], { type: "text/html;charset=utf-8" })
    );
    downloadArticleLink.href = downloadedHtmlUrl;
    downloadArticleLink.download = savedPath.split(/[\\/]/).pop() ?? "articulo.html";
    downloadArticleLink.hidden = false;
    showMessage("El artículo quedó guardado en la ubicación indicada.");
  } catch (error) {
    console.error(error);
    showMessage("No pudimos guardar el artículo. Inténtalo otra vez.");
  } finally {
    setBusy(false);
  }
});

openFolderButton.addEventListener("click", async () => {
  if (!savedFilePath.textContent || isBusy) return;

  setBusy(true);
  clearMessage();
  try {
    await window.electronAPI.openSavedArticleFolder();
  } catch (error) {
    console.error(error);
    showMessage(
      "No pudimos abrir la carpeta del artículo. Comprueba que el archivo siga en esa ubicación."
    );
  } finally {
    setBusy(false);
  }
});
