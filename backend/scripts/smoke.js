const http = require('http');

const PORT = process.env.PORT || 4000;
const URL = `http://localhost:${PORT}/api/health`;

console.log(`🚀 [SMOKE TEST] Verifying backend health at ${URL}...`);

const checkHealth = () => {
  http.get(URL, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.success) {
          console.log('✅ [SMOKE TEST] Backend is healthy!');
          process.exit(0);
        } else {
          console.error('❌ [SMOKE TEST] Backend returned failure status.');
          process.exit(1);
        }
      } catch (err) {
        console.error('❌ [SMOKE TEST] Failed to parse health response.');
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('❌ [SMOKE TEST] Connection failed:', err.message);
    process.exit(1);
  });
};

// Wait a bit for the server to potentially start if run immediately
setTimeout(checkHealth, 2000);
