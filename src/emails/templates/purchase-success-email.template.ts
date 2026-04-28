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

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your purchase has been confirmed.</p>
    <p style="margin:0 0 8px;"><strong>Book:</strong> ${safeBookTitle}</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 14px;"><strong>Reference:</strong> ${safeReference}</p>
    <p style="margin:0 0 8px;"><strong>Chapters unlocked:</strong></p>
    <ul style="margin:0 0 14px;padding-left:20px;">${chapterItems}</ul>
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/library" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">Open your library</a>
    </p>
  `;

  return {
    subject: 'Purchase confirmed',
    text: `Hi ${displayName},\n\nYour purchase for "${bookTitle}" is confirmed.\nReference: ${reference}\nAmount: ${amountFormatted}\nChapters: ${chapterTitles.join(', ')}`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: 'Purchase confirmed',
      body,
    }),
  };
}
