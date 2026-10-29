// qa/check_first_page_prod.js
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

  const res = await fetch('https://brandpromoter-backend.onrender.com/api/candidates?limit=24', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json();
  console.log(`HTTP ${res.status}. Received ${json.data?.length} candidates on page 1:`);
  
  for (const c of json.data || []) {
    console.log(`- ${c.fullName || c.name} | Role: ${c.preferredRole || c.role} | MatchScore:`, c.matchScore ? `${c.matchScore.state} (${c.matchScore.rating10}/10 - ${c.matchScore.band})` : 'NULL (NO_JD)');
  }
}

main().catch(console.error);
