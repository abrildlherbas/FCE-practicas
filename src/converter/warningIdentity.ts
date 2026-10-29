import type { ParseWarning } from "./models/Article";

function hashSourceText(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function warningIdentity(warning: ParseWarning): string {
  const sourceText = warning.affectedText ?? warning.message;
  return `warning:${JSON.stringify([
    warning.code,
    warning.blockId ?? null,
    hashSourceText(sourceText),
  ])}`;
}
