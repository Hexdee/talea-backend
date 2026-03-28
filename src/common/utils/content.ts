import sanitizeHtml from 'sanitize-html';
import { SourceFormat } from '@prisma/client';

function renderMarkdown(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith('# ')) {
        return `<h1>${block.slice(2)}</h1>`;
      }

      return `<p>${block.replace(/\n/g, '<br />')}</p>`;
    })
    .join('');
}

export function renderPublishedHtml(format: SourceFormat, content: string) {
  const unsafeHtml =
    format === SourceFormat.PLAIN
      ? `<p>${content.replace(/\n/g, '<br />')}</p>`
      : format === SourceFormat.MARKDOWN
        ? renderMarkdown(content)
        : content;

  return sanitizeHtml(unsafeHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2']),
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
  });
}
