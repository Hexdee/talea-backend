export type EmailTemplateResult = {
  subject: string;
  html: string;
  text: string;
};

export type BrandLayoutOptions = {
  appName: string;
  appUrl: string;
  logoUrl?: string;
  title: string;
  intro?: string;
  body: string;
};
