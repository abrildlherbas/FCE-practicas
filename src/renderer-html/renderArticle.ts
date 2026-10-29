import type {
  Article,
  BodyBlock,
  InlineRun,
  Note,
} from "../converter/models/Article";
import { TEMPLATE_VERSION } from "../template/templateVersion";
import { articleStyles } from "./styles";

interface NoteReference {
  referenceId: string;
}

export interface MagazineConfig {
  color: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: string): boolean {
  const protocol = value.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  return !protocol || ["http", "https", "mailto", "tel"].includes(protocol);
}

function noteKey(type: Note["type"], id: number): string {
  return `${type}-${id}`;
}

function noteDomId(type: Note["type"], id: number): string {
  return `note-${noteKey(type, id)}`;
}

function renderRuns(
  runs: InlineRun[],
  noteMap: Map<string, Note>,
  references: Map<string, NoteReference[]>,
  blockIndex: number
): string {
  return runs
    .map((run) => {
      if (run.type === "citation") {
        let content = escapeHtml(run.text);
        if (run.italic) content = `<em>${content}</em>`;
        if (run.bold) content = `<strong>${content}</strong>`;
        const referenceNumber =
          run.referenceId.match(/(\d+)$/)?.[1] ?? "";
        return `<a id="${escapeHtml(
          run.citationId
        )}" class="article-citation" href="#${escapeHtml(
          run.referenceId
        )}" aria-label="Ir a la referencia ${referenceNumber}" role="doc-biblioref">${content}</a>`;
      }

      if (run.type === "noteRef") {
        const key = noteKey(run.noteType, run.noteId);
        const note = noteMap.get(key);
        if (!note) {
          return `<sup class="note-reference"><span aria-label="${escapeHtml(
            `Nota ${run.noteId} no disponible`
          )}">${run.noteId}</span></sup>`;
        }

        const noteReferences = references.get(key) ?? [];
        const referenceId = `note-ref-${key}-${blockIndex}-${
          noteReferences.length + 1
        }`;
        noteReferences.push({ referenceId });
        references.set(key, noteReferences);

        return `<sup class="note-reference"><a id="${referenceId}" href="#${noteDomId(
          run.noteType,
          run.noteId
        )}" aria-label="Ir a la ${
          run.noteType === "footnote" ? "nota al pie" : "nota final"
        } ${run.noteId}" role="doc-noteref">${run.noteId}</a></sup>`;
      }

      if (run.type === "link") {
        let content = escapeHtml(run.text);
        if (run.italic) content = `<em>${content}</em>`;
        if (run.bold) content = `<strong>${content}</strong>`;
        return safeHref(run.href)
          ? `<a href="${escapeHtml(run.href)}">${content}</a>`
          : content;
      }

      let content = escapeHtml(run.text);
      if (run.italic) content = `<em>${content}</em>`;
      if (run.bold) content = `<strong>${content}</strong>`;
      return content;
    })
    .join("");
}

function headingTag(
  requestedLevel: number,
  previousLevel: number
): { tag: string; level: number } {
  const safeLevel = Number.isInteger(requestedLevel)
    ? Math.min(6, Math.max(1, requestedLevel))
    : 1;
  const level = Math.min(
    6,
    Math.max(3, safeLevel + 2),
    previousLevel + 1
  );
  return { tag: `h${level}`, level };
}

function renderTable(
  block: Extract<BodyBlock, { type: "table" }>,
  blockId: string
): string {
  const tableRows = block.rows
    .map((row) => {
      const cells =
        block.headers.length > 0
          ? row
              .map((cell) => `<td>${escapeHtml(cell)}</td>`)
              .join("")
          : row
              .map((cell, cellIndex) =>
                cellIndex === 0
                  ? `<th scope="row">${escapeHtml(cell)}</th>`
                  : `<td>${escapeHtml(cell)}</td>`
              )
              .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const header = block.headers.length
    ? `<thead><tr>${block.headers
        .map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`)
        .join("")}</tr></thead>`
    : "";

  const caption = block.caption
    ? `<caption>${escapeHtml(block.caption)}</caption>`
    : "";
  const label = block.caption || "Tabla del artículo";
  return `<div class="article-table-wrap" data-bloque-id="${blockId}" role="region" aria-label="${escapeHtml(
    label
  )}" tabindex="0"><table class="article-table">${caption}${header}<tbody>${tableRows}</tbody></table></div>`;
}

