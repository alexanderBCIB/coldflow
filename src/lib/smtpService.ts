import { createTransport } from 'nodemailer';
import {
  getEmailAccountById,
  updateEmailAccountStatus,
  incrementEmailAccountQuota,
} from '@coldflow/db';
import { decryptToken } from './tokenEncryption';

/**
 * SMTP Email Service
 *
 * Handles sending emails via SMTP (Outlook, Yahoo, custom providers)
 * with tracking pixel/link injection.
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
 * Inject tracking pixel and click tracking into HTML body
 */
function injectTracking(htmlBody: string, trackingId: string): string {
  if (!htmlBody || !trackingId) return htmlBody;

  const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';

  // Inject tracking pixel
  const trackingPixel = `<img src="${baseUrl}/api/email-tracking/pixel/${trackingId}.png" width="1" height="1" alt="" style="display:none;" />`;
  if (htmlBody.includes('</body>')) {
    htmlBody = htmlBody.replace('</body>', `${trackingPixel}</body>`);
  } else {
    htmlBody += trackingPixel;
  }

  // Wrap links with click tracking redirects
  const linkRegex = /<a\s+([^>]*\s+)?href=["']([^"']+)["']/gi;
  htmlBody = htmlBody.replace(linkRegex, (match, attrs, url) => {
    if (url.includes('/api/email-tracking/click/')) {
      return match;
    }
    const trackingUrl = `${baseUrl}/api/email-tracking/click/${trackingId}?url=${encodeURIComponent(url)}`;
    return `<a ${attrs || ''}href="${trackingUrl}"`;
  });

  return htmlBody;
}

/**
 * Send an email via SMTP
 *
 * @param emailAccountId - The email account to send from
 * @param options - Email content and recipient info
 * @returns Result with success status and message ID
 */
export async function sendEmailSmtp(
  emailAccountId: string,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  try {
    // Fetch email account from database
    const account = await getEmailAccountById(emailAccountId);

    if (!account) {
      return { success: false, error: 'Email account not found' };
    }

    if (account.status !== 'connected') {
      return { success: false, error: `Email account is ${account.status}. Please reconnect.` };
    }

    if (!account.smtpHost || !account.smtpPort) {
      return { success: false, error: 'SMTP host and port are not configured.' };
    }

    if (!account.encryptedSmtpPassword) {
      return { success: false, error: 'SMTP password is not configured.' };
    }

    // Decrypt the SMTP password
    const smtpPassword = decryptToken(account.encryptedSmtpPassword);

    // Create SMTP transport
    const transporter = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure ?? account.smtpPort === 465,
      auth: {
        user: account.smtpUsername || account.email,
        pass: smtpPassword,
      },
      // Timeout settings
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    // Prepare HTML with tracking
    const htmlBody = options.bodyHtml
      ? injectTracking(options.bodyHtml, options.trackingId)
      : undefined;

    // Build from address
    const from = options.fromName
      ? `"${options.fromName}" <${account.email}>`
      : account.email;

    // Build to address
    const to = options.toName
      ? `"${options.toName}" <${options.to}>`
      : options.to;

    // Send email
    const info = await transporter.sendMail({
      from,
      to,
      subject: options.subject,
      text: options.bodyText,
      html: htmlBody,
    });

    // Update quota usage
    await incrementEmailAccountQuota(emailAccountId);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('SMTP send error:', error);

    // Check for common SMTP errors
    if (error instanceof Error) {
      if (error.message.includes('EAUTH') || error.message.includes('authentication')) {
        return {
          success: false,
          error: 'SMTP authentication failed. Please check your credentials.',
        };
      }

      if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        return {
          success: false,
          error: 'Could not connect to SMTP server. Please check host and port.',
        };
      }

      if (error.message.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'SMTP connection timed out. Please check your server settings.',
        };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error sending email via SMTP',
    };
  }
}

/**
 * Verify SMTP connection settings
 */
export async function verifySmtpConnection(
  host: string,
  port: number,
  username: string,
  password: string,
  secure?: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransport({
      host,
      port,
      secure: secure ?? port === 465,
      auth: { user: username, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    await transporter.verify();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection verification failed',
    };
  }
}
