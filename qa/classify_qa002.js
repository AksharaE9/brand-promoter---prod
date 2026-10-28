const fs = require('fs');
const path = require('path');
const prisma = require('../backend/src/config/db');

async function main() {
  const nullInterviews = await prisma.interview.findMany({
    where: {
      status: 'COMPLETED',
      outcome: null
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Total COMPLETED interviews with outcome = null: ${nullInterviews.length}`);

  // Batch prefetch all interviews for these candidates
  const candIds = [...new Set(nullInterviews.map(i => i.candidateId).filter(Boolean))];
  const allCandInterviews = await prisma.interview.findMany({
    where: { candidateId: { in: candIds } },
    select: { id: true, candidateId: true, roundNo: true, outcome: true, status: true }
  });

  const intvsByCand = {};
  allCandInterviews.forEach(i => {
    intvsByCand[i.candidateId] = (intvsByCand[i.candidateId] || []).concat(i);
  });

  let classA = []; // feedback states outcome explicitly
  let classB = []; // later round exists -> inferred_progressed
  let classC = []; // nothing -> Results not recorded review list

  for (const intv of nullInterviews) {
    let outcomeParsed = null;

    // Check feedback array
    const fbList = Array.isArray(intv.feedback) ? intv.feedback : [];
    for (const fb of fbList) {
      const fbData = fb.feedbackData || fb;
      const statusText = fb.selectionStatus || fbData.selectionStatus || fbData.status || '';
      if (/selected/i.test(statusText)) {
        outcomeParsed = 'SELECTED';
        break;
      } else if (/reject/i.test(statusText)) {
        outcomeParsed = 'REJECTED';
        break;
      } else if (/hold/i.test(statusText)) {
        outcomeParsed = 'ON_HOLD';
        break;
      }
    }

    // Check notes if feedback didn't yield an outcome
    if (!outcomeParsed && intv.notes) {
      if (/selection status:\s*selected/i.test(intv.notes) || /status:\s*selected/i.test(intv.notes)) {
        outcomeParsed = 'SELECTED';
      } else if (/selection status:\s*rejected/i.test(intv.notes) || /status:\s*rejected/i.test(intv.notes)) {
        outcomeParsed = 'REJECTED';
      } else if (/selection status:\s*hold/i.test(intv.notes) || /status:\s*on[ _]hold/i.test(intv.notes)) {
        outcomeParsed = 'ON_HOLD';
      }
    }

    if (outcomeParsed) {
      classA.push({
        id: intv.id,
        candidateId: intv.candidateId,
        candidateName: intv.candidateName,
        roundNo: intv.roundNo,
        proposedOutcome: outcomeParsed,
        outcome_source: 'parsed_from_feedback'
      });
      continue;
    }

    // Check if a later round exists for this candidate
    if (intv.candidateId && intvsByCand[intv.candidateId]) {
      const laterRound = intvsByCand[intv.candidateId].find(r => r.roundNo > intv.roundNo);
      if (laterRound) {
        classB.push({
          id: intv.id,
          candidateId: intv.candidateId,
          candidateName: intv.candidateName,
          roundNo: intv.roundNo,
          laterRoundNo: laterRound.roundNo,
          proposedOutcome: 'SELECTED',
          outcome_source: 'inferred_progressed'
        });
        continue;
      }
    }

    classC.push({
      id: intv.id,
      candidateId: intv.candidateId,
      candidateName: intv.candidateName,
      roundNo: intv.roundNo,
      notes: intv.notes,
      reason: 'No explicit feedback outcome and no later round found'
    });
  }

  console.log(`\n=== QA-002 CLASSIFICATION RESULTS ===`);
  console.log(`Class (a) [parsed_from_feedback]: ${classA.length}`);
  console.log(`Class (b) [inferred_progressed]: ${classB.length}`);
  console.log(`Class (c) [results_not_recorded]: ${classC.length}`);
  console.log(`Total: ${classA.length + classB.length + classC.length}`);

  const outPath = path.join(__dirname, 'reports', 'qa002_classification.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ classA, classB, classC }, null, 2),
    'utf8'
  );
  console.log(`Saved classification to ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
