const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkAliases() {
  const aliases = await prisma.roleAlias.findMany({
    include: { jobDescription: { select: { title: true } } }
  });
  console.log('--- ALL ROLE ALIASES IN DB ---');
  for (const a of aliases) {
    console.log(`[${a.kind}] "${a.alias}" (norm: "${a.normalizedAlias}") -> JD: ${a.jobDescription?.title}`);
  }

  // Check titles "MARKETING INTERN" and "BRAND PROMOTER"
  console.log('\n--- TESTING SPECIFIC TITLES ---');
  const { resolveCandidateRole } = require('../backend/src/modules/matching/roleResolver');
  const r1 = await resolveCandidateRole({ preferredRole: 'MARKETING INTERN' });
  console.log('MARKETING INTERN ->', r1.status, r1.resolutionKind, r1.aliasMatched, r1.reason);

  const r2 = await resolveCandidateRole({ preferredRole: 'BRAND PROMOTER' });
  console.log('BRAND PROMOTER ->', r2.status, r2.resolutionKind, r2.aliasMatched, r2.reason);

  await prisma.$disconnect();
}
checkAliases().catch(console.error);
