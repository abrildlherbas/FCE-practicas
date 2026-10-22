import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatePath = fileURLToPath(
  new URL("../src/template/template.html", import.meta.url)
);
const stylesheetPath = fileURLToPath(
  new URL("../src/template/revista.css", import.meta.url)
);

describe("plantilla editorial", () => {
  it("mantiene Header, Main y Footer en el orden acordado", async () => {
    const template = await fs.readFile(templatePath, "utf8");
    const headerStart = template.indexOf('<header');
    const mainStart = template.indexOf('<main class="revista-main"');
    const footerStart = template.indexOf('<footer class="revista-footer"');

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeLessThan(mainStart);
    expect(mainStart).toBeLessThan(footerStart);
    expect(template).toContain('class="revista-header"');
    expect(template).toContain('data-obc-id="{{obc_id}}"');
    expect(template).toContain('data-revista-id="{{revista_id}}"');
    expect(template).toContain('data-articulo-id="{{articulo_id}}"');
    expect(template).toContain(
      '<nav class="revista-identidad" aria-label="Identificación de la revista">'
    );
    expect(template).toContain(
      '<a href="https://doi.org/{{doi}}">https://doi.org/{{doi}}</a>'
    );
    expect(template).not.toContain("index.html");
  });

  it("usa placeholders dinámicos y conserva el orden requerido en el footer", async () => {
    const template = await fs.readFile(templatePath, "utf8");
    const footer = template.slice(template.indexOf('<footer'));
    const institutionIndex = footer.indexOf("revista-datos-institucionales");
    const logoIndex = footer.indexOf("class=\"revista-logo\"");
    const licenseIndex = footer.indexOf("revista-licencia");

    expect(institutionIndex).toBeLessThan(logoIndex);
    expect(logoIndex).toBeLessThan(licenseIndex);
    for (const field of [
      "directora",
      "propietario",
      "rector",
      "direccion",
      "mail",
    ]) {
      expect(footer).toContain(`{{magazine.${field}}}`);
    }
    expect(template.match(/class="revista-logo"/g)).toHaveLength(2);
    expect(template.match(/role="img"/g)).toHaveLength(2);
    expect(template.match(/aria-label="Logo de \{\{nombre_revista\}\}"/g))
      .toHaveLength(2);
    expect(template).not.toMatch(/\sstyle\s*=/i);
    expect(template).not.toMatch(/<br\b|&nbsp;/i);
  });

  it("limita los colores de marca a los bloques editoriales y acentos", async () => {
    const stylesheet = await fs.readFile(stylesheetPath, "utf8");
    const colorUses = stylesheet.match(/var\(--revista-color\)/g) ?? [];

    expect(colorUses).toHaveLength(2);
    expect(stylesheet).toMatch(
      /\.revista-header,\s*\.revista-footer\s*\{[^}]*background-color:\s*var\(--revista-color\)/
    );
    expect(stylesheet).toMatch(
      /\.revista-main a,\s*\.revista-nota-ref\s*\{\s*color:\s*var\(--revista-color\)/
    );
    expect(stylesheet).toContain(
      "background-image: var(--revista-logo-url);"
    );
    expect(stylesheet).toContain("background-color: #fff;");
    expect(stylesheet).not.toMatch(/box-shadow|text-shadow|linear-gradient|animation\s*:/i);
    expect(stylesheet).not.toMatch(/--(?!revista-color|revista-logo-url)[\w-]+\s*:/);
  });
});