function renderBody(
  article: Article,
  noteMap: Map<string, Note>,
  references: Map<string, NoteReference[]>
): string {
  let previousHeadingLevel = 2;
  return article.body
    .map((block, blockIndex) => {
      const blockId = `b-${blockIndex}`;
      if (block.type === "heading") {
        const { tag, level } = headingTag(
          block.level,
          previousHeadingLevel
        );
        previousHeadingLevel = level;
        return `<${tag} data-bloque-id="${blockId}">${renderRuns(
          block.runs,
          noteMap,
          references,
          blockIndex
        )}</${tag}>`;
      }

      if (block.type === "paragraph") {
        return `<p class="article-paragraph" data-bloque-id="${blockId}">${renderRuns(
          block.runs,
          noteMap,
          references,
          blockIndex
        )}</p>`;
      }

      if (block.type === "table") {
        return renderTable(block, blockId);
      }

      return `<figure class="article-figure" data-bloque-id="${blockId}"><img src="${escapeHtml(
        `${article.document.source.replace(/\.[^.]+$/, "")}_assets/${block.fileName}`
      )}" alt="${escapeHtml(block.alt ?? "")}" />${
        block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""
      }</figure>`;
    })
    .join("\n");
}

function renderDates(article: Article): string {
  const dates = [
    ["Recibido", article.header.dates.received],
    ["Aceptado", article.header.dates.accepted],
    ["Publicado", article.header.dates.published],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!dates.length) return "";

  return `<p class="article-dates">${dates
    .map(
      ([label, date]) =>
        `<span><strong>${label}:</strong> ${escapeHtml(date)}</span>`
    )
    .join(" <span aria-hidden=\"true\">·</span> ")}</p>`;
}

function renderMetadata(article: Article): string {
  const entries: string[] = [];
  if (article.header.jel_codes.length) {
    entries.push(
      `<p class="article-jel"><strong>Código JEL:</strong> ${article.header.jel_codes
        .map(escapeHtml)
        .join(", ")}</p>`
    );
  }
  if (article.header.doi) {
    entries.push(
      `<p class="article-identifiers"><strong>DOI:</strong> <a href="https://doi.org/${escapeHtml(
        article.header.doi
      )}">https://doi.org/${escapeHtml(article.header.doi)}</a></p>`
    );
  }
  if (article.header.orcid) {
    entries.push(
      `<p class="article-identifiers"><strong>ORCID:</strong> ${escapeHtml(
        article.header.orcid
      )}</p>`
    );
  }
  if (!entries.length) return "";
  return `<div class="article-metadata">${entries.join("")}</div>`;
}

function renderAuthors(article: Article): string {
  if (!article.header.authors.length) return "";

  const authors = article.header.authors
    .map((author) => {
      const affiliations = author.affiliations
        .map(
          (id) =>
            `<sup><a href="#affiliation-${escapeHtml(
              id
            )}" aria-label="Afiliación ${escapeHtml(id)}">${escapeHtml(
              id
            )}</a></sup>`
        )
        .join("");
      const orcid = author.orcid
        ? ` <a class="article-orcid" href="https://orcid.org/${escapeHtml(
            author.orcid
          )}" rel="noopener noreferrer" aria-label="ORCID de ${escapeHtml(
            author.name
          )}">https://orcid.org/${escapeHtml(author.orcid)}</a>`
        : "";
      return `<span class="article-author">${escapeHtml(
        author.name
      )}${affiliations}${orcid}</span>`;
    })
    .join("; ");

  return `<p class="article-byline">${authors}</p>`;
}

function renderAffiliations(article: Article): string {
  if (!article.header.affiliations.length) return "";

  return `<ul class="article-affiliations">${article.header.affiliations
    .map(
      (affiliation) =>
        `<li id="affiliation-${escapeHtml(
          affiliation.id
        )}"><span class="affiliation-marker">${escapeHtml(
          affiliation.id
        )}</span> ${escapeHtml(affiliation.text)}</li>`
    )
    .join("")}</ul>`;
}

function renderAbstracts(article: Article): string {
  const abstracts: string[] = [];
  if (article.header.abstract?.trim()) {
    abstracts.push(
      `<section class="article-abstract" lang="es" aria-labelledby="abstract-heading"><h2 id="abstract-heading">Resumen</h2><p>${escapeHtml(
        article.header.abstract
      )}</p></section>`
    );
  }
  if (article.header.abstract_en?.trim()) {
    abstracts.push(
      `<section class="article-abstract" lang="en" aria-labelledby="abstract-en-heading"><h2 id="abstract-en-heading">Abstract</h2><p>${escapeHtml(
        article.header.abstract_en
      )}</p></section>`
    );
  }
  return abstracts.join("");
}

function renderKeywords(article: Article): string {
  const entries: string[] = [];
  if (article.header.keywords.length) {
    entries.push(
      `<p class="article-keywords" lang="es"><strong>Palabras clave:</strong> ${article.header.keywords
        .map(escapeHtml)
        .join("; ")}</p>`
    );
  }
  if (article.header.keywords_en?.length) {
    entries.push(
      `<p class="article-keywords" lang="en"><strong>Key words:</strong> ${article.header.keywords_en
        .map(escapeHtml)
        .join("; ")}</p>`
    );
  }
  return entries.join("");
}

