export const articleStyles = `
:root {
  color-scheme: light;
  --article-paper: #fffefa;
  --article-ink: #202522;
  --article-muted: #5e6962;
  --article-accent: #245b4b;
  --article-rule: #d8ded8;
  --article-surface: #f3f5f1;
  --article-font-body: Georgia, "Times New Roman", serif;
  --article-font-ui: "Segoe UI", Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--article-paper);
  color: var(--article-ink);
  font-family: var(--article-font-body);
  font-size: 1.0625rem;
  line-height: 1.75;
}

a {
  color: var(--article-accent);
  text-underline-offset: 0.18em;
}

a:focus-visible {
  outline: 3px solid var(--article-accent);
  outline-offset: 3px;
}

.journal-header,
.journal-footer {
  font-family: var(--article-font-ui);
}

.journal-header {
  border-bottom: 1px solid var(--article-rule);
}

.journal-masthead,
.journal-footer-inner,
.article-content {
  width: min(100% - 3rem, 48rem);
  margin-inline: auto;
}

.journal-masthead {
  padding-block: 1.25rem;
  color: var(--article-accent);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.article-content {
  padding-block: clamp(2.5rem, 7vw, 5.5rem);
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
}

.article-abstract {
  margin-block: 2rem 3rem;
  padding: 1.25rem 1.5rem;
  border-left: 3px solid var(--article-accent);
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

.note-backlinks {
  margin-left: 0.5rem;
  font-family: var(--article-font-ui);
  font-size: 0.85rem;
}

.journal-footer {
  margin-top: 4rem;
  border-top: 1px solid var(--article-rule);
  background: var(--article-surface);
}

.journal-footer-inner {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1.5rem;
  color: var(--article-muted);
  font-size: 0.8125rem;
}

.journal-footer nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 36rem) {
  .journal-masthead,
  .journal-footer-inner,
  .article-content {
    width: min(100% - 2rem, 48rem);
  }

  .article-abstract {
    padding: 1rem;
  }
}
`;
