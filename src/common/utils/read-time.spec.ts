import { SourceFormat } from '@prisma/client';
import {
  computeReadMetrics,
  computeReadMetricsFromHtml,
  estimateReadMinutes,
  extractPlainText,
} from './read-time';

describe('read-time utils', () => {
  it('extracts plain text from html', () => {
    expect(
      extractPlainText('<h1>Hello</h1><p>World &amp; friends<br />again</p>'),
    ).toBe('Hello World & friends again');
  });

  it('computes metrics for plain text with a minimum of 1 minute', () => {
    expect(computeReadMetrics(SourceFormat.PLAIN, 'A short chapter.')).toEqual({
      wordCount: 3,
      estimatedReadMinutes: 1,
    });
  });

  it('computes metrics for markdown content', () => {
    const metrics = computeReadMetrics(
      SourceFormat.MARKDOWN,
      '# Heading\n\nThis chapter has enough words to count correctly.',
    );

    expect(metrics.wordCount).toBeGreaterThan(5);
    expect(metrics.estimatedReadMinutes).toBe(1);
  });

  it('rounds long content up to the next minute', () => {
    expect(estimateReadMinutes(221)).toBe(2);
  });

  it('computes metrics from rendered html', () => {
    expect(
      computeReadMetricsFromHtml('<p>One two three four five six</p>'),
    ).toEqual({
      wordCount: 6,
      estimatedReadMinutes: 1,
    });
  });
});
