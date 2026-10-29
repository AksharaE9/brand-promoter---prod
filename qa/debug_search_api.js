// qa/debug_search_api.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const { signAccessToken } = require('../backend/src/utils/jwt');

async function main() {
  const token = signAccessToken({
    userId: 'cmrwbuuum0000ije02hmmy7s7',
    email: 'superadmin@gmail.com',
    role: 'SUPER_ADMIN',
    organizationId: 'defaultOrg'
  });

  const res = await fetch('https://brandpromoter-backend.onrender.com/api/candidates?search=Megha', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json();
  console.log('Search response keys:', Object.keys(json));
  console.log('Search response:', JSON.stringify(json, null, 2).slice(0, 1000));
}

main().catch(console.error);
