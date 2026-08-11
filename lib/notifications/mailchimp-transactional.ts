import 'server-only';

const FROM_EMAIL = 'accounts@idoc.club';

export interface TransactionalEmail {
  html: string;
  subject: string;
  to: string;
}

export async function sendTransactionalEmail(message: TransactionalEmail) {
  const apiKey = process.env.MAILCHIMP_TRANSACTIONAL_API_KEY;
  if (!apiKey) throw new Error('Mailchimp Transactional is not configured.');
  const response = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
    body: JSON.stringify({ key: apiKey, message: { from_email: FROM_EMAIL, html: message.html, subject: message.subject, to: [{ email: message.to, type: 'to' }] } }),
    headers: { 'content-type': 'application/json' }, method: 'POST',
  });
  if (!response.ok) throw new Error('Mailchimp Transactional rejected the message.');
}
