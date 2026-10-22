export const citationRules = {
  parentheticalPattern: /\(([^()]*(?:19|20)\d{2}[a-z]?[^()]*)\)/giu,
  narrativePattern:
    /([\p{Lu}][\p{L}'’-]+(?:(?:\s+(?:y|and|&)\s+[\p{Lu}][\p{L}'’-]+)|(?:\s+et\s+al\.))?)\s*\(((?:19|20)\d{2}[a-z]?)\)/gu,
  segmentPattern:
    /^(.+?),\s*((?:19|20)\d{2}[a-z]?)$/iu,
  authorSeparators: /\s+(?:y|and|&)\s+/iu,
} as const;
