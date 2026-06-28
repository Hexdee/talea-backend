import { dirname, join } from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { SourceFormat } from '@prisma/client';

const markedBundlePath = join(
  dirname(require.resolve('marked/package.json')),
  'lib/marked.umd.js',
);
// marked is ESM-only at the package entrypoint; this loads the UMD bundle for Jest/CJS compatibility.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { marked } = require(markedBundlePath) as typeof import('marked');

marked.setOptions({
  gfm: true,
  breaks: true,
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPlainText(content: string) {
  return escapeHtml(content)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function renderMarkdown(markdown: string) {
  return marked.parse(markdown) as string;
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
