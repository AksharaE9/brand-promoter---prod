// src/services/notificationService.js
'use strict';

/**
 * Transactional email service stub.
 * External email sending is bypassed to ensure maximum stability, zero external socket churn,
 * and zero reliance on external email providers. In-app notifications and real-time SSE
 * deliver alerts directly to users.
 */
async function sendEmail({ to, subject, html, text = '', fromName = 'ATS Portal' }) {
  if (!to) {
    return { success: false, error: 'Recipient is required' };
  }
  // Safe zero-overhead bypass
  return { 
    success: true, 
    messageId: `in_app_${Date.now()}`, 
    method: 'IN_APP_ONLY', 
    bypassed: true 
  };
}

/**
 * Transactional SMS service stub.
 * External SMS sending is bypassed.
 */
async function sendSMS({ recipient, content }) {
  if (!recipient || !content) {
    return { success: false, error: 'Recipient and content are required' };
  }
  return { 
    success: true, 
    method: 'IN_APP_ONLY', 
    bypassed: true 
  };
}

module.exports = {
  sendEmail,
  sendSMS,
};
