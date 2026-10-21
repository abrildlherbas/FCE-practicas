import type { Article } from "../converter/models/Article";
import { renderArticle } from "../renderer-html/renderArticle";

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No se encontró un elemento necesario: ${selector}`);
  }
  return element;
}

const selectButton = getElement<HTMLButtonElement>("#selectButton");
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
      "Hay contenido que no pudimos incluir. Revisa si falta una parte del artículo.",
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
  if (article.warnings.length === 0) {
    warningSummary.textContent = "No encontramos puntos que requieran atención.";
    const item = document.createElement("li");
    item.className = "no-warnings";
    item.textContent = "El artículo está listo para que lo revises.";
    warningList.append(item);
    setStatus("pendiente");
    return;
  }

  warningSummary.textContent =
    article.warnings.length === 1
      ? "Encontramos un punto para revisar."
      : `Encontramos ${article.warnings.length} puntos para revisar.`;
  for (const warning of article.warnings) {
    const item = document.createElement("li");
    item.className = "warning-item";
    item.textContent = friendlyWarning(warning.code, warning.message);
    warningList.append(item);
  }
  setStatus("con-advertencias");
}

function setBusy(busy: boolean): void {
  isBusy = busy;
  selectButton.disabled = busy;
  changeDocumentButton.disabled = busy;
  newDocumentButton.disabled = busy;
  approveButton.disabled = busy;
  exportButton.disabled = busy;
  openFolderButton.disabled = busy;
}

function resetToStart(): void {
  currentArticle = null;
  currentHtml = "";
  currentExportHtml = "";
  currentFilePath = "";
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
  clearMessage();

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
    const html = renderArticle(article);
    const previewHtml = await window.electronAPI.preparePreview(html);

    currentArticle = article;
    currentHtml = html;
    currentExportHtml = previewHtml;
    fileName.textContent = filePath.split(/[\\/]/).pop() ?? "Documento Word";
    approvedFileName.textContent = fileName.textContent;
    preview.srcdoc = previewHtml;
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
    currentArticle.warnings.length ? "con-advertencias" : "pendiente"
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
