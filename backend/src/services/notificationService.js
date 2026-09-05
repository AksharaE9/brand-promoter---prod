// src/services/notificationService.js
const nodemailer = require('nodemailer');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SENDER_EMAIL = process.env.SMTP_SENDER_EMAIL;
const SMTP_SENDER_NAME = process.env.SMTP_SENDER_NAME;

// Initialize Nodemailer SMTP Transporter only if SMTP credentials are provided
let transporter = null;
if (SMTP_HOST && (SMTP_USER || SMTP_PASS)) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT || 587,
      secure: SMTP_PORT === 465, // true for 465, false for other ports
      auth: (SMTP_USER && SMTP_PASS) ? {
        user: SMTP_USER,
        pass: SMTP_PASS,
      } : undefined,
    });
  } catch (tErr) {
    console.warn('[NotificationService:Email] SMTP Transporter initialization failed:', tErr.message);
  }
}

/**
 * Sends a transactional email using Brevo SMTP. Falls back to Brevo HTTP API on failure.
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.html - HTML content
 * @param {string} [params.text] - Plain text content (optional)
 * @param {string} [params.fromName] - Custom sender name (optional)
 */
async function sendEmail({ to, subject, html, text = '', fromName = SMTP_SENDER_NAME }) {
  if (!to) {
    console.error('[NotificationService:Email] Error: Recipient (to) is required');
    return { success: false, error: 'Recipient is required' };
  }

  // 1. Primary: Try Brevo REST HTTP API if BREVO_API_KEY is configured
  if (BREVO_API_KEY) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: fromName, email: SMTP_SENDER_EMAIL || 'no-reply@aksharaenterprises.info' },
          to: [{ email: to }],
          subject: subject,
          htmlContent: html,
        }),
      });

      const body = await response.json();

      if (response.status === 201 || response.status === 200) {
        console.log(`[NotificationService:Email] HTTP API success: ${body.messageId}`);
        return { success: true, messageId: body.messageId, method: 'HTTP_API' };
      } else {
        console.warn(`[NotificationService:Email] HTTP API sending failed, falling back to SMTP. Status: ${response.status}. Error:`, body);
      }
    } catch (httpError) {
      console.warn(`[NotificationService:Email] HTTP API failed. Falling back to SMTP. Details: ${httpError.message}`);
    }
  }

  // 2. Fallback: Try Nodemailer SMTP sending if transporter is configured
  if (transporter) {
    try {
      const mailOptions = {
        from: `"${fromName}" <${SMTP_SENDER_EMAIL || 'no-reply@aksharaenterprises.info'}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Basic HTML tag strip fallback
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[NotificationService:Email] SMTP success: ${info.messageId}`);
      return { success: true, messageId: info.messageId, method: 'SMTP' };
    } catch (smtpError) {
      console.error('[NotificationService:Email] SMTP delivery failed:', smtpError.message);
      return { success: false, error: smtpError.message };
    }
  }

  // Neither provider configured or usable
  return { 
    success: false, 
    error: 'Email delivery unconfigured: BREVO_API_KEY and SMTP credentials missing or unavailable' 
  };
}

/**
 * Sends a transactional SMS using Brevo REST API.
 * @param {object} params
 * @param {string} params.recipient - Recipient phone number (preferably E.164, e.g., +91XXXXXXXXXX)
 * @param {string} params.content - SMS content
 */
async function sendSMS({ recipient, content }) {
  if (!recipient || !content) {
    console.error('[NotificationService:SMS] Error: Recipient and content are required');
    return { success: false, error: 'Recipient and content are required' };
  }

  // Format recipient: ensure it starts with '+'
  let formattedRecipient = recipient.trim();
  if (!formattedRecipient.startsWith('+')) {
    // If it's a 10 digit number, default to +91 country prefix (common context for this repository)
    if (formattedRecipient.length === 10 && /^\d+$/.test(formattedRecipient)) {
      formattedRecipient = `+91${formattedRecipient}`;
    } else {
      formattedRecipient = `+${formattedRecipient}`;
    }
  }

  if (!BREVO_API_KEY) {
    return { success: false, error: 'SMS delivery unconfigured: BREVO_API_KEY is missing' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'ATSPortal',
        recipient: formattedRecipient,
        content: content,
      }),
    });

    const body = await response.json();

    if (response.status === 201 || response.status === 200) {
      console.log(`[NotificationService:SMS] SMS success to ${formattedRecipient}:`, body);
      return { success: true, body };
    } else if (response.status === 402 || (body && body.code === 'not_enough_credits')) {
      console.warn(`[NotificationService:SMS] Warning: Brevo SMS sending failed due to depleted credits: ${body.message || 'not_enough_credits'}`);
      return { success: false, error: 'not_enough_credits', fallbackNeeded: true };
    } else {
      console.error(`[NotificationService:SMS] Error response ${response.status} from Brevo SMS API:`, body);
      return { success: false, error: body };
    }
  } catch (error) {
    console.error(`[NotificationService:SMS] Request failed:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendEmail,
  sendSMS,
};
