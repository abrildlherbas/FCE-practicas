const selectButton =
  document.querySelector<HTMLButtonElement>("#selectButton");

const fileName =
  document.querySelector<HTMLDivElement>("#fileName");

const output =
  document.querySelector<HTMLPreElement>("#output");

if (!selectButton || !fileName || !output) {
  throw new Error("No se encontraron elementos de la interfaz.");
}

selectButton.addEventListener("click", async () => {
  try {
    output.textContent = "Seleccionando documento...";

    const filePath = await window.electronAPI.selectDocument();

    if (!filePath) {
      output.textContent = "";
      return;
    }

    fileName.textContent = filePath;
    output.textContent = "Analizando documento...";

    const article = await window.electronAPI.convertDocument(filePath);

    output.textContent = JSON.stringify(article, null, 2);
  } catch (error) {
    console.error(error);

    output.textContent =
      error instanceof Error ? error.message : String(error);
  }
});