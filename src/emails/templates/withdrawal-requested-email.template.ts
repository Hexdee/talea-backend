import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type WithdrawalRequestedTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
  amountFormatted: string;
  destinationLabel: string;
  requestId: string;
};

export function buildWithdrawalRequestedEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
  amountFormatted,
  destinationLabel,
  requestId,
}: WithdrawalRequestedTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'Author');
  const safeAmount = escapeHtml(amountFormatted);
  const safeDestination = escapeHtml(destinationLabel);
  const safeRequestId = escapeHtml(requestId);

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your withdrawal request is now recorded.</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 8px;"><strong>Destination:</strong> ${safeDestination}</p>
    <p style="margin:0 0 14px;"><strong>Request ID:</strong> ${safeRequestId}</p>
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/profile" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">View wallet activity</a>
    </p>
  `;

  return {
    subject: 'Withdrawal request received',
    text: `Hi ${displayName},\n\nWe received your withdrawal request.\nAmount: ${amountFormatted}\nDestination: ${destinationLabel}\nRequest ID: ${requestId}`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: 'Withdrawal request received',
      body,
    }),
  };
}
