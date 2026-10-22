export const noteRules = {
  referenceHeadingPatterns: [
    /^(?:\d+(?:\.\d+)*\.?\s*)?(?:referencias?(?:\s+bibliogr[aá]ficas?)?|bibliograf[ií]a|references|bibliography)\s*:?\s*$/i,
  ],
  noteStartPatterns: [
    /^\s*\[\d{1,3}\]\s*/,
    /^\s*\d{1,3}[.)]\s+/,
  ],
  superscriptNoteStartPattern: /^\s*\d{1,3}\s*/,
  authorYearPattern:
    /^(.+?)\s*\((\d{4}[a-z]?)\)/i,
  surnamePattern: /^[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]+/u,
  bodySizeQuantile: 0.5,
} as const;
