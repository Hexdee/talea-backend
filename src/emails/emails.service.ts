import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  buildDepositReceivedEmailTemplate,
  buildPurchaseFailedEmailTemplate,
  buildPurchaseSuccessEmailTemplate,
  buildWelcomeEmailTemplate,
  buildWithdrawalCompletedEmailTemplate,
  buildWithdrawalRequestedEmailTemplate,
} from './templates';

type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  private readonly enabled: boolean;
  private readonly appName: string;
  private readonly fromEmail: string;
  private readonly replyTo: string | undefined;
  private readonly logoUrl: string | undefined;
  private readonly frontendAppUrl: string;
  private readonly resend: Resend | null;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>('EMAILS_ENABLED', 'false') === 'true';
    this.appName = this.configService.get<string>('APP_NAME', 'Lesenpad');
    this.fromEmail = this.configService.get<string>(
      'RESEND_FROM_EMAIL',
      'Lesenpad <onboarding@resend.dev>',
    );
    this.replyTo = this.configService.get<string>('RESEND_REPLY_TO');
    this.frontendAppUrl = this.configService.get<string>(
      'FRONTEND_APP_URL',
      'http://localhost:3000',
    );
    this.logoUrl = this.resolveEmailLogoUrl();

    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!this.enabled) {
      this.resend = null;
      return;
    }

    if (!apiKey?.trim()) {
      this.logger.warn(
        'Transactional emails are enabled but RESEND_API_KEY is missing. Email delivery is disabled.',
      );
      this.resend = null;
      return;
    }

    this.resend = new Resend(apiKey);
  }

  private deriveInvertedLogoUrl(logoUrl: string): string | undefined {
    const url = logoUrl.trim();
    if (!url) {
      return undefined;
    }

    if (url.includes('lesenpad-inverted-logo.png')) {
      return url;
    }

    if (url.includes('lesenpad-wordmark-inverted.png')) {
      return url;
    }

    if (url.includes('lesenpad-logo-inverted.svg')) {
      return url;
    }

    if (url.includes('lesenpad-logo.png')) {
      return url.replace('lesenpad-logo.png', 'lesenpad-inverted-logo.png');
    }

    if (url.includes('lesenpad-wordmark.png')) {
      return url.replace(
        'lesenpad-wordmark.png',
        'lesenpad-wordmark-inverted.png',
      );
    }

    if (url.includes('lesenpad-logo.svg')) {
      return url.replace('lesenpad-logo.svg', 'lesenpad-logo-inverted.svg');
    }

    return undefined;
  }

  private resolveEmailLogoUrl(): string | undefined {
    const configuredInverted = this.configService.get<string>(
      'EMAIL_BRAND_LOGO_URL_INVERTED',
    );
    if (configuredInverted?.trim()) {
      return configuredInverted;
    }

    const configured = this.configService.get<string>('EMAIL_BRAND_LOGO_URL');
    if (configured?.trim()) {
      return this.deriveInvertedLogoUrl(configured) ?? configured;
    }

    return `${this.frontendAppUrl.replace(/\/$/, '')}/lesenpad-inverted-logo.png`;
  }

  private async send(options: SendEmailOptions) {
    if (!this.enabled) {
      return;
    }

    if (!this.resend) {
      this.logger.warn(
        `Skipping transactional email to ${options.to} because Resend is not configured.`,
      );
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: this.replyTo,
      });

      if (error) {
        this.logger.error(
          `Failed to send transactional email (${options.subject}) to ${options.to}: ${error.message}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Unexpected email delivery error for ${options.to}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  async sendWelcomeEmail(params: { to: string; displayName: string }) {
    const emailTemplate = buildWelcomeEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  async sendPurchaseSuccessEmail(params: {
    to: string;
    displayName: string;
    bookTitle: string;
    chapterTitles: string[];
    failedChapterTitles?: string[];
    amountFormatted: string;
    reference: string;
  }) {
    const emailTemplate = buildPurchaseSuccessEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
      bookTitle: params.bookTitle,
      chapterTitles: params.chapterTitles,
      failedChapterTitles: params.failedChapterTitles,
      amountFormatted: params.amountFormatted,
      reference: params.reference,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  async sendPurchaseFailedEmail(params: {
    to: string;
    displayName: string;
    bookTitle: string;
    chapterTitles: string[];
    amountFormatted: string;
    reference: string;
    failureReason?: string;
  }) {
    const emailTemplate = buildPurchaseFailedEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
      bookTitle: params.bookTitle,
      chapterTitles: params.chapterTitles,
      amountFormatted: params.amountFormatted,
      reference: params.reference,
      failureReason: params.failureReason,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  async sendDepositReceivedEmail(params: {
    to: string;
    displayName: string;
    amountFormatted: string;
    availableBalanceFormatted: string;
    reference?: string | null;
  }) {
    const emailTemplate = buildDepositReceivedEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
      amountFormatted: params.amountFormatted,
      availableBalanceFormatted: params.availableBalanceFormatted,
      reference: params.reference ?? null,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  async sendWithdrawalRequestedEmail(params: {
    to: string;
    displayName: string;
    amountFormatted: string;
    destinationLabel: string;
    requestId: string;
  }) {
    const emailTemplate = buildWithdrawalRequestedEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
      amountFormatted: params.amountFormatted,
      destinationLabel: params.destinationLabel,
      requestId: params.requestId,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }

  async sendWithdrawalCompletedEmail(params: {
    to: string;
    displayName: string;
    amountFormatted: string;
    destinationLabel: string;
    reference: string;
  }) {
    const emailTemplate = buildWithdrawalCompletedEmailTemplate({
      appName: this.appName,
      appUrl: this.frontendAppUrl,
      logoUrl: this.logoUrl,
      displayName: params.displayName,
      amountFormatted: params.amountFormatted,
      destinationLabel: params.destinationLabel,
      reference: params.reference,
    });

    await this.send({
      to: params.to,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });
  }
}
