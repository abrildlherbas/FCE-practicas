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
  it("usa la estructura y los identificadores del header acordado", async () => {
    const template = await fs.readFile(templatePath, "utf8");
    const headerStart = template.indexOf('<header class="header"');
    const mainStart = template.indexOf("<main>");
    const footerStart = template.indexOf('<footer class="footer"');
    const header = template.slice(headerStart, mainStart);

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeLessThan(mainStart);
    expect(mainStart).toBeLessThan(footerStart);
    expect(header).toContain('data-obc-id="{{obc_id}}"');
    expect(header).toContain('data-revista-id="{{revista_id}}"');
    expect(header).toContain('data-articulo-id="{{articulo_id}}"');
    expect(header).toContain('<a href="{{revista.url}}"><h1>{{revista.nombre}}</h1></a>');
    expect(header).toContain("<br>");
    expect(header).toContain("<h2><strong>{{revista.institucion}}</strong></h2>");
    expect(header).toContain("Año: {{anio}} Nro.: {{numero}} Vol.: {{volumen}}");
    expect(header).toContain('<nav class="identidad">');
    expect(header).toContain('href="https://doi.org/{{doi}}"');
    expect(header).not.toContain("logo");
    expect(template).toContain("<main>{{contenido}}</main>");
  });

  it("aplica color, columna editorial y accesibilidad de movimiento y foco", async () => {
    const stylesheet = await fs.readFile(stylesheetPath, "utf8");

    expect(stylesheet).toContain("--revista-color: {{revista.color}};");
    expect(stylesheet).toMatch(
      /\.header,\s*\.footer\s*\{[^}]*background-color:\s*var\(--revista-color\);[^}]*color:\s*#fff;/
    );
    expect(stylesheet).toMatch(
      /main > \*\s*\{\s*width:\s*min\(70ch,\s*calc\(100% - 2rem\)\);/
    );
    expect(stylesheet).toContain("line-height: 1.6;");
    expect(stylesheet).toMatch(
      /main a,\s*main \.note-reference,\s*main \.note-reference a\s*\{\s*color:\s*var\(--revista-color\);/
    );
    expect(stylesheet).toContain(".mailto");
    expect(stylesheet).toContain(".logo");
    expect(stylesheet).toContain(".iconos");
    expect(stylesheet).not.toContain("--revista-logo-url");
    expect(stylesheet).not.toMatch(/box-shadow|text-shadow|linear-gradient/i);
    expect(stylesheet).toContain("a:focus-visible");
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
