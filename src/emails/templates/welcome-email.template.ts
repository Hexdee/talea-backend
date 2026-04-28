import { renderBrandedLayout } from './base-layout.template';
import { EmailTemplateResult } from './template.types';
import { escapeHtml } from './template.utils';

type WelcomeTemplateParams = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  displayName: string;
};

export function buildWelcomeEmailTemplate({
  appName,
  appUrl,
  logoUrl,
  displayName,
}: WelcomeTemplateParams): EmailTemplateResult {
  const safeName = escapeHtml(displayName || 'there');
  const loginUrl = `${appUrl}/auth/login`;

  const body = `
    <p style="margin:0 0 10px;">Hi ${safeName}, your account is ready.</p>
    <p style="margin:0 0 14px;">You can start reading and publishing right away.</p>
    <p style="margin:0;">
      <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#10253f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">Open ${escapeHtml(appName)}</a>
    </p>
  `;

  return {
    subject: `Welcome to ${appName}`,
    text: `Hi ${displayName},\n\nWelcome to ${appName}. Your account is ready.\n\nLog in: ${loginUrl}`,
    html: renderBrandedLayout({
      appName,
      appUrl,
      logoUrl,
      title: `Welcome to ${appName}`,
      body,
    }),
  };
}
