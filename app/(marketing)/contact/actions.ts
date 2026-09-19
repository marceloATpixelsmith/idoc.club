'use server';

import { z } from 'zod';
import { validatedAction } from '@/lib/auth/middleware';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';

// The address already published on this same page as the secretariat's own inbox -- submissions
// go to the same place a visitor would otherwise have emailed directly.
const CONTACT_RECIPIENT = 'accounts@idoc.club';

const contactSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  message: z.string().trim().min(1, 'Enter a message.').max(5000),
  name: z.string().trim().min(1, 'Enter your name.').max(200),
  subject: z.string().trim().min(1, 'Enter a subject.').max(200),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

export const submitContactForm = validatedAction(contactSchema, async ({ email, message, name, subject, turnstileToken }) => {
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'contact'))) {
    return { error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('contact_form', email, origin))) {
    return { error: 'Too many attempts. Please try again in a few minutes.' };
  }

  const html = renderTransactionalEmail({
    heading: 'New contact form message',
    bodyHtml: `<p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
  });

  try {
    await sendTransactionalEmail({ html, subject: `Contact form: ${subject}`, to: CONTACT_RECIPIENT });
  } catch {
    return { error: 'There was a problem sending your message. Please try again.' };
  }

  return { success: 'Thanks for reaching out -- IDOC will respond as soon as possible.' };
});
