import type { Article } from "../converter/models/Article";
import { renderArticle } from "../renderer-html/renderArticle";
import {
  focusWarningBlock,
  pendingWarnings,
  resolveWarning,
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
const expandPreviewButton =
  getElement<HTMLButtonElement>("#expandPreviewButton");
const editHtmlButton = getElement<HTMLButtonElement>("#editHtmlButton");
const saveHtmlEditButton =
  getElement<HTMLButtonElement>("#saveHtmlEditButton");
const cancelHtmlEditButton =
  getElement<HTMLButtonElement>("#cancelHtmlEditButton");
const editWarning = getElement<HTMLParagraphElement>("#editWarning");
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
let selectedBrandColor: string | null = null;
const resolvedWarningsByFile = new Map<
  string,
  Article["warnings"]
>();

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
  const warnings = pendingWarnings(article.warnings);
  pendingWarningCount.textContent = String(warnings.length);
  pendingWarningCount.setAttribute(
    "aria-label",
    `${warnings.length} errores pendientes`
  );
  if (warnings.length === 0) {
    warningSummary.textContent = "No hay errores pendientes.";
    const item = document.createElement("li");
    item.className = "no-warnings";
    item.textContent = "Todos los puntos están resueltos.";
    warningList.append(item);
    setStatus("pendiente");
    return;
  }

  warningSummary.textContent =
    warnings.length === 1
      ? "Hay 1 error pendiente."
      : `Hay ${warnings.length} errores pendientes.`;
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.className = "warning-item";
    const description = friendlyWarning(warning.code, warning.message);

    const actions = document.createElement("div");
    actions.className = "warning-actions";
    if (warning.blockId) {
      const targetButton = document.createElement("button");
      targetButton.type = "button";
      targetButton.className = "warning-target";
      targetButton.textContent = description;
      targetButton.addEventListener("click", () => {
        const block = preview.contentDocument
          ? focusWarningBlock(preview.contentDocument, warning.blockId)
          : null;
        if (block) {
          preview.focus();
        } else {
          showMessage("No encontramos ese bloque en la vista previa.");
        }
      });
      item.append(targetButton);
    } else {
      const details = document.createElement("p");
      details.className = "warning-details";
      details.textContent = description;
      item.append(details);
    }

    const resolveButton = document.createElement("button");
    resolveButton.type = "button";
    resolveButton.className = "warning-resolve";
    resolveButton.textContent = "Marcar como resuelto";
    resolveButton.addEventListener("click", () => {
      resolveWarning(article, warning);
      const resolved = resolvedWarningsByFile.get(currentFilePath) ?? [];
      resolvedWarningsByFile.set(
        currentFilePath,
        [...resolved.filter((item) => item.status === "resuelto"), warning]
      );
      isApproved = false;
      renderWarnings(article);
    });
    actions.append(resolveButton);
    item.append(actions);
    warningList.append(item);
  }
  setStatus("con-advertencias");
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
}

function resetToStart(): void {
  currentArticle = null;
  currentHtml = "";
  currentExportHtml = "";
  currentFilePath = "";
  hasManualEdits = false;
  isPreviewEditing = false;
  editWarning.hidden = true;
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

async function chooseAndPrepareDocument(): Promise<void> {
  if (isBusy) return;
  if (
    hasManualEdits &&
    !window.confirm(
      "Si vuelves a generar el artículo, podrías perder la edición manual. ¿Quieres continuar?"
    )
  ) {
    return;
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

  setBusy(true);
  showMessage("Estamos preparando el artículo. Esto puede tardar un momento.");
  currentFilePath = filePath;
  hasManualEdits = false;
  editWarning.hidden = true;
  isApproved = false;
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

  try {
    const previousWarnings = resolvedWarningsByFile.get(filePath) ?? [];
    const article = await window.electronAPI.convertDocument(
      filePath,
      previousWarnings
    );
    const html = renderArticle(article, {
      color: selectedBrandColor,
    });
    const previewHtml = await window.electronAPI.preparePreview(html);

    currentArticle = article;
    currentHtml = html;
    currentExportHtml = previewHtml;
    fileName.textContent = filePath.split(/[\\/]/).pop() ?? "Documento Word";
    approvedFileName.textContent = fileName.textContent;
    preview.srcdoc = previewHtml;
    preview.setAttribute("sandbox", "allow-same-origin");
    renderWarnings(article);
    clearMessage();
    showStep(2);
    document.querySelector<HTMLButtonElement>("#review-title")?.focus();
  } catch (error) {
    console.error(error);
    resetToStart();
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

expandPreviewButton.addEventListener("click", () => {
  const expanded = preview.classList.toggle("is-expanded");
  expandPreviewButton.textContent = expanded
    ? "Cerrar vista ampliada"
    : "Ampliar vista";
});

editHtmlButton.addEventListener("click", () => {
  const previewDocument = preview.contentDocument;
  if (!previewDocument) {
    showMessage("No pudimos abrir la vista previa para editarla.");
    return;
  }

  isPreviewEditing = true;
  previewDocument.designMode = "on";
  preview.classList.add("is-editing", "is-expanded");
  editHtmlButton.hidden = true;
  expandPreviewButton.hidden = true;
  saveHtmlEditButton.hidden = false;
  cancelHtmlEditButton.hidden = false;
  editWarning.hidden = false;
  showMessage(
    "Puedes editar el artículo directamente en la vista ampliada. Los estilos se mantienen."
  );
});

saveHtmlEditButton.addEventListener("click", async () => {
  const previewDocument = preview.contentDocument;
  if (!previewDocument) {
    showMessage("No pudimos guardar la edición del artículo.");
    return;
  }
  previewDocument.designMode = "off";
  previewDocument
    .querySelectorAll(".warning-highlight")
    .forEach((element) => element.classList.remove("warning-highlight"));
  previewDocument.getElementById("warning-highlight-style")?.remove();
  const doctype = previewDocument.doctype ? "<!doctype html>\n" : "";
  currentHtml = `${doctype}${previewDocument.documentElement.outerHTML}`;
  currentExportHtml = currentHtml;
  try {
    currentExportHtml = await window.electronAPI.preparePreview(currentHtml);
    preview.srcdoc = currentExportHtml;
  } catch (error) {
    console.error(error);
    showMessage("No pudimos actualizar la vista con la edición guardada.");
    return;
  }
  isPreviewEditing = false;
  hasManualEdits = true;
  isApproved = false;
  preview.classList.remove("is-editing", "is-expanded");
  editHtmlButton.hidden = false;
  expandPreviewButton.hidden = false;
  saveHtmlEditButton.hidden = true;
  cancelHtmlEditButton.hidden = true;
  setStatus(
    currentArticle && pendingWarnings(currentArticle.warnings).length
      ? "con-advertencias"
      : "pendiente"
  );
  showMessage("La edición quedó guardada y se usará al exportar el artículo.");
});

cancelHtmlEditButton.addEventListener("click", () => {
  if (!isPreviewEditing) return;
  preview.srcdoc = currentExportHtml;
  isPreviewEditing = false;
  preview.classList.remove("is-editing", "is-expanded");
  editHtmlButton.hidden = false;
  expandPreviewButton.hidden = false;
  saveHtmlEditButton.hidden = true;
  cancelHtmlEditButton.hidden = true;
  editWarning.hidden = !hasManualEdits;
  clearMessage();
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
