import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type PurchaseSuccessTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
  bookTitle: string;
  chapterTitles: string[];
  assetLinks?: Array<{
    label: string;
    url: string;
  }>;
  failedChapterTitles?: string[];
  amountFormatted: string;
  reference: string;
};

export function buildPurchaseSuccessEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
  bookTitle,
  chapterTitles,
  assetLinks,
  failedChapterTitles,
  amountFormatted,
  reference,
}: PurchaseSuccessTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'Reader');
  const safeBookTitle = escapeHtml(bookTitle);
  const safeAmount = escapeHtml(amountFormatted);
  const safeReference = escapeHtml(reference);
  const chapterItems = chapterTitles
    .map((title) => `<li style="margin:0 0 6px;">${escapeHtml(title)}</li>`)
    .join('');
  const failedChapters = failedChapterTitles?.length
    ? failedChapterTitles
    : null;
  const failedItems = failedChapters
    ? failedChapters
        .map((title) => `<li style="margin:0 0 6px;">${escapeHtml(title)}</li>`)
        .join('')
    : '';
  const isPartial = Boolean(failedChapters?.length);
  const title = isPartial
    ? 'Purchase partially completed'
    : 'Purchase confirmed';
  const safeAssetLinks = (assetLinks ?? []).filter(
    (item) => Boolean(item?.url?.trim()) && Boolean(item?.label?.trim()),
  );

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your purchase has been confirmed.</p>
    <p style="margin:0 0 8px;"><strong>Book:</strong> ${safeBookTitle}</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 14px;"><strong>Reference:</strong> ${safeReference}</p>
    <p style="margin:0 0 8px;"><strong>Chapters unlocked:</strong></p>
    <ul style="margin:0 0 14px;padding-left:20px;">${chapterItems}</ul>
    ${
      safeAssetLinks.length
        ? `
          <p style="margin:0 0 10px;"><strong>View your chapter asset on Solana:</strong></p>
          <p style="margin:0 0 14px;">
            ${safeAssetLinks
              .map(
                (item) => `
                  <a href="${escapeHtml(item.url)}" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;margin:0 10px 10px 0;">
                    ${escapeHtml(item.label)}
                  </a>
                `,
              )
              .join('')}
          </p>
        `
        : ''
    }
    ${
      isPartial
        ? `
          <div style="margin:0 0 14px;padding:12px 14px;border-radius:14px;background:#fbf9f4;border:1px solid #ece5d7;">
            <p style="margin:0 0 8px;"><strong>Some chapters could not be unlocked.</strong></p>
            <p style="margin:0 0 10px;">Any funds held for the missing chapters were released back to your wallet.</p>
            <p style="margin:0 0 8px;"><strong>Not unlocked:</strong></p>
            <ul style="margin:0;padding-left:20px;">${failedItems}</ul>
          </div>
        `
        : ''
    }
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/library" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">Open your library</a>
    </p>
  `;

  return {
    subject: title,
    text: `Hi ${displayName},\n\nYour purchase for "${bookTitle}" is confirmed.\nReference: ${reference}\nAmount: ${amountFormatted}\nChapters unlocked: ${chapterTitles.join(', ')}${
      isPartial && failedChapters
        ? `\n\nNot unlocked: ${failedChapters.join(', ')}\nAny held funds for the missing chapters were released back to your wallet.`
        : ''
    }${
      safeAssetLinks.length
        ? `\n\nView chapter asset on Solana:\n${safeAssetLinks
            .map((item) => `- ${item.label}: ${item.url}`)
            .join('\n')}`
        : ''
    }`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title,
      body,
    }),
  };
}
