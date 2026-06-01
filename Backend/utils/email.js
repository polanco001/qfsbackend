const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 465,
  secure: true,   // ✅ true for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (to, subject, html) => {
  await transporter.sendMail({ 
    from: process.env.EMAIL_USER, 
    to, 
    subject, 
    html 
  });
};

module.exports = { sendEmail };
