import { BrandLayoutOptions } from './template.types';
import { escapeHtml } from './template.utils';

function renderLogo(appName: string, appUrl: string, logoUrl?: string) {
  const safeName = escapeHtml(appName);
  const safeUrl = escapeHtml(appUrl);

  if (logoUrl?.trim()) {
    return `
      <a href="${safeUrl}" style="text-decoration:none;display:inline-flex;align-items:center;gap:10px;">
        <img src="${escapeHtml(logoUrl)}" alt="${safeName} logo" width="36" height="36" style="border-radius:10px;display:block;" />
        <span style="font-size:14px;letter-spacing:0.18em;color:#f7f3ea;text-transform:uppercase;font-weight:700;">${safeName}</span>
      </a>
    `;
  }

  return `
    <a href="${safeUrl}" style="text-decoration:none;display:inline-flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:10px;background:#f8c56f;color:#0f2745;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;">L</div>
      <span style="font-size:14px;letter-spacing:0.18em;color:#f7f3ea;text-transform:uppercase;font-weight:700;">${safeName}</span>
    </a>
  `;
}

export function renderBrandedLayout({
  appName,
  appUrl,
  logoUrl,
  title,
  intro,
  body,
}: BrandLayoutOptions) {
  const currentYear = new Date().getFullYear();
  const safeTitle = escapeHtml(title);
  const safeIntro = intro ? escapeHtml(intro) : null;

  return `
    <div style="background:#f5f1e9;margin:0;padding:24px 12px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#10253f;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4ddd0;border-radius:18px;overflow:hidden;">
        <div style="background:#10253f;padding:20px 24px;">
          ${renderLogo(appName, appUrl, logoUrl)}
        </div>
        <div style="padding:26px 24px;">
          <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;color:#10253f;font-family:Georgia,'Times New Roman',serif;">${safeTitle}</h1>
          ${
            safeIntro
              ? `<p style="margin:0 0 18px;color:#3f5f84;font-size:16px;line-height:1.6;">${safeIntro}</p>`
              : ''
          }
          <div style="font-size:15px;line-height:1.65;color:#223a58;">${body}</div>
        </div>
        <div style="border-top:1px solid #ece5d7;padding:16px 24px;background:#fbf9f4;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#677b95;">
            ${escapeHtml(appName)} · Built for serialized reading and publishing.
          </p>
          <p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:#7c8ea6;">
            © ${currentYear} ${escapeHtml(appName)}. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `;
}
