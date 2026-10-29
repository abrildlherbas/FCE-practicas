export const articleStyles = `
:root {
  color-scheme: light;
  --article-paper: #fffefa;
  --article-ink: #202522;
  --article-muted: #5e6962;
  --article-accent: #245b4b;
  --article-rule: #d8ded8;
  --article-surface: #f3f5f1;
  --article-font-body: system-ui, -apple-system, "Segoe UI", sans-serif;
  --article-font-ui: system-ui, -apple-system, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--article-paper);
  color: var(--article-ink);
  font-family: var(--article-font-body);
  line-height: 1.6;
}

a {
  color: var(--revista-color, var(--article-accent));
  text-underline-offset: 0.18em;
}

a:focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 3px;
}

.header,
.footer {
  font-family: var(--article-font-ui);
  background-color: var(--revista-color);
  color: #fff;
}

.header a,
.footer a {
  color: #fff;
}

.header {
  border-bottom: 1px solid var(--article-rule);
}

.journal-masthead,
.footer-inner,
.article-content {
  width: min(70ch, calc(100% - 2rem));
  margin-inline: auto;
}

.journal-masthead {
  padding-block: 1.25rem;
  color: #fff;
  font-size: 0.8125rem;
}

.journal-title {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.journal-title a {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.journal-institution {
  margin-top: 0.25rem;
  font-size: 0.85rem;
  opacity: 0.95;
}

.journal-meta {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.8125rem;
  opacity: 0.95;
}

.journal-meta a {
  color: #fff;
  text-decoration: underline;
}

.article-content {
  padding-block: clamp(2.5rem, 7vw, 5.5rem);
}

main {
  background-color: var(--article-paper);
}

.article-heading {
  margin: 0 0 1rem;
  font-size: clamp(2rem, 5vw, 3.4rem);
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.035em;
}

.article-title-translation {
  margin: -0.25rem 0 1.5rem;
  color: var(--article-muted);
  font-size: 1.35rem;
  font-style: italic;
}

.article-byline,
.article-affiliations,
.article-dates,
.article-identifiers,
.article-keywords,
.article-jel {
  color: var(--article-muted);
  font-family: var(--article-font-ui);
  font-size: 0.9rem;
}

.article-byline {
  margin: 0.75rem 0 0;
  color: var(--article-ink);
}

.article-affiliations {
  margin: 0.35rem 0 1.5rem;
  padding-left: 1.25rem;
}

.article-affiliations li + li {
  margin-top: 0.25rem;
}

.affiliation-marker {
  font-weight: 700;
}

.article-orcid {
  margin-left: 0.25rem;
  font-size: 0.8em;
}

.article-abstract {
  margin-block: 2rem 3rem;
  padding: 1.25rem 1.5rem;
  border-left: 3px solid var(--revista-color, var(--article-accent));
  background: var(--article-surface);
}

.article-abstract h2,
.article-content h2,
.article-content h3,
.article-content h4,
.article-content h5,
.article-content h6 {
  color: var(--article-ink);
  font-family: var(--article-font-ui);
  line-height: 1.3;
}

.article-abstract h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.article-abstract p {
  margin: 0;
}

.article-metadata {
  margin-block: 1.5rem 3rem;
  padding-block: 1rem;
  border-block: 1px solid var(--article-rule);
}

.article-metadata p {
  margin: 0.35rem 0;
}

.article-content h2 {
  margin-top: 2.5rem;
  font-size: 1.6rem;
}

.article-header .article-heading {
  margin-top: 0;
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.article-content h3 {
  margin-top: 2rem;
  font-size: 1.3rem;
}

.article-content h4,
.article-content h5,
.article-content h6 {
  margin-top: 1.5rem;
  font-size: 1.1rem;
}

.article-paragraph {
  margin-block: 0 1.25rem;
  white-space: pre-wrap;
}

.note-reference {
  color: var(--revista-color, var(--article-accent));
  font-family: var(--article-font-ui);
  font-size: 0.75em;
  line-height: 0;
  vertical-align: super;
}

.article-figure {
  margin: 2rem 0;
  text-align: center;
}

.article-figure img {
  max-width: 100%;
  height: auto;
}

.article-table-wrap {
  overflow-x: auto;
  margin-block: 2rem;
}

.article-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.article-table caption {
  padding: 0.6rem;
  color: var(--article-muted);
  font-family: var(--article-font-ui);
  font-size: 0.85rem;
  text-align: left;
}

.article-table th,
.article-table td {
  padding: 0.65rem 0.8rem;
  border-bottom: 1px solid var(--article-rule);
  text-align: left;
  vertical-align: top;
}

.article-table thead th,
.article-table tbody th[scope="row"] {
  color: var(--article-ink);
  font-family: var(--article-font-ui);
  font-weight: 600;
}

.article-notes,
.article-references {
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--article-rule);
}

.article-notes h2,
.article-references h2 {
  margin-top: 0;
  font-size: 1.4rem;
}

.article-notes li,
.article-references li {
  margin-block: 0.75rem;
  padding-left: 0.25rem;
}

.reference-backlink {
  display: inline-block;
  margin-inline-start: 0.45rem;
  font-family: var(--article-font-ui);
}

.reference-backlink::before {
  content: "↩";
}

.note-backlinks {
  margin-left: 0.5rem;
  font-family: var(--article-font-ui);
  font-size: 0.85rem;
}

.footer {
  margin-top: 4rem;
  border-top: 1px solid var(--article-rule);
}

.footer-inner {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1.5rem;
  color: #fff;
  font-size: 0.8125rem;
}

.footer-inner > * {
  color: #fff;
}

.footer nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 36rem) {
  .article-abstract {
    padding: 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
