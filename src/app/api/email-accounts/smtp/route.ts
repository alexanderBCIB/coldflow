import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthorizationError } from '@/lib/authorization';
import { createEmailAccount, emailAccountExists } from '@coldflow/db';
import { encryptToken } from '@/lib/tokenEncryption';
import { verifySmtpConnection } from '@/lib/smtpService';
import { nanoid } from 'nanoid';

/**
 * POST /api/email-accounts/smtp
 *
 * Connect an SMTP email account (Outlook, Yahoo, custom providers).
 * Verifies the connection before saving.
 */

interface SmtpAccountRequest {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername?: string;
  smtpPassword: string;
  smtpSecure?: boolean;
  fromName?: string;
  subAgencyId?: string;
  dailyQuota?: number;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const user = await requireAuth();

    // Parse request body
    const body: SmtpAccountRequest = await request.json();

    // Validate required fields
    if (!body.email || !body.smtpHost || !body.smtpPort || !body.smtpPassword) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: email, smtpHost, smtpPort, smtpPassword' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address format' },
        { status: 400 }
      );
    }

    // Validate port
    if (body.smtpPort < 1 || body.smtpPort > 65535) {
      return NextResponse.json(
        { success: false, error: 'Invalid SMTP port number' },
        { status: 400 }
      );
    }

    // Check if this email account is already connected
    const exists = await emailAccountExists(user.id, body.email);
    if (exists) {
      return NextResponse.json(
        { success: false, error: 'This email account is already connected' },
        { status: 409 }
      );
    }

    // Verify SMTP connection
    const smtpUsername = body.smtpUsername || body.email;
    const verification = await verifySmtpConnection(
      body.smtpHost,
      body.smtpPort,
      smtpUsername,
      body.smtpPassword,
      body.smtpSecure
    );

    if (!verification.success) {
      return NextResponse.json(
        {
          success: false,
          error: `SMTP connection failed: ${verification.error}`,
        },
        { status: 422 }
      );
    }

    // Encrypt the SMTP password
    const encryptedSmtpPassword = encryptToken(body.smtpPassword);

    // Calculate next quota reset (midnight UTC)
    const quotaResetAt = new Date();
    quotaResetAt.setUTCHours(24, 0, 0, 0);

    // Create email account record
    await createEmailAccount({
      id: nanoid(),
      userId: user.id,
      subAgencyId: body.subAgencyId || null,
      email: body.email,
      provider: 'smtp',
      encryptedSmtpPassword,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpUsername,
      smtpSecure: body.smtpSecure ?? body.smtpPort === 465,
      status: 'connected',
      dailyQuota: body.dailyQuota || 500,
      quotaUsedToday: 0,
      quotaResetAt,
      lastSyncedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: `SMTP email account ${body.email} connected successfully`,
    });
  } catch (error) {
    console.error('Error connecting SMTP account:', error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to connect SMTP email account' },
      { status: 500 }
    );
  }
}
