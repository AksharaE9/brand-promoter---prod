'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.RENDER_DATABASE_URL || 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require' } }
});

async function main() {
  const selectedSamples = await prisma.candidate.findMany({
    where: {
      interviewFeedbacks: { some: { selectionStatus: 'SELECTED' } }
    },
    take: 3,
    include: {
      applications: {
        include: { interviews: true }
      },
      interviewFeedbacks: true
    }
  });
  console.log('--- SELECTED CANDIDATES SAMPLES ---');
  for (const s of selectedSamples) {
    console.log({
      candidateId: s.id,
      candidateStatus: s.status,
      candidateOfferDecision: s.offerDecision,
      appStatus: s.applications[0]?.status,
      interviewStatus: s.applications[0]?.interviews[0]?.status,
      interviewOutcome: s.applications[0]?.interviews[0]?.outcome,
      feedbackStatus: s.interviewFeedbacks[0]?.selectionStatus,
      feedbackRating: s.interviewFeedbacks[0]?.overallRating
    });
  }

  const rejectedSamples = await prisma.candidate.findMany({
    where: {
      interviewFeedbacks: { some: { selectionStatus: 'REJECTED' } }
    },
    take: 3,
    include: {
      applications: {
        include: { interviews: true }
      },
      interviewFeedbacks: true
    }
  });
  console.log('--- REJECTED CANDIDATES SAMPLES ---');
  for (const r of rejectedSamples) {
    console.log({
      candidateId: r.id,
      candidateStatus: r.status,
      candidateOfferDecision: r.offerDecision,
      appStatus: r.applications[0]?.status,
      interviewStatus: r.applications[0]?.interviews[0]?.status,
      interviewOutcome: r.applications[0]?.interviews[0]?.outcome,
      feedbackStatus: r.interviewFeedbacks[0]?.selectionStatus,
      feedbackRating: r.interviewFeedbacks[0]?.overallRating
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
