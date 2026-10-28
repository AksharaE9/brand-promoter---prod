'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const prisma = require('../../config/db');
const seedData = require('./jd_seed_three_roles.json');

function normalizeTerm(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

const initialTaxonomy = [
  // Sales & BD
  { category: 'sales_bd', term: 'Lead Generation', synonyms: ['leads', 'prospecting', 'lead gen', 'client acquisition', 'prospects'] },
  { category: 'sales_bd', term: 'Cold Calling', synonyms: ['outbound calling', 'phone outreach', 'cold calls'] },
  { category: 'sales_bd', term: 'Telecalling / Telesales', synonyms: ['telecalling', 'telesales', 'calling', 'telecaller', 'telemarketing'] },
  { category: 'sales_bd', term: 'Client Interaction', synonyms: ['client interaction', 'customer handling', 'client communication', 'customer engagement'] },
  { category: 'sales_bd', term: 'B2B Sales', synonyms: ['b2b', 'corporate sales', 'business to business', 'b2b sales'] },
  { category: 'sales_bd', term: 'B2C Sales', synonyms: ['b2c', 'retail sales', 'direct sales', 'consumer sales'] },
  { category: 'sales_bd', term: 'Pitching', synonyms: ['sales pitch', 'product demo', 'presentation of offerings', 'pitch'] },
  { category: 'sales_bd', term: 'Negotiation', synonyms: ['closing deals', 'deal negotiation', 'bargaining', 'closing'] },
  { category: 'sales_bd', term: 'Follow-ups', synonyms: ['lead follow-up', 'pipeline tracking', 'follow up', 'regular updates'] },
  { category: 'sales_bd', term: 'Relationship Building', synonyms: ['relationship management', 'client relationships', 'networking', 'retention'] },
  { category: 'sales_bd', term: 'CRM Tools', synonyms: ['salesforce', 'zoho', 'hubspot', 'crm', 'leads management'] },
  { category: 'sales_bd', term: 'Target Achievement', synonyms: ['achieved target', 'sales targets', 'quota', 'revenue goals'] },
  { category: 'sales_bd', term: 'Field Work', synonyms: ['field sales', 'customer visits', 'door-to-door', 'on-ground activities', 'kiosk sales', 'stall sales'] },

  // Marketing
  { category: 'marketing', term: 'Marketing Campaigns', synonyms: ['campaigns', 'promotions', 'promotional activities', 'brand building', 'brand awareness'] },
  { category: 'marketing', term: 'Market Research', synonyms: ['surveys', 'market analysis', 'consumer insights', 'competitor analysis'] },
  { category: 'marketing', term: 'Social Media & Digital Marketing', synonyms: ['social media marketing', 'digital marketing', 'content marketing', 'seo', 'instagram marketing'] },
  { category: 'marketing', term: 'Campus Ambassador', synonyms: ['student ambassador', 'college outreach', 'campus promotions'] },

  // Operations
  { category: 'operations', term: 'Coordination', synonyms: ['cross-functional coordination', 'inter-department operations', 'task coordination', 'collaboration'] },
  { category: 'operations', term: 'Reporting & Record Keeping', synonyms: ['maintaining reports', 'mis', 'daily reports', 'documentation', 'activity reports', 'records'] },
  { category: 'operations', term: 'MS Excel', synonyms: ['excel', 'advanced excel', 'spreadsheets', 'vlookup', 'pivot tables', 'google sheets'] },
  { category: 'operations', term: 'Process Improvement', synonyms: ['operational efficiency', 'workflow optimization', 'productivity enhancement', 'streamlining'] },
  { category: 'operations', term: 'Vendor Management', synonyms: ['vendor interaction', 'vendor onboarding', 'supplier coordination', 'vendor relations'] },
  { category: 'operations', term: 'Logistics & Supply Chain', synonyms: ['logistics', 'supply chain', 'inventory', 'stock management', 'dispatch'] },
  { category: 'operations', term: 'Scheduling & Time Management', synonyms: ['scheduling', 'calendar management', 'timelines', 'deadlines', 'time management'] },
  { category: 'operations', term: 'Multitasking & Ownership', synonyms: ['multitasking', 'ownership', 'accountability', 'proactive execution'] },

  // Leadership & Communication Signals
  { category: 'leadership_signals', term: 'Presentations & Public Speaking', synonyms: ['presentation skills', 'public speaking', 'seminars', 'ppt presentations', 'speech'] },
  { category: 'leadership_signals', term: 'Debate / MUN / Elocution', synonyms: ['debate', 'model united nations', 'mun', 'elocution', 'oratory'] },
  { category: 'leadership_signals', term: 'Event Organiser / Coordinator', synonyms: ['event coordinator', 'fest organiser', 'organizing committee', 'event management', 'fest coordinator'] },
  { category: 'leadership_signals', term: 'Club & Committee Roles', synonyms: ['student club', 'committee member', 'class representative', 'core team', 'secretary', 'president'] },
  { category: 'leadership_signals', term: 'Outreach & Volunteering', synonyms: ['volunteer', 'social outreach', 'ngo', 'community service', 'fundraising', 'sponsorship'] },
];

async function seedJds(orgId = 'defaultOrg') {
  console.log('[SeedJDs] Seeding Job Descriptions, Versions, Aliases, Exclusions & Taxonomy...');

  // 1. Seed JDs
  for (const jd of seedData.jds) {
    let existingJd = await prisma.jobDescription.findFirst({
      where: { organizationId: orgId, title: jd.title }
    });

    if (!existingJd) {
      existingJd = await prisma.jobDescription.create({
        data: {
          title: jd.title,
          company: jd.company,
          location: jd.location,
          mode: jd.mode,
          status: jd.status,
          organizationId: orgId,
        }
      });
      console.log(`  Created JD: ${jd.title} (${existingJd.id})`);
    } else {
      await prisma.jobDescription.update({
        where: { id: existingJd.id },
        data: {
          company: jd.company,
          location: jd.location,
          mode: jd.mode,
          status: jd.status
        }
      });
      console.log(`  Updated existing JD: ${jd.title} (${existingJd.id})`);
    }

    // Version
    let version = await prisma.jobDescriptionVersion.findFirst({
      where: { jdId: existingJd.id, version: 1 }
    });

    if (!version) {
      version = await prisma.jobDescriptionVersion.create({
        data: {
          jdId: existingJd.id,
          version: 1,
          rawText: jd.raw_text,
          structuredRequirements: jd.structured_requirements,
          weights: jd.weights,
          createdBy: 'system_seed',
          activatedAt: new Date()
        }
      });
      console.log(`    Created Version 1 for ${jd.title} (${version.id})`);
    } else {
      await prisma.jobDescriptionVersion.update({
        where: { id: version.id },
        data: {
          rawText: jd.raw_text,
          structuredRequirements: jd.structured_requirements,
          weights: jd.weights,
          activatedAt: version.activatedAt || new Date()
        }
      });
      console.log(`    Updated Version 1 for ${jd.title} (${version.id})`);
    }

    await prisma.jobDescription.update({
      where: { id: existingJd.id },
      data: { currentVersionId: version.id }
    });

    // Aliases (include)
    for (const alias of jd.aliases.include) {
      const norm = normalizeTerm(alias);
      const existingAlias = await prisma.roleAlias.findFirst({
        where: { jdId: existingJd.id, normalizedAlias: norm }
      });
      if (!existingAlias) {
        await prisma.roleAlias.create({
          data: {
            jdId: existingJd.id,
            alias,
            normalizedAlias: norm,
            kind: 'include'
          }
        });
      }
    }

    // Aliases (review)
    for (const alias of jd.aliases.review) {
      const norm = normalizeTerm(alias);
      const existingAlias = await prisma.roleAlias.findFirst({
        where: { jdId: existingJd.id, normalizedAlias: norm }
      });
      if (!existingAlias) {
        await prisma.roleAlias.create({
          data: {
            jdId: existingJd.id,
            alias,
            normalizedAlias: norm,
            kind: 'review'
          }
        });
      }
    }
  }

  // 2. Seed Exclusions
  for (const exc of seedData.exclusions) {
    const norm = normalizeTerm(exc.term);
    const existing = await prisma.roleExclusion.findFirst({
      where: { normalizedTerm: norm }
    });
    if (!existing) {
      await prisma.roleExclusion.create({
        data: {
          term: exc.term,
          normalizedTerm: norm,
          reason: exc.reason
        }
      });
    }
  }
  console.log(`  Seeded ${seedData.exclusions.length} role exclusions`);

  // 3. Seed Taxonomy
  for (const tax of initialTaxonomy) {
    const norm = normalizeTerm(tax.term);
    const existing = await prisma.skillsTaxonomy.findFirst({
      where: { normalizedTerm: norm, category: tax.category }
    });
    if (!existing) {
      await prisma.skillsTaxonomy.create({
        data: {
          category: tax.category,
          term: tax.term,
          normalizedTerm: norm,
          synonyms: tax.synonyms,
          weight: 1.0
        }
      });
    }
  }
  console.log(`  Seeded ${initialTaxonomy.length} taxonomy skill clusters`);
  console.log('[SeedJDs] Complete!');
}

if (require.main === module) {
  seedJds()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[SeedJDs] Error:', err);
      process.exit(1);
    });
}

module.exports = { seedJds, normalizeTerm };
