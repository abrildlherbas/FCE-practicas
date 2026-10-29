import JSZip from "jszip";
import fs from "node:fs/promises";

async function main() {
  const data = await fs.readFile("ejemplo/Carbonel_Cielo.docx");
  const zip = await JSZip.loadAsync(data);
  let headerText = "";
  for (const fileName of Object.keys(zip.files)) {
    if (/word\/header\d+\.xml/.test(fileName)) {
      const xml = await zip.file(fileName)!.async("text");
      const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      headerText += " " + text;
    }
  }
  console.log("Header text:", headerText.trim());

  // Test regexes
  const yearMatch = headerText.match(/(?:año|year)\s*[:.]?\s*(\d{4})/i) || headerText.match(/\b(20\d\d)\b/);
  const volMatch = headerText.match(/(?:volumen|vol\.?|volume)\s*[:.]?\s*([A-Za-z0-9]+)/i);
  const numMatch = headerText.match(/(?:nro\.?|número|numero|no\.?|issue)\s*[:.]?\s*([A-Za-z0-9]+)/i);

  console.log("Detected year:", yearMatch?.[1]);
  console.log("Detected vol:", volMatch?.[1]);
  console.log("Detected num:", numMatch?.[1]);
}

main().catch(console.error);
