import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type WithdrawalCompletedTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
  amountFormatted: string;
  destinationLabel: string;
  reference: string;
};

export function buildWithdrawalCompletedEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
  amountFormatted,
  destinationLabel,
  reference,
}: WithdrawalCompletedTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'Author');
  const safeAmount = escapeHtml(amountFormatted);
  const safeDestination = escapeHtml(destinationLabel);
  const safeReference = escapeHtml(reference);

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your withdrawal has been completed.</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 8px;"><strong>Destination:</strong> ${safeDestination}</p>
    <p style="margin:0 0 14px;"><strong>Reference:</strong> ${safeReference}</p>
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/profile" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">View transaction history</a>
    </p>
  `;

  return {
    subject: 'Withdrawal completed',
    text: `Hi ${displayName},\n\nYour withdrawal is complete.\nAmount: ${amountFormatted}\nDestination: ${destinationLabel}\nReference: ${reference}`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: 'Withdrawal completed',
      body,
    }),
  };
}
