import { SourceFormat } from '@prisma/client';
import { renderPublishedHtml } from './content';

const WORDS_PER_MINUTE = 220;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function extractPlainText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function countWords(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return value.split(/\s+/).filter(Boolean).length;
}

export function estimateReadMinutes(wordCount: number) {
  if (wordCount <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

export function computeReadMetricsFromHtml(renderedHtml: string) {
  const plainText = extractPlainText(renderedHtml);
  const wordCount = countWords(plainText);

  return {
    wordCount,
    estimatedReadMinutes: estimateReadMinutes(wordCount),
  };
}

export function computeReadMetrics(format: SourceFormat, content: string) {
  return computeReadMetricsFromHtml(renderPublishedHtml(format, content));
}
