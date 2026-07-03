// scratch/test_email.js
const { sendEmail } = require('../src/services/notificationService');

async function testSMTP() {
  console.log('--- Testing Brevo Nodemailer SMTP ---');
  
  const recipient = 'Subramanya@aksharaenterprises.info';
  const subject = 'Test Email via Nodemailer SMTP Relay';
  const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px;">
      <h2 style="color: #1f52cc;">SMTP Connection Successful!</h2>
      <p>Hello,</p>
      <p>This is a test email sent from the ATS backend to verify that <strong>Nodemailer</strong> SMTP connection to <strong>smtp-relay.brevo.com:587</strong> is operating correctly.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #666;">Sent at: ${new Date().toLocaleString()}</p>
    </div>
  `;

  try {
    const result = await sendEmail({
      to: recipient,
      subject,
      html,
    });
    console.log('Test result:', result);
  } catch (error) {
    console.error('Test SMTP failed:', error);
  }
}

testSMTP();
