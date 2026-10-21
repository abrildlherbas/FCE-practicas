import type {
  Article,
  BodyBlock,
  InlineRun,
  Note,
} from "../converter/models/Article";
import { articleStyles } from "./styles";

interface NoteReference {
  referenceId: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    Math.max(2, safeLevel + 1),
    previousLevel + 1
  );
  return { tag: `h${level}`, level };
}

function renderTable(block: Extract<BodyBlock, { type: "table" }>, index: number): string {
  const caption = `<caption>Tabla ${index}</caption>`;
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

  return `<div class="article-table-wrap"><table class="article-table">${caption}${header}<tbody>${tableRows}</tbody></table></div>`;
}

function renderBody(
  article: Article,
  noteMap: Map<string, Note>,
  references: Map<string, NoteReference[]>
): string {
  let previousHeadingLevel = 1;
  let tableIndex = 0;

  return article.body
    .map((block, blockIndex) => {
      if (block.type === "heading") {
        const { tag, level } = headingTag(
          block.level,
          previousHeadingLevel
        );
        previousHeadingLevel = level;
        return `<${tag}>${renderRuns(
          block.runs,
          noteMap,
          references,
          blockIndex
        )}</${tag}>`;
      }

      if (block.type === "paragraph") {
        return `<p class="article-paragraph">${renderRuns(
          block.runs,
          noteMap,
          references,
          blockIndex
        )}</p>`;
      }

      if (block.type === "table") {
        tableIndex += 1;
        return renderTable(block, tableIndex);
      }

      return `<figure class="article-figure"><img src="${escapeHtml(
        `${article.document.source.replace(/\.[^.]+$/, "")}_assets/${block.fileName}`
      )}" alt="${escapeHtml(block.alt ?? "")}" /></figure>`;
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
  if (article.header.keywords.length) {
    entries.push(
      `<p class="article-keywords"><strong>Palabras clave:</strong> ${article.header.keywords
        .map(escapeHtml)
        .join("; ")}</p>`
    );
  }
  if (article.header.jel_codes.length) {
    entries.push(
      `<p class="article-jel"><strong>Códigos JEL:</strong> ${article.header.jel_codes
        .map(escapeHtml)
        .join(", ")}</p>`
    );
  }
  if (article.header.doi) {
    entries.push(
      `<p class="article-identifiers"><strong>DOI:</strong> ${escapeHtml(
        article.header.doi
      )}</p>`
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
            } de la nota ${note.id}" role="doc-backlink">↩</a>`
        )
        .join(" ");
      const typeLabel =
        note.type === "footnote" ? "Nota al pie" : "Nota final";
      return `<li id="${noteDomId(note.type, note.id)}" aria-label="${typeLabel} ${note.id}" role="doc-footnote"><span class="note-content">${escapeHtml(
        note.text
      )}</span>${
        backlinks
          ? `<span class="note-backlinks">${backlinks}</span>`
          : ""
      }</li>`;
    })
    .join("");

  return `<section class="article-notes" id="article-notes" aria-labelledby="notes-heading"><h2 id="notes-heading">Notas</h2><ol>${items}</ol></section>`;
}

function renderReferences(article: Article): string {
  return `<section class="article-references" id="article-references" aria-labelledby="references-heading"><h2 id="references-heading">Referencias</h2><ol>${article.references
    .map(
      (reference) =>
        `<li>${escapeHtml(reference.raw)}</li>`
    )
    .join("")}</ol></section>`;
}

export function renderArticle(article: Article): string {
  const title = article.header.title?.trim() || "Artículo sin título";
  const noteMap = new Map(
    article.notes.map((note) => [
      noteKey(note.type, note.id),
      note,
    ])
  );
  const noteReferences = new Map<string, NoteReference[]>();
  const authors = article.header.authors
    .map(escapeHtml)
    .join("; ");
  const affiliations = article.header.affiliations
    .map(escapeHtml)
    .join(" · ");
  const abstract = article.header.abstract
    ? `<section class="article-abstract" aria-labelledby="abstract-heading"><h2 id="abstract-heading">Resumen</h2><p>${escapeHtml(
        article.header.abstract
      )}</p></section>`
    : "";
  const titleTranslation = article.header.title_en
    ? `<p class="article-title-translation">${escapeHtml(
        article.header.title_en
      )}</p>`
    : "";
  const body = renderBody(article, noteMap, noteReferences);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${articleStyles}</style>
</head>
<body>
  <header class="journal-header">
    <div class="journal-masthead">Revista científica</div>
  </header>
  <main id="main-content">
    <article class="article-content" aria-labelledby="article-title">
      <header class="article-header">
        <h1 class="article-heading" id="article-title">${escapeHtml(
          title
        )}</h1>
        ${titleTranslation}
        ${
          authors
            ? `<p class="article-byline">${authors}</p>`
            : ""
        }
        ${
          affiliations
            ? `<p class="article-affiliations">${affiliations}</p>`
            : ""
        }
        ${renderDates(article)}
        ${abstract}
        ${renderMetadata(article)}
      </header>
      <section class="article-body" aria-label="Texto del artículo">
        ${body}
      </section>
      ${renderNotes(article.notes, noteReferences)}
      ${renderReferences(article)}
    </article>
  </main>
  <footer class="journal-footer">
    <div class="journal-footer-inner">
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
