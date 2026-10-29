import type { Article } from "../converter/models/Article";
import { renderArticle } from "../renderer-html/renderArticle";
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
let warningFilter: WarningFilter = "pendientes";
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
    const article = await window.electronAPI.convertDocument(filePath);
    const html = renderArticle(article, {
      color: selectedBrandColor,
    });
    const previewHtml = await window.electronAPI.preparePreview(html);

    currentArticle = article;
    warningFilter = "pendientes";
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

editHtmlButton.addEventListener("click", () => {
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
  clearWarningAnnotations(previewDocument);
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
