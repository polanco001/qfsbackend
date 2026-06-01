const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Pre‑warm connection
transporter.verify((err) => {
  if (err) console.error('📧 Email server error:', err);
  else console.log('📧 Email server ready');
});

const sendEmail = async (to, subject, html) => {
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,   // optional FROM override
    to,
    subject,
    html
  });
  console.log('✅ Email sent:', info.messageId);
  return info;
};

module.exports = { sendEmail };
