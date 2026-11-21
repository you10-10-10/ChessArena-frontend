import 'server-only';

import { Resend } from 'resend';

export async function sendBetterAuthEmail(
  to: string,
  subject: string,
  message: string,
  url: string,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error(
      'Better Auth email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.',
    );
  }

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to,
    subject,
    text: `${message}\n\n${url}`,
  });

  if (error) {
    throw new Error(`Unable to send Better Auth email: ${error.message}`);
  }
}
