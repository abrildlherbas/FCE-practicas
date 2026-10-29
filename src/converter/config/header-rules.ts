export const headerRules = {
  titleStylePatterns: [
    /^(?:title|titulo|t[ií]tulo)$/i,
  ],
  titleMinimumSizeHalfPoints: 28,
  titleEnglishPatterns: [
    /^(?:english\s+title|title\s+in\s+english)\s*:\s*(.+)$/i,
  ],
  paragraphJoining: {
    enabled: true,
    terminalPunctuation: /[.!?…:;]$/u,
    startsLowercase: /^\p{Ll}/u,
  },
  layoutFieldStylePatterns: [
    /^(?:toc|toc\d+|tableofcontents|indice|índice|header|footer)$/i,
  ],
  maxHeaderBlocks: 40,
  bodyHeadingPatterns: [
    /^(?:\d+(?:\.\d+)*\.?\s*)?(?:introducci[oó]n|metodolog[ií]a|marco te[oó]rico|resultados|discusi[oó]n|conclusiones|referencias bibliogr[aá]ficas)$/i,
  ],
  abstractPatterns: [
    /^(?:resumen|abstract|abstrac)\s*:?\s*(.*)$/i,
  ],
  keywordPatterns: [
    /^(?:palabras\s+clave|key\s*words|keywords)\s*:\s*(.*)$/i,
  ],
  jelPatterns: [
    /^(?:c[oó]digos?\s+jel|jel\s+codes?)\s*:\s*(.*)$/i,
  ],
  receivedPatterns: [
    /^recibido\s*:\s*(.+)$/i,
    /^received\s*:\s*(.+)$/i,
  ],
  acceptedPatterns: [
    /^aceptado\s*:\s*(.+)$/i,
    /^accepted\s*:\s*(.+)$/i,
  ],
  publishedPatterns: [
    /^publicado\s*:\s*(.+)$/i,
    /^published\s*:\s*(.+)$/i,
  ],
  sectionPatterns: [
    /^secci[oó]n\s*:\s*(.+)$/i,
    /^section\s*:\s*(.+)$/i,
  ],
  affiliationPatterns: [
    /^(?:afiliaci[oó]n|affiliation)\s*:\s*(.+)$/i,
    /^(?:\[?[ivxlcdm]+\]?(?:\s+|(?=[A-Z])))(.+)$/,
  ],
  authorPatterns: [
    /^(?:autor(?:es)?|author(?:s)?)\s*:\s*(.+)$/i,
  ],
  doiPatterns: [
    /^(?:doi\s*:\s*|https?:\/\/doi\.org\/)(10\.\S+)/i,
  ],
  orcidPattern:
    /https?:\/\/orcid\.org\/([0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4})/i,
} as const;
