const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkIndexes() {
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'candidates';
  `);
  console.log(JSON.stringify(indexes, null, 2));
  await prisma.$disconnect();
}
checkIndexes().catch(console.error);
