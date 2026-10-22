import { describe, expect, it } from "vitest";

import {
  MAX_BRAND_LOGO_SIZE_BYTES,
  validateBrandLogo,
} from "../src/renderer-html/brand-logo";

const encoder = new TextEncoder();

describe("validateBrandLogo", () => {
  it("acepta PNG, JPG y SVG válidos y genera un data URI", () => {
    const png = validateBrandLogo(
      "revista.png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const jpg = validateBrandLogo(
      "revista.jpg",
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    );
    const svg = validateBrandLogo(
      "revista.svg",
      encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    );

    expect(png.valid).toBe(true);
    expect(jpg.valid).toBe(true);
    expect(svg.valid).toBe(true);
    if (png.valid) {
      expect(png.logo.dataUri).toMatch(/^data:image\/png;base64,/);
    }
    if (jpg.valid) {
      expect(jpg.logo.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    }
    if (svg.valid) {
      expect(svg.logo.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it("rechaza formatos no permitidos y contenido que no coincide", () => {
    expect(
      validateBrandLogo("revista.gif", new Uint8Array([1, 2, 3]))
    ).toMatchObject({ valid: false });
    expect(
      validateBrandLogo("revista.png", encoder.encode("not a PNG"))
    ).toMatchObject({ valid: false });
  });

  it("rechaza logos mayores a 500 KB", () => {
    const bytes = new Uint8Array(MAX_BRAND_LOGO_SIZE_BYTES + 1);
    const result = validateBrandLogo("revista.png", bytes);

    expect(result).toMatchObject({
      valid: false,
      error: "El logo pesa más de 500 KB. Elegí un archivo más liviano.",
    });
  });

  it("rechaza SVG con scripts o referencias externas", () => {
    const withScript = validateBrandLogo(
      "revista.svg",
      encoder.encode("<svg><script>alert(1)</script></svg>")
    );
    const externalImage = validateBrandLogo(
      "revista.svg",
      encoder.encode('<svg><image href="https://example.invalid/logo.png"/></svg>')
    );

    expect(withScript.valid).toBe(false);
    expect(externalImage.valid).toBe(false);
  });
});