function renderNotes(
  notes: Note[],
  references: Map<string, NoteReference[]>
): string {
  const items = notes
    .map((note) => {
      const key = noteKey(note.type, note.id);
      const backlinks = (references.get(key) ?? [])
        .map(
          ({ referenceId }, index) =>
            `<a href="#${referenceId}" aria-label="Volver a la referencia ${
              index + 1
            } de la nota ${note.id}" role="doc-backlink"></a>`
        )
        .join("");
      const typeLabel =
        note.type === "footnote" ? "Nota al pie" : "Nota final";
      return `<li id="${noteDomId(note.type, note.id)}" aria-label="${typeLabel} ${note.id}" role="doc-footnote"><span class="note-content">${escapeHtml(
        note.text
      )}</span>${backlinks}</li>`;
    })
    .join("");

  return `<section class="article-notes" id="article-notes"><ol>${items}</ol></section>`;
}

function renderReferences(
  article: Article,
  backlinks: Map<string, string[]>
): string {
  return `<section class="article-references" id="article-references" aria-labelledby="references-heading"><h2 id="references-heading">Referencias bibliográficas</h2><ol>${article.references
    .map(
      (reference, index) => {
        const links = (backlinks.get(reference.id) ?? [])
          .map(
            (citationId, citationIndex) =>
              `<a class="reference-backlink" href="#${escapeHtml(
                citationId
              )}" aria-label="Volver a la cita ${citationIndex + 1} de la referencia ${
                index + 1
              }" role="doc-backlink"></a>`
          )
          .join("");
        return `<li id="${escapeHtml(reference.id)}">${escapeHtml(
          reference.raw
        )}${links}</li>`;
      }
    )
    .join("")}</ol></section>`;
}

function citationBacklinks(article: Article): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  for (const block of article.body) {
    if (!("runs" in block)) continue;
    for (const run of block.runs) {
      if (run.type !== "citation") continue;
      const references = backlinks.get(run.referenceId) ?? [];
      references.push(run.citationId);
      backlinks.set(run.referenceId, references);
    }
  }
  return backlinks;
}

export function renderArticle(
  article: Article,
  magazine?: MagazineConfig
): string {
  const title = article.header.title?.trim() ?? "";
  const magazineColor = magazine?.color ?? "#245B4B";
  if (!/^#[0-9a-f]{6}$/i.test(magazineColor)) {
    throw new Error("El color debe ser hexadecimal válido en formato #RRGGBB.");
  }
  const magazineColorStyles =
    `:root{--revista-color:${magazineColor.toUpperCase()}}`;
  const noteMap = new Map(
    article.notes.map((note) => [
      noteKey(note.type, note.id),
      note,
    ])
  );
  const noteReferences = new Map<string, NoteReference[]>();
  const referenceBacklinks = citationBacklinks(article);
  const titleTranslation = article.header.title_en
    ? `<p class="article-title-translation" lang="en">${escapeHtml(
        article.header.title_en
      )}</p>`
    : "";
  const body = renderBody(article, noteMap, noteReferences);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="template-version" content="${TEMPLATE_VERSION}" />
  <title>${escapeHtml(title)}</title>
  <style>${articleStyles}${magazineColorStyles}</style>
</head>
<body>
  <header class="header">
    <div class="journal-masthead">Revista científica</div>
  </header>
  <main id="main-content">
    <article class="article-content" aria-labelledby="article-title">
      <header class="article-header">
        <section class="article-data" aria-label="Datos del artículo">
          ${[
            `<h2 class="article-heading" id="article-title">${escapeHtml(
              article.header.title?.trim() ?? ""
            )}</h2>`,
            titleTranslation,
            renderAuthors(article),
            renderAffiliations(article),
            renderDates(article),
            renderAbstracts(article),
            renderKeywords(article),
            renderMetadata(article),
          ].join("")}
        </section>
      </header>
      <section class="article-body" aria-label="Texto del artículo">
        ${body}
      </section>
      ${renderNotes(article.notes, noteReferences)}
      ${renderReferences(article, referenceBacklinks)}
    </article>
  </main>
  <footer class="footer">
    <div class="footer-inner">
      <span>Revista científica</span>
      <nav aria-label="Navegación del artículo">
        <ul>
          <li><a href="#main-content">Inicio del artículo</a></li>
          <li><a href="#article-notes">Notas</a></li>
          <li><a href="#article-references">Referencias</a></li>
        </ul>
      </nav>
    </div>
  </footer>
</body>
</html>`;
}
