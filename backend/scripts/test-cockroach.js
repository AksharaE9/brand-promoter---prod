/**
 * scripts/test-cockroach.js
 * Quick smoke-test script — verify CockroachDB connectivity and table existence.
 * Run with: node scripts/test-cockroach.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error'],
});

const TABLES = [
  'users',
  'sessions',
  'candidates',
  'jobs',
  'applications',
  'pipeline_stages',
  'pipeline_events',
  'interviews',
  'notifications',
  'audit_logs',
  'file_metas',
  'custom_field_definitions',
  'job_documents',
  'job_questions',
  'college_drives',
];

async function main() {
  console.log('\n🔌 Testing CockroachDB Connection...');
  console.log(`   URL: ${process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@')}\n`);

  try {
    // 1. Basic connectivity
    await prisma.$connect();
    console.log('✅  Connection: SUCCESSFUL\n');

    // 2. Ping
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅  Ping: OK\n');

    // 3. Table counts
    console.log('📊  Table Row Counts:');
    console.log('─'.repeat(40));

    const counts = await Promise.allSettled([
      prisma.user.count(),
      prisma.session.count(),
      prisma.candidate.count(),
      prisma.job.count(),
      prisma.application.count(),
      prisma.pipelineStage.count(),
      prisma.pipelineEvent.count(),
      prisma.interview.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
      prisma.fileMeta.count(),
      prisma.customFieldDefinition.count(),
      prisma.jobDocument.count(),
      prisma.jobQuestion.count(),
      prisma.collegeDrive.count(),
    ]);

    const modelNames = [
      'User', 'Session', 'Candidate', 'Job', 'Application',
      'PipelineStage', 'PipelineEvent', 'Interview', 'Notification', 'AuditLog',
      'FileMeta', 'CustomFieldDefinition', 'JobDocument', 'JobQuestion', 'CollegeDrive'
    ];

    let allGood = true;
    counts.forEach((result, i) => {
      const tableName = TABLES[i];
      const modelName = modelNames[i];
      if (result.status === 'fulfilled') {
        const count = result.value;
        const countStr = count.toLocaleString();
        const badge = count > 0 ? '📦' : '📭';
        console.log(`  ${badge}  ${tableName.padEnd(30)} ${countStr.padStart(8)} rows`);
      } else {
        console.log(`  ❌  ${tableName.padEnd(30)} ERROR: ${result.reason?.message?.split('\n')[0] || 'Unknown'}`);
        allGood = false;
      }
    });

    console.log('─'.repeat(40));

    if (allGood) {
      console.log('\n✅  ALL TABLES: OK');
      console.log('\n🎉 CockroachDB is connected and ready!\n');
    } else {
      console.log('\n⚠️  Some tables may not exist yet. Run: npm run prisma:deploy\n');
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Connection FAILED:', err.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Check your DATABASE_URL in .env');
    console.error('  2. Ensure sslmode=verify-full is set');
    console.error('  3. Check CockroachDB cluster is running');
    console.error('  4. Run: npm run prisma:deploy (to create tables)\n');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
