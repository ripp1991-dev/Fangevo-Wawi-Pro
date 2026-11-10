import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * E-Mail-Versand. Transporte:
 * - smtp:   echter Versand (Produktion, lokal über Mailpit)
 * - log:    nur Log-Ausgabe (Entwicklung ohne SMTP)
 * - memory: Ablage im Speicher (automatisierte Tests)
 */
@Injectable()
export class MailService {
  readonly sent: MailMessage[] = [];
  private readonly transporter?: Transporter;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    if (config.mailTransport === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
      });
    }
  }

  link(path: string, token: string): string {
    return `${this.config.WEB_ORIGIN}${path}?token=${encodeURIComponent(token)}`;
  }

  async send(msg: MailMessage): Promise<void> {
    switch (this.config.mailTransport) {
      case 'memory':
        this.sent.push(msg);
        return;
      case 'log':
        this.logger.log(
          `E-Mail an ${msg.to}: ${msg.subject}\n${msg.text}${msg.attachments?.length ? `\nAnhänge: ${msg.attachments.map((a) => a.filename).join(', ')}` : ''}`,
          'MailService',
        );
        return;
      case 'smtp':
        await this.transporter!.sendMail({ from: this.config.SMTP_FROM, ...msg });
    }
  }
}
