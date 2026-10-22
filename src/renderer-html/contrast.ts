const WHITE_LUMINANCE = 1;
const MINIMUM_CONTRAST_RATIO = 4.5;

export type BrandColorValidation =
  | {
      valid: true;
      color: string;
      contrastRatio: number;
    }
  | {
      valid: false;
      error: string;
      suggestedColor?: string;
      contrastRatio?: number;
    };

function normalizeHex(hex: string): string | null {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;

  const digits = hex.slice(1);
  const expanded =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join("")
      : digits;
  return `#${expanded.toUpperCase()}`;
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3) {
    throw new Error("No se pudo calcular la luminosidad del color.");
  }

  return (
    0.2126 * linearChannel(channels[0]) +
    0.7152 * linearChannel(channels[1]) +
    0.0722 * linearChannel(channels[2])
  );
}

function contrastAgainstWhite(hex: string): number {
  const luminance = relativeLuminance(hex);
  return (WHITE_LUMINANCE + 0.05) / (luminance + 0.05);
}

function closestCompliantShade(hex: string): string {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3) {
    throw new Error("No se pudo sugerir un tono para el color.");
  }

  let compliantScale = 0;
  let nonCompliantScale = 1;
  for (let iteration = 0; iteration < 32; iteration++) {
    const scale = (compliantScale + nonCompliantScale) / 2;
    const candidate = `#${channels
      .map((channel) =>
        Math.round(channel * scale).toString(16).padStart(2, "0")
      )
      .join("")
      .toUpperCase()}`;

    if (contrastAgainstWhite(candidate) >= MINIMUM_CONTRAST_RATIO) {
      compliantScale = scale;
    } else {
      nonCompliantScale = scale;
    }
  }

  let candidate = `#${channels
    .map((channel) =>
      Math.floor(channel * compliantScale).toString(16).padStart(2, "0")
    )
    .join("")
    .toUpperCase()}`;
  while (contrastAgainstWhite(candidate) < MINIMUM_CONTRAST_RATIO) {
    const darkerChannels = candidate
      .slice(1)
      .match(/.{2}/g)
      ?.map((channel) => Math.max(0, Number.parseInt(channel, 16) - 1));
    candidate = `#${(darkerChannels ?? [0, 0, 0])
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  }
  return candidate;
}

export function validateBrandColor(hex: string): BrandColorValidation {
  const color = normalizeHex(hex);
  if (!color) {
    return {
      valid: false,
      error:
        "Escribí un color hexadecimal válido, por ejemplo #245B4B.",
    };
  }

  const contrastRatio = contrastAgainstWhite(color);
  if (contrastRatio >= MINIMUM_CONTRAST_RATIO) {
    return { valid: true, color, contrastRatio };
  }

  return {
    valid: false,
    error:
      "Este color es muy claro y dificulta la lectura. Probá uno más oscuro.",
    suggestedColor: closestCompliantShade(color),
    contrastRatio,
  };
}
