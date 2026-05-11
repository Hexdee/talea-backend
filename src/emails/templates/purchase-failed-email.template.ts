import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type PurchaseFailedTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
  bookTitle: string;
  chapterTitles: string[];
  amountFormatted: string;
  reference: string;
  failureReason?: string;
};

export function buildPurchaseFailedEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
  bookTitle,
  chapterTitles,
  amountFormatted,
  reference,
  failureReason,
}: PurchaseFailedTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'Reader');
  const safeBookTitle = escapeHtml(bookTitle);
  const safeAmount = escapeHtml(amountFormatted);
  const safeReference = escapeHtml(reference);
  const safeReason = failureReason?.trim() ? escapeHtml(failureReason) : null;
  const chapterItems = chapterTitles
    .map((title) => `<li style="margin:0 0 6px;">${escapeHtml(title)}</li>`)
    .join('');

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, we couldn't complete your purchase.</p>
    <p style="margin:0 0 8px;"><strong>Book:</strong> ${safeBookTitle}</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 14px;"><strong>Reference:</strong> ${safeReference}</p>
    ${
      safeReason
        ? `<p style="margin:0 0 14px;"><strong>Reason:</strong> ${safeReason}</p>`
        : ''
    }
    <p style="margin:0 0 8px;"><strong>Chapters attempted:</strong></p>
    <ul style="margin:0 0 14px;padding-left:20px;">${chapterItems}</ul>
    <div style="margin:0 0 14px;padding:12px 14px;border-radius:14px;background:#fbf9f4;border:1px solid #ece5d7;">
      <p style="margin:0;">Any funds held for this purchase were released back to your wallet.</p>
    </div>
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/profile?tab=wallet" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">View wallet</a>
    </p>
  `;

  const reasonLine = safeReason ? `Reason: ${failureReason}\n` : '';

  return {
    subject: 'Purchase failed',
    text: `Hi ${displayName},\n\nWe couldn't complete your purchase for "${bookTitle}".\n${reasonLine}Reference: ${reference}\nAmount: ${amountFormatted}\nChapters attempted: ${chapterTitles.join(
      ', ',
    )}\n\nAny funds held for this purchase were released back to your wallet.`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: 'Purchase failed',
      body,
    }),
  };
}
