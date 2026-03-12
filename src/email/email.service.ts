import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { MailConfig, getMailConfigName } from '../common/config/mail.config';
import { AppConfig, getAppConfigName } from '../common/config/app.config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly mailgunClient: ReturnType<Mailgun['client']> | null;
  private readonly mailConfig: MailConfig;
  private readonly adminUrl: string;
  private readonly templates = new Map<string, Handlebars.TemplateDelegate>();

  constructor(private readonly configService: ConfigService) {
    this.mailConfig = this.configService.get<MailConfig>(getMailConfigName())!;
    this.adminUrl =
      this.configService.get<AppConfig>(getAppConfigName())!.adminUrl;

    if (this.mailConfig.enabled) {
      const mailgun = new Mailgun(FormData);
      this.mailgunClient = mailgun.client({
        username: 'api',
        key: this.mailConfig.apiKey,
      });
    } else {
      this.mailgunClient = null;
      this.logger.warn('Mailgun not configured — emails will be logged only');
    }

    this.registerPartials();
  }

  private registerPartials() {
    const partialsDir = path.join(__dirname, 'templates', 'partials');
    if (!fs.existsSync(partialsDir)) return;

    const files = fs.readdirSync(partialsDir).filter((f) => f.endsWith('.hbs'));
    for (const file of files) {
      const name = path.basename(file, '.hbs');
      const content = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
      Handlebars.registerPartial(name, content);
    }
  }

  private getTemplate(templateName: string): Handlebars.TemplateDelegate {
    if (this.templates.has(templateName)) {
      return this.templates.get(templateName)!;
    }

    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.hbs`,
    );
    const source = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    this.templates.set(templateName, compiled);
    return compiled;
  }

  async sendEmail(
    to: string,
    subject: string,
    templateName: string,
    context: Record<string, any>,
  ): Promise<void> {
    const template = this.getTemplate(templateName);
    const html = template(context);

    if (!this.mailgunClient) {
      this.logger.log(`[DEV] Email to ${to} | Subject: ${subject}`);
      this.logger.debug(`[DEV] HTML:\n${html}`);
      return;
    }

    await this.mailgunClient.messages.create(this.mailConfig.domain, {
      from: this.mailConfig.from,
      to: [to],
      subject,
      html,
    });

    this.logger.log(`Email sent to ${to} | Subject: ${subject}`);
  }

  async sendPasswordResetEmail(
    to: string,
    firstName: string,
    resetToken: string,
  ): Promise<void> {
    const resetUrl = `${this.adminUrl}/reset-password?token=${resetToken}`;

    await this.sendEmail(to, 'Reset Your Password', 'password-reset', {
      firstName,
      resetUrl,
    });
  }

  async sendSubscriptionReminderEmail(
    to: string,
    firstName: string,
    planName: string,
    amount: number,
    daysUntil: number,
    paymentUrl: string,
  ): Promise<void> {
    await this.sendEmail(
      to,
      `Your ${planName} subscription renews soon`,
      'subscription-reminder',
      {
        firstName,
        planName,
        amount,
        daysUntil,
        isDueToday: daysUntil === 0,
        isSingleDay: daysUntil === 1,
        paymentUrl,
      },
    );
  }

  async sendSubscriptionExpiredEmail(
    to: string,
    firstName: string,
    planName: string,
    paymentUrl: string,
  ): Promise<void> {
    await this.sendEmail(
      to,
      `Your ${planName} subscription has expired`,
      'subscription-expired',
      {
        firstName,
        planName,
        paymentUrl,
      },
    );
  }

  async sendWelcomeEmail(
    to: string,
    firstName: string,
    tempPassword: string,
  ): Promise<void> {
    await this.sendEmail(to, 'Welcome — Your Account is Ready', 'welcome', {
      firstName,
      email: to,
      tempPassword,
      loginUrl: this.adminUrl,
    });
  }

  async sendCardPaymentFailedEmail(
    to: string,
    firstName: string,
    planName: string,
    amount: number,
    paymentUrl: string,
  ): Promise<void> {
    await this.sendEmail(
      to,
      'Payment failed - action required',
      'card-payment-failed',
      {
        firstName,
        planName,
        amount,
        paymentUrl,
      },
    );
  }
}
