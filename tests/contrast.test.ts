import { describe, expect, it } from "vitest";

import { validateBrandColor } from "../src/renderer-html/contrast";

describe("validateBrandColor", () => {
  it.each(["#123A70", "#14532D"])(
    "acepta colores oscuros con contraste suficiente (%s)",
    (color) => {
      const result = validateBrandColor(color);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.color).toBe(color);
        expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5);
      }
    }
  );

  it.each(["#FFFF00", "#87CEFA"])(
    "rechaza colores claros y sugiere un tono que cumple (%s)",
    (color) => {
      const result = validateBrandColor(color);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe(
          "Este color es muy claro y dificulta la lectura. Probá uno más oscuro."
        );
        expect(result.suggestedColor).toMatch(/^#[0-9A-F]{6}$/);
        const suggested = validateBrandColor(result.suggestedColor!);
        expect(suggested.valid).toBe(true);
      }
    }
  );

  it.each(["245B4B", "#12", "#GGGGGG", "rgb(0,0,0)", "#12345678"])(
    "rechaza formatos hexadecimales inválidos (%s)",
    (color) => {
      const result = validateBrandColor(color);

      expect(result).toMatchObject({
        valid: false,
        error:
          "Escribí un color hexadecimal válido, por ejemplo #245B4B.",
      });
    }
  );

  it("normaliza el formato hexadecimal corto", () => {
    expect(validateBrandColor("#123")).toMatchObject({
      valid: true,
      color: "#112233",
    });
  });
});
