import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type DepositReceivedTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
  amountFormatted: string;
  availableBalanceFormatted: string;
  reference?: string | null;
};

export function buildDepositReceivedEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
  amountFormatted,
  availableBalanceFormatted,
  reference,
}: DepositReceivedTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'Reader');
  const safeAmount = escapeHtml(amountFormatted);
  const safeBalance = escapeHtml(availableBalanceFormatted);
  const safeReference = reference ? escapeHtml(reference) : null;

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your deposit has been received.</p>
    <p style="margin:0 0 8px;"><strong>Amount:</strong> ${safeAmount}</p>
    <p style="margin:0 0 14px;"><strong>Available balance:</strong> ${safeBalance}</p>
    ${safeReference ? `<p style="margin:0 0 14px;"><strong>Reference:</strong> ${safeReference}</p>` : ''}
    <p style="margin:0;">
      <a href="${escapeHtml(appUrl)}/wallet" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">Open wallet</a>
    </p>
  `;

  return {
    subject: 'Deposit received',
    text: `Hi ${displayName},\n\nYour deposit has been received.\nAmount: ${amountFormatted}\nAvailable balance: ${availableBalanceFormatted}${reference ? `\nReference: ${reference}` : ''}`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: 'Deposit received',
      body,
    }),
  };
}
