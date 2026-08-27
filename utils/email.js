// Sends transactional emails via Resend's HTTPS API instead of raw SMTP.
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const DEFAULT_FROM = process.env.EMAIL_FROM || 'QFS Wallet <onboarding@resend.dev>';

const sendEmail = async (to, subject, html) => {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set in environment variables');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to,
      subject,
      html,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('📧 Resend error:', data);
    throw new Error(data.message || 'Failed to send email via Resend');
  }

  console.log('✅ Email sent:', data.id);
  return data;
};

module.exports = { sendEmail };