require('dotenv').config();
const dns = require('dns');

async function testHttpEmail() {
  console.log('--- Testing Brevo Transactional Email API ---');
  const apiKey = process.env.BREVO_API_KEY;
  
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'ATS Admin Test', email: 'b0ad0c001@smtp-brevo.com' },
        to: [{ email: 'b0ad0c001@smtp-brevo.com', name: 'Brevo Test' }],
        subject: 'Test Email via Brevo API',
        htmlContent: '<p>This is a test email sent via Brevo HTTP API to verify the API key is active and correct.</p>'
      })
    });
    
    const result = await response.json();
    console.log('HTTP Email Response status:', response.status);
    console.log('HTTP Email Response body:', result);
  } catch (error) {
    console.error('HTTP Email error:', error);
  }
}

async function testHttpSms() {
  console.log('\n--- Testing Brevo Transactional SMS API ---');
  const apiKey = process.env.BREVO_API_KEY;
  
  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: 'ATSPortal',
        recipient: '+919999999999', // dummy number to test response
        content: 'This is a test SMS from ATS Portal.'
      })
    });
    
    const result = await response.json();
    console.log('HTTP SMS Response status:', response.status);
    console.log('HTTP SMS Response body:', result);
  } catch (error) {
    console.error('HTTP SMS error:', error);
  }
}

async function run() {
  await testHttpEmail();
  await testHttpSms();
}

run();
