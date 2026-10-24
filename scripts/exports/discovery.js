'use strict';

const path = require('path');
const fs = require('fs');
const backendNodeModules = path.resolve(__dirname, '../../backend/node_modules');
module.paths.push(backendNodeModules);

require(path.join(backendNodeModules, 'dotenv')).config({ path: path.resolve(__dirname, '../../backend/.env') });


const { PrismaClient } = require(path.resolve(__dirname, '../../backend/node_modules/@prisma/client'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  console.log('Starting discovery...');

  // Read-only session confirmation
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');

  // 1. Total counts
  const totalCandidates = await prisma.candidate.count();
  const deletedCandidates = await prisma.candidate.count({ where: { isDeleted: true } });
  const testCandidates = await prisma.candidate.count({ where: { is_test_data: true } });
  const activeCandidates = await prisma.candidate.count({
    where: { isDeleted: false, is_test_data: false }
  });

  console.log(`Candidates total: ${totalCandidates}`);
  console.log(`Deleted candidates: ${deletedCandidates}`);
  console.log(`Test candidates: ${testCandidates}`);
  console.log(`Active candidates: ${activeCandidates}`);

  const totalJobs = await prisma.job.count();
  console.log(`Jobs total: ${totalJobs}`);

  // 2. Sample customFields keys from candidates
  const sampleCustomFields = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT jsonb_object_keys(custom_fields::jsonb) AS key_name
    FROM candidates
    WHERE custom_fields IS NOT NULL AND custom_fields::text != 'null' AND custom_fields::text != '{}'
    LIMIT 50;
  `).catch(err => {
    // In case column name in DB is customFields or custom_fields
    return prisma.$queryRawUnsafe(`
      SELECT DISTINCT jsonb_object_keys("customFields"::jsonb) AS key_name
      FROM candidates
      WHERE "customFields" IS NOT NULL AND "customFields"::text != 'null' AND "customFields"::text != '{}'
      LIMIT 50;
    `).catch(() => []);
  });

  console.log('Custom fields keys:', sampleCustomFields);

  // 3. Inspect distinct role fields
  // candidate.jobTitle
  const candidateJobTitles = await prisma.$queryRawUnsafe(`
    SELECT "jobTitle" AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "jobTitle" IS NOT NULL AND TRIM("jobTitle") != ''
    GROUP BY "jobTitle"
    ORDER BY count DESC;
  `).catch(err => {
    return prisma.$queryRawUnsafe(`
      SELECT job_title AS val, COUNT(*)::int AS count
      FROM candidates
      WHERE job_title IS NOT NULL AND TRIM(job_title) != ''
      GROUP BY job_title
      ORDER BY count DESC;
    `).catch(e => { console.error('jobTitle err:', e.message); return []; });
  });

  // candidate.preferredRole
  const candidatePreferredRoles = await prisma.$queryRawUnsafe(`
    SELECT "preferredRole" AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "preferredRole" IS NOT NULL AND TRIM("preferredRole") != ''
    GROUP BY "preferredRole"
    ORDER BY count DESC;
  `).catch(err => {
    return prisma.$queryRawUnsafe(`
      SELECT preferred_role AS val, COUNT(*)::int AS count
      FROM candidates
      WHERE preferred_role IS NOT NULL AND TRIM(preferred_role) != ''
      GROUP BY preferred_role
      ORDER BY count DESC;
    `).catch(e => { console.error('preferredRole err:', e.message); return []; });
  });

  // candidate.category
  const candidateCategories = await prisma.$queryRawUnsafe(`
    SELECT category AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE category IS NOT NULL AND TRIM(category) != ''
    GROUP BY category
    ORDER BY count DESC;
  `).catch(e => { console.error('category err:', e.message); return []; });

  // jobs.title
  const jobTitles = await prisma.$queryRawUnsafe(`
    SELECT title AS val, COUNT(*)::int AS count
    FROM jobs
    WHERE title IS NOT NULL AND TRIM(title) != ''
    GROUP BY title
    ORDER BY count DESC;
  `).catch(e => { console.error('jobs title err:', e.message); return []; });

  // interviews.jobTitle
  const interviewJobTitles = await prisma.$queryRawUnsafe(`
    SELECT "jobTitle" AS val, COUNT(*)::int AS count
    FROM interviews
    WHERE "jobTitle" IS NOT NULL AND TRIM("jobTitle") != ''
    GROUP BY "jobTitle"
    ORDER BY count DESC;
  `).catch(err => {
    return prisma.$queryRawUnsafe(`
      SELECT job_title AS val, COUNT(*)::int AS count
      FROM interviews
      WHERE job_title IS NOT NULL AND TRIM(job_title) != ''
      GROUP BY job_title
      ORDER BY count DESC;
    `).catch(e => { console.error('interview jobTitle err:', e.message); return []; });
  });

  // 4. Inspect distinct location fields
  // candidate.location
  const candidateLocations = await prisma.$queryRawUnsafe(`
    SELECT location AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE location IS NOT NULL AND TRIM(location) != ''
    GROUP BY location
    ORDER BY count DESC;
  `).catch(e => { console.error('candidates location err:', e.message); return []; });

  // candidate.area
  const candidateAreas = await prisma.$queryRawUnsafe(`
    SELECT area AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE area IS NOT NULL AND TRIM(area) != ''
    GROUP BY area
    ORDER BY count DESC;
  `).catch(e => { console.error('candidates area err:', e.message); return []; });

  // jobs.location
  const jobLocations = await prisma.$queryRawUnsafe(`
    SELECT location AS val, COUNT(*)::int AS count
    FROM jobs
    WHERE location IS NOT NULL AND TRIM(location) != ''
    GROUP BY location
    ORDER BY count DESC;
  `).catch(e => { console.error('jobs location err:', e.message); return []; });

  // Check SC and SME in candidates / jobs / interviews
  const scMatches = await prisma.$queryRawUnsafe(`
    SELECT id, "jobTitle", "preferredRole", location, area
    FROM candidates
    WHERE ("jobTitle" ~* '\\msc\\M' OR "preferredRole" ~* '\\msc\\M')
    LIMIT 20;
  `).catch(() => []);

  const smeMatches = await prisma.$queryRawUnsafe(`
    SELECT id, "jobTitle", "preferredRole", location, area
    FROM candidates
    WHERE ("jobTitle" ~* '\\msme\\M' OR "preferredRole" ~* '\\msme\\M')
    LIMIT 20;
  `).catch(() => []);

  const scJobMatches = await prisma.$queryRawUnsafe(`
    SELECT id, title, department, description
    FROM jobs
    WHERE (title ~* '\\msc\\M' OR description ~* '\\msc\\M')
    LIMIT 20;
  `).catch(() => []);

  const smeJobMatches = await prisma.$queryRawUnsafe(`
    SELECT id, title, department, description
    FROM jobs
    WHERE (title ~* '\\msme\\M' OR description ~* '\\msme\\M')
    LIMIT 20;
  `).catch(() => []);

  // Additional candidate role fields: customFields->role_as_written, family, callingTarget
  const candidateRoleAsWritten = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'role_as_written' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'role_as_written' IS NOT NULL AND TRIM("customFields"->>'role_as_written') != ''
    GROUP BY "customFields"->>'role_as_written'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateFamily = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'family' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'family' IS NOT NULL AND TRIM("customFields"->>'family') != ''
    GROUP BY "customFields"->>'family'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateCallingTarget = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'callingTarget' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'callingTarget' IS NOT NULL AND TRIM("customFields"->>'callingTarget') != ''
    GROUP BY "customFields"->>'callingTarget'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateCurrentCompany = await prisma.$queryRawUnsafe(`
    SELECT "currentCompany" AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "currentCompany" IS NOT NULL AND TRIM("currentCompany") != ''
    GROUP BY "currentCompany"
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateSource = await prisma.$queryRawUnsafe(`
    SELECT source AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE source IS NOT NULL AND TRIM(source) != ''
    GROUP BY source
    ORDER BY count DESC;
  `).catch(() => []);

  // Additional location fields: customFields->fromPlace, from_place, college_area_verbatim, location_state_verbatim
  const candidateFromPlace = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'fromPlace' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'fromPlace' IS NOT NULL AND TRIM("customFields"->>'fromPlace') != ''
    GROUP BY "customFields"->>'fromPlace'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateFrom_place = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'from_place' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'from_place' IS NOT NULL AND TRIM("customFields"->>'from_place') != ''
    GROUP BY "customFields"->>'from_place'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateCollegeArea = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'college_area_verbatim' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'college_area_verbatim' IS NOT NULL AND TRIM("customFields"->>'college_area_verbatim') != ''
    GROUP BY "customFields"->>'college_area_verbatim'
    ORDER BY count DESC;
  `).catch(() => []);

  const candidateLocationState = await prisma.$queryRawUnsafe(`
    SELECT "customFields"->>'location_state_verbatim' AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "customFields"->>'location_state_verbatim' IS NOT NULL AND TRIM("customFields"->>'location_state_verbatim') != ''
    GROUP BY "customFields"->>'location_state_verbatim'
    ORDER BY count DESC;
  `).catch(() => []);

  // Write discovery files
  const exportsDir = path.resolve(__dirname, '../../exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Combined roles CSV
  let rolesCsv = 'source_field,role_value,count\n';
  candidateJobTitles.forEach(r => {
    rolesCsv += `"candidate.jobTitle","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidatePreferredRoles.forEach(r => {
    rolesCsv += `"candidate.preferredRole","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateRoleAsWritten.forEach(r => {
    rolesCsv += `"candidate.customFields.role_as_written","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateFamily.forEach(r => {
    rolesCsv += `"candidate.customFields.family","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateCallingTarget.forEach(r => {
    rolesCsv += `"candidate.customFields.callingTarget","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateCategories.forEach(r => {
    rolesCsv += `"candidate.category","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  jobTitles.forEach(r => {
    rolesCsv += `"job.title","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  interviewJobTitles.forEach(r => {
    rolesCsv += `"interview.jobTitle","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateCurrentCompany.forEach(r => {
    rolesCsv += `"candidate.currentCompany","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateSource.forEach(r => {
    rolesCsv += `"candidate.source","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });

  fs.writeFileSync(path.join(exportsDir, 'discovery_roles.csv'), rolesCsv, 'utf8');
  fs.writeFileSync(path.join(exportsDir, 'discovery_roles_hyd.csv'), rolesCsv, 'utf8');

  // Combined locations CSV
  let locationsCsv = 'source_field,location_value,count\n';
  candidateLocations.forEach(r => {
    locationsCsv += `"candidate.location","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateAreas.forEach(r => {
    locationsCsv += `"candidate.area","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  jobLocations.forEach(r => {
    locationsCsv += `"job.location","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateFromPlace.forEach(r => {
    locationsCsv += `"candidate.customFields.fromPlace","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateFrom_place.forEach(r => {
    locationsCsv += `"candidate.customFields.from_place","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateCollegeArea.forEach(r => {
    locationsCsv += `"candidate.customFields.college_area_verbatim","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });
  candidateLocationState.forEach(r => {
    locationsCsv += `"candidate.customFields.location_state_verbatim","${(r.val || '').replace(/"/g, '""')}",${r.count}\n`;
  });

  fs.writeFileSync(path.join(exportsDir, 'discovery_locations.csv'), locationsCsv, 'utf8');
  fs.writeFileSync(path.join(exportsDir, 'discovery_locations_hyd.csv'), locationsCsv, 'utf8');

  // Hyderabad specific discovery
  const hydLocCandidates = await prisma.$queryRawUnsafe(`
    SELECT id, "fullName", location, area, "customFields"->>'fromPlace' as from_place, "customFields"->>'location_state_verbatim' as loc_state
    FROM candidates
    WHERE (
      location ~* 'hyd|secunderabad|secundrabad|cyberabad|telangana|ghmc|gachibowli|madhapur|hitec|kondapur|kukatpally|kphb|miyapur|nizampet|bachupally|chandanagar|lingampally|manikonda|nanakramguda|kokapet|narsingi|ameerpet|begumpet|somajiguda|panjagutta|banjara|jubilee|himayatnagar|abids|koti|nampally|lakdikapul|khairatabad|mehdipatnam|tolichowki|attapur|charminar|malakpet|dilsukhnagar|lb nagar|kothapet|vanasthalipuram|uppal|habsiguda|tarnaka|nacharam|mallapur|ecil|as rao|sainikpuri|malkajgiri|alwal|bowenpally|trimulgherry|kompally|suchitra|jeedimetla|quthbullapur|shamshabad|rajendranagar'
      OR area ~* 'hyd|secunderabad|secundrabad|cyberabad|telangana|ghmc|gachibowli|madhapur|hitec|kondapur|kukatpally|kphb|miyapur|nizampet|bachupally|chandanagar|lingampally|manikonda|nanakramguda|kokapet|narsingi|ameerpet|begumpet|somajiguda|panjagutta|banjara|jubilee|himayatnagar|abids|koti|nampally|lakdikapul|khairatabad|mehdipatnam|tolichowki|attapur|charminar|malakpet|dilsukhnagar|lb nagar|kothapet|vanasthalipuram|uppal|habsiguda|tarnaka|nacharam|mallapur|ecil|as rao|sainikpuri|malkajgiri|alwal|bowenpally|trimulgherry|kompally|suchitra|jeedimetla|quthbullapur|shamshabad|rajendranagar'
    );
  `).catch(err => { console.error('hydLocCandidates err:', err.message); return []; });

  const hydJobCandidates = await prisma.$queryRawUnsafe(`
    SELECT j.id, j.title, j.location, COUNT(a.id)::int as app_count
    FROM jobs j
    LEFT JOIN applications a ON a."jobId" = j.id
    WHERE j.location ~* 'hyd|secunderabad|secundrabad|cyberabad|telangana'
    GROUP BY j.id, j.title, j.location;
  `).catch(err => { console.error('hydJobCandidates err:', err.message); return []; });

  // Telecalling specific discovery
  const telecallingCandidates = await prisma.$queryRawUnsafe(`
    SELECT id, "fullName", "jobTitle", "preferredRole", "customFields"->>'role_as_written' as role_as_written
    FROM candidates
    WHERE (
      "jobTitle" ~* 'tel+[ei]|telesales|telemarketing|calling|voice|inside sales'
      OR "preferredRole" ~* 'tel+[ei]|telesales|telemarketing|calling|voice|inside sales'
      OR "customFields"->>'role_as_written' ~* 'tel+[ei]|telesales|telemarketing|calling|voice|inside sales'
    );
  `).catch(err => { console.error('telecallingCandidates err:', err.message); return []; });

  console.log(`Hyderabad matching candidate records: ${hydLocCandidates.length}`);
  console.log(`Hyderabad jobs: ${hydJobCandidates.length}`);
  console.log(`Telecalling matching candidate records: ${telecallingCandidates.length}`);
  console.log('Discovery complete. Files written to exports/discovery_roles_hyd.csv, exports/discovery_locations_hyd.csv');
}

main()
  .catch(err => {
    console.error('Discovery error:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
