import { getEmailAccountById } from '@coldflow/db';
import { sendEmail as sendEmailGmail, hasAvailableQuota as hasAvailableQuotaGmail } from './gmailService';
import { sendEmailSmtp } from './smtpService';

/**
 * Unified Email Service
 *
 * Routes email sending to the appropriate provider (Gmail API or SMTP)
 * based on the email account's configured provider.
 */

interface SendEmailOptions {
  to: string;
  toName?: string;
  subject: string;
  bodyHtml?: string;
  bodyText: string;
  trackingId: string;
  fromName?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email using the appropriate provider for the given email account
 *
 * @param emailAccountId - The email account to send from
 * @param options - Email content and recipient info
 * @returns Result with success status and message ID
 */
export async function sendEmail(
  emailAccountId: string,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  // Fetch the account to determine provider
  const account = await getEmailAccountById(emailAccountId);

  if (!account) {
    return { success: false, error: 'Email account not found' };
  }

  switch (account.provider) {
    case 'gmail':
      return sendEmailGmail(emailAccountId, options);

    case 'smtp':
    case 'outlook':
    case 'imap':
      // All non-Gmail providers use SMTP
      return sendEmailSmtp(emailAccountId, options);

    default:
      return { success: false, error: `Unsupported email provider: ${account.provider}` };
  }
}

/**
 * Check if an email account has available quota (works for all providers)
 */
export async function hasAvailableQuota(emailAccountId: string): Promise<boolean> {
  return hasAvailableQuotaGmail(emailAccountId);
}
