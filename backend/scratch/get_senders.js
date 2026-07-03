require('dotenv').config();
async function getSenders() {
  const apiKey = process.env.BREVO_API_KEY;
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey
      }
    });
    const result = await response.json();
    console.log('Senders Response Status:', response.status);
    console.log('Verified Senders List:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error fetching senders:', error);
  }
}

getSenders();
