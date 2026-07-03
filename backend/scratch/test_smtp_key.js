require('dotenv').config();
const nodemailer = require('nodemailer');

async function testApiKeyAsSmtpPass() {
  console.log('--- Testing SMTP using API Key as Password ---');
  
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.BREVO_API_KEY,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: '"ATS Portal Test" <b0ad0c001@smtp-brevo.com>',
      to: 'b0ad0c001@smtp-brevo.com',
      subject: 'Test SMTP via API Key',
      text: 'Hello, this is a test SMTP email using the API key as the password.',
    });
    console.log('Success! Message ID:', info.messageId);
  } catch (error) {
    console.error('SMTP failed with API Key as password:', error.message);
  }
}

testApiKeyAsSmtpPass();
