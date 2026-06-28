import sanitizeHtml from 'sanitize-html';
import { SourceFormat } from '@prisma/client';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkup(input: string) {
  const escaped = escapeHtml(input);
  return escaped
    .replace(
      /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/g,
      (_match, label: string, href: string) =>
        `<a href="${escapeHtml(href)}">${label}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderPlainText(content: string) {
  return escapeHtml(content)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function renderMarkdown(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();

      if (!trimmed) {
        return '';
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = renderInlineMarkup(headingMatch[2].trim());
        return `<h${level}>${content}</h${level}>`;
      }

      return `<p>${renderInlineMarkup(trimmed).replace(/\n/g, '<br />')}</p>`;
    })
    .join('');
}

export function renderPublishedHtml(format: SourceFormat, content: string) {
  const unsafeHtml =
    format === SourceFormat.PLAIN
      ? renderPlainText(content)
      : format === SourceFormat.MARKDOWN
        ? renderMarkdown(content)
        : content;

  return sanitizeHtml(unsafeHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'h1',
      'h2',
      'h3',
      'iframe',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel', 'name'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
      iframe: [
        'src',
        'width',
        'height',
        'allow',
        'allowfullscreen',
        'frameborder',
        'scrolling',
        'sandbox',
        'referrerpolicy',
      ],
      p: ['class'],
      span: ['class'],
      h1: ['class'],
      h2: ['class'],
      h3: ['class'],
      blockquote: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
      iframe: ['http', 'https'],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noreferrer noopener',
          target: '_blank',
        },
      }),
    },
  });
}
