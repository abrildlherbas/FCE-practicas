export const MAX_BRAND_LOGO_SIZE_BYTES = 500 * 1024;

export interface ValidatedBrandLogo {
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
  sizeBytes: number;
  dataUri: string;
}

export type BrandLogoValidation =
  | { valid: true; logo: ValidatedBrandLogo }
  | { valid: false; error: string };

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff &&
    bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isSafeSvg(bytes: Uint8Array): boolean {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  return (
    /<svg(?:\s|>)/i.test(source) &&
    !/<\s*(?:script|foreignObject)\b/i.test(source) &&
    !/\bon[a-z]+\s*=/i.test(source) &&
    !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:)/i.test(
      source
    ) &&
    !/url\(\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i.test(source)
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

export function validateBrandLogo(
  fileName: string,
  bytes: Uint8Array
): BrandLogoValidation {
  if (bytes.length === 0) {
    return { valid: false, error: "El archivo del logo está vacío." };
  }
  if (bytes.length > MAX_BRAND_LOGO_SIZE_BYTES) {
    return {
      valid: false,
      error: "El logo pesa más de 500 KB. Elegí un archivo más liviano.",
    };
  }

  const extension = fileName.split(".").at(-1)?.toLowerCase();
  let mimeType: ValidatedBrandLogo["mimeType"] | null = null;
  let hasValidContent = false;

  if (extension === "png") {
    mimeType = "image/png";
    hasValidContent = hasPngSignature(bytes);
  } else if (extension === "jpg" || extension === "jpeg") {
    mimeType = "image/jpeg";
    hasValidContent = hasJpegSignature(bytes);
  } else if (extension === "svg") {
    mimeType = "image/svg+xml";
    hasValidContent = isSafeSvg(bytes);
  }

  if (!mimeType) {
    return {
      valid: false,
      error: "El logo debe ser un archivo PNG, SVG o JPG.",
    };
  }
  if (!hasValidContent) {
    return {
      valid: false,
      error:
        "El archivo no parece ser una imagen válida del tipo indicado o contiene elementos no permitidos.",
    };
  }

  return {
    valid: true,
    logo: {
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      dataUri: `data:${mimeType};base64,${encodeBase64(bytes)}`,
    },
  };
}
