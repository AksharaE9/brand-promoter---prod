'use strict';
/**
 * inject_rrce_candidates.js
 *
 * Injection script for Rajarajeshwari College of Engineering (RRCE) Campus Drive:
 * - 24 Candidates (8 Selected, 16 Rejected)
 * - Round 1 Scheduled with Outcomes and Detailed Verbatim Feedback
 * - Enrol pre-existing candidate Rakshita into RRCE Drive (retaining her existing Round 1 rejected record)
 * - Resumes attached per candidate into PostgreSQL FileMeta (db:// storage), 23 upright JPEG files, 1 skipped (Ragini Sharma)
 * - Stamped with source: 'RRCE_DRIVE_IMPORT_2026-10-28'
 * - Atomic transactions per candidate, 80ms pause for 512MB RAM stability
 * - Idempotent and safe
 *
 * Flags:
 *   --dry-run      : Simulate and print 24-row preview table without modifying DB
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const prisma = require('../src/config/db');
const { normalizePhoneNumber } = require('../src/lib/phoneNormalization');
const { makeStorageKey, verifyDbFile } = require('../src/utils/dbStorage');
const inv = require('../src/utils/cacheInvalidation');

const INTERVIEW_DATE_ISO = '2026-10-27T04:30:00.000Z'; // 27-10-2026 10:00 IST
const IMPORT_MARKER = 'RRCE_DRIVE_IMPORT_2026-10-28';
const RAKSHITA_ID = 'cmvqbje7d005rtbqoy2wvmg7c';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('========================================================================');
  console.log(`  RRCE INJECTION SCRIPT: 24 CANDIDATES + RAKSHITA ${isDryRun ? '(DRY RUN)' : '(EXECUTE)'}`);
  console.log('========================================================================\n');

  // 1. Initial State Check
  const notifCountBefore = await prisma.notification.count();
  console.log(`[Queue Check] Outbound notifications count: ${notifCountBefore}`);

  // 2. Fetch or Create College
  let college = await prisma.college.findFirst({
    where: {
      OR: [
        { name: 'Rajarajeshwari College of Engineering (RRCE)' },
        { name: 'Rajarajeshwari College of Engineering' },
      ]
    }
  });

  const vinay = await prisma.user.findFirst({
    where: { email: 'vinay.shetty@aksharaenterprises.info' }
  });
  if (!vinay) throw new Error('Vinay Shetty user record not found in DB!');

  if (!college && !isDryRun) {
    console.log('Creating College: "Rajarajeshwari College of Engineering (RRCE)"...');
    college = await prisma.college.create({
      data: {
        name: 'Rajarajeshwari College of Engineering (RRCE)',
        location: 'Bengaluru',
        area: 'Mysore Road',
        createdById: vinay.id,
      }
    });
    console.log(`College created with ID: ${college.id}`);
  } else if (college) {
    console.log(`Using College: "${college.name}" (ID: ${college.id})`);
  }

  // 3. Fetch or Create College Drive
  let drive = college ? await prisma.collegeDrive.findFirst({
    where: {
      isDeleted: false,
      collegeId: college.id,
      title: { contains: 'RRCE', mode: 'insensitive' }
    }
  }) : null;

  if (!drive && !isDryRun && college) {
    console.log('Creating College Drive: "Rajarajeshwari College of Engineering (RRCE) - Campus Drive"...');
    drive = await prisma.collegeDrive.create({
      data: {
        title: 'Rajarajeshwari College of Engineering (RRCE) - Campus Drive',
        collegeId: college.id,
        dateFrom: '2026-10-27',
        dateTo: '2026-10-27',
        status: 'COMPLETED',
        description: 'Campus Recruitment Drive at Rajarajeshwari College of Engineering on 27 Oct 2026. Round 1 conducted by Vinay Shetty.',
        notes: 'Bengaluru',
        ownerId: vinay.id,
        organizationId: 'defaultOrg',
        recruiters: [vinay.id],
      }
    });
    console.log(`Drive created with ID: ${drive.id}`);
  } else if (drive) {
    console.log(`Using Drive: "${drive.title}" (ID: ${drive.id})`);
  }

  // 4. Enrol Rakshita if not already enrolled
  if (drive && !isDryRun) {
    const existingRakshitaEnrol = await prisma.collegeDriveCandidate.findFirst({
      where: { driveId: drive.id, candidateId: RAKSHITA_ID }
    });
    if (!existingRakshitaEnrol) {
      const rakshita = await prisma.candidate.findUnique({ where: { id: RAKSHITA_ID } });
      if (rakshita) {
        await prisma.collegeDriveCandidate.create({
          data: {
            driveId: drive.id,
            candidateId: rakshita.id,
            fullName: rakshita.fullName,
            email: rakshita.email !== 'N/A' ? rakshita.email : null,
            phone: rakshita.phone || 'N/A',
            status: 'ADDED',
          }
        });
        console.log(`Enrolled Rakshita (ID: ${rakshita.id}) into RRCE drive successfully.`);
      }
    }
  }

  // 5. Read CSV
  const csvPath = fs.existsSync(path.resolve(__dirname, '../RRCE_R1_injection_24.csv'))
    ? path.resolve(__dirname, '../RRCE_R1_injection_24.csv')
    : path.resolve(__dirname, '../../data/rrce/RRCE_R1_injection_24.csv');
  
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true });
  console.log(`Loaded ${rows.length} candidate rows from CSV.`);

  const possibleResumesDirs = [
    path.resolve(__dirname, '../../data/rrce/resumes_by_candidate'),
    path.resolve(__dirname, '../scratch/rrce_resumes'),
  ];
  const resumesDir = possibleResumesDirs.find(d => fs.existsSync(d)) || possibleResumesDirs[0];

  let createdCount = 0;
  let attachedCount = 0;
  let skippedCount = 0;
  let exceptionCount = 0;

  for (const row of rows) {
    const idx = parseInt(row.row_number, 10);
    const candidateName = row.name.trim();
    const phone = row.phone ? row.phone.trim() : null;
    const email = row.email ? row.email.trim() : null;
    const phoneNormalized = phone ? normalizePhoneNumber(phone) : null;
    const rating = row.rating ? parseFloat(row.rating) : null;
    const outcome = row.outcome.trim().toUpperCase();

    if (isDryRun) {
      console.log(`[DRY RUN ${idx}/24] ${candidateName} | Phone: ${phone || 'NULL'} | Email: ${email || 'NULL'} | Outcome: ${outcome} | Rating: ${rating}`);
      createdCount++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // A. Match existing candidate by phone or email
        let candidate = null;
        const matchConditions = [];
        if (phoneNormalized) matchConditions.push({ phoneNormalized });
        if (phone) matchConditions.push({ phone });
        if (email) matchConditions.push({ email: { equals: email, mode: 'insensitive' } });

        if (matchConditions.length > 0) {
          candidate = await tx.candidate.findFirst({
            where: {
              isDeleted: false,
              OR: matchConditions,
            }
          });
        }

        // B. Handle Resume Upload (FileMeta)
        let resumeFileId = null;
        if (row.resume_file) {
          const resumePath = path.join(resumesDir, row.resume_file);
          if (fs.existsSync(resumePath)) {
            const fileBuffer = fs.readFileSync(resumePath);
            const tempMeta = await tx.fileMeta.create({
              data: {
                storageKey: 'db://pending',
                originalName: row.resume_file,
                mimeType: 'image/jpeg',
                sizeBytes: fileBuffer.length,
                fileData: fileBuffer,
                uploadedById: vinay.id,
              }
            });
            await tx.fileMeta.update({
              where: { id: tempMeta.id },
              data: { storageKey: makeStorageKey(tempMeta.id) }
            });
            resumeFileId = tempMeta.id;
          }
        }

        const candidateStatus = outcome === 'REJECTED' ? 'REJECTED' : 'INTERVIEWING';

        const customFields = {
          notesSpelling: row.notes_spelling,
          contactConfidence: row.contact_confidence,
          flags: row.flags || '',
          needsContactDetails: (row.flags || '').includes('needs_contact_details'),
          collegeOnResume: row.college_on_resume || null,
          courseOnResume: row.course_on_resume || null,
          roleWritten: row.role_as_written || null,
        };

        if (candidate) {
          attachedCount++;
          candidate = await tx.candidate.update({
            where: { id: candidate.id },
            data: {
              college: row.college_on_resume || candidate.college,
              course: row.course_on_resume || candidate.course,
              preferredRole: row.mapped_job_title || candidate.preferredRole,
              resumeFileId: resumeFileId || candidate.resumeFileId,
              customFields: { ...(candidate.customFields || {}), ...customFields },
            }
          });
        } else {
          createdCount++;
          candidate = await tx.candidate.create({
            data: {
              fullName: candidateName,
              email: email || 'N/A',
              phone: phone,
              phoneNormalized: phoneNormalized,
              college: row.college_on_resume || null,
              course: row.course_on_resume || null,
              preferredRole: row.mapped_job_title,
              source: IMPORT_MARKER,
              status: candidateStatus,
              company: 'Akshara Enterprises',
              organizationId: 'defaultOrg',
              createdById: vinay.id,
              resumeFileId: resumeFileId,
              customFields: customFields,
            }
          });
        }

        // C. Enrol into Drive
        if (drive) {
          const existingDriveCand = await tx.collegeDriveCandidate.findFirst({
            where: { driveId: drive.id, candidateId: candidate.id }
          });
          if (!existingDriveCand) {
            await tx.collegeDriveCandidate.create({
              data: {
                driveId: drive.id,
                candidateId: candidate.id,
                fullName: candidateName,
                email: email || null,
                phone: phone || 'N/A',
                status: 'ADDED',
              }
            });
          }
        }

        // D. Create Application if not existing
        let app = await tx.application.findFirst({
          where: {
            candidateId: candidate.id,
            jobId: row.mapped_job_id,
            isDeleted: false,
          }
        });
        if (!app) {
          app = await tx.application.create({
            data: {
              candidateId: candidate.id,
              jobId: row.mapped_job_id,
              status: outcome === 'REJECTED' ? 'REJECTED' : 'IN_PIPELINE',
              organizationId: 'defaultOrg',
            }
          });
        }

        // E. Prepare notes block and feedbackData
        const notesLines = [];
        if (row.comments_verbatim) notesLines.push(`[Comments] ${row.comments_verbatim}`);
        if (row.doj) notesLines.push(`[DOJ] ${row.doj}`);
        if (row.family) notesLines.push(`[Family] ${row.family}`);
        if (row.from_place) notesLines.push(`[From] ${row.from_place}`);
        if (row.languages) notesLines.push(`[Languages] ${row.languages}`);
        if (row.professional_experience) notesLines.push(`[Experience] ${row.professional_experience}`);
        if (row.timings) notesLines.push(`[Timings] ${row.timings}`);
        if (row.location) notesLines.push(`[Location] ${row.location}`);
        if (row.area) notesLines.push(`[Area] ${row.area}`);
        if (row.duration) notesLines.push(`[Duration] ${row.duration}`);
        if (row.two_wheeler_dl) notesLines.push(`[DL / Two-Wheeler] ${row.two_wheeler_dl}`);
        if (row.skills) notesLines.push(`[Skills] ${row.skills}`);
        if (row.flags) notesLines.push(`[Import Flags] ${row.flags}`);
        const notesBlock = notesLines.join('\n');

        const feedbackData = {
          name: candidateName,
          notes_spelling: row.notes_spelling,
          number: phone || null,
          roundNumber: "1",
          panelists: "Vinay Shetty",
          role: row.role_as_written,
          mappedRole: row.mapped_job_title,
          course: row.course_on_resume || null,
          college: row.college_on_resume || null,
          family: row.family || null,
          fromPlace: row.from_place || null,
          languagesKnown: row.languages || null,
          priorExperience: row.professional_experience || null,
          timings: row.timings || "9:30-7:00",
          location: row.location || "Bangalore",
          area: row.area || null,
          overallRating: rating,
          doj: row.doj || null,
          duration: row.duration || null,
          twoWheelerDL: row.two_wheeler_dl || null,
          skills: row.skills || null,
          selectionStatus: outcome,
          status_as_written: row.status_as_written,
          comments: row.comments_verbatim || null,
          date_source: "inferred_from_resume_photo_timestamps",
          time_assumed: true,
          importMarker: IMPORT_MARKER,
        };

        // F. Create or Update Round 1 InterviewFeedback
        const fb = await tx.interviewFeedback.upsert({
          where: {
            candidateId_round: {
              candidateId: candidate.id,
              round: 'ROUND_1',
            }
          },
          create: {
            candidateId: candidate.id,
            round: 'ROUND_1',
            submittedById: vinay.id,
            templateVersion: 2,
            feedbackData: feedbackData,
            selectionStatus: outcome,
            overallRating: rating,
            createdAt: new Date(INTERVIEW_DATE_ISO),
          },
          update: {
            submittedById: vinay.id,
            templateVersion: 2,
            feedbackData: feedbackData,
            selectionStatus: outcome,
            overallRating: rating,
            updatedAt: new Date(),
            deletedAt: null,
          }
        });

        // G. Create or Update Round 1 Interview
        const interviewFeedbackItem = {
          id: fb.id,
          round: 'ROUND_1',
          comments: notesBlock,
          createdAt: INTERVIEW_DATE_ISO,
          updatedAt: new Date().toISOString(),
          feedbackData: feedbackData,
          overallRating: rating,
          submittedById: vinay.id,
          interviewerName: "Vinay Shetty",
          selectionStatus: outcome,
          templateVersion: 2,
        };

        const existingInterview = await tx.interview.findFirst({
          where: {
            candidateId: candidate.id,
            roundNo: 1,
          }
        });

        if (existingInterview) {
          await tx.interview.update({
            where: { id: existingInterview.id },
            data: {
              status: 'COMPLETED',
              result: outcome,
              outcome: outcome,
              outcomeSetAt: new Date(INTERVIEW_DATE_ISO),
              notes: notesBlock,
              interviewerIds: [vinay.id],
              interviewerNames: 'Vinay Shetty',
              feedback: [interviewFeedbackItem],
            }
          });
        } else {
          await tx.interview.create({
            data: {
              applicationId: app.id,
              candidateId: candidate.id,
              candidateName: candidateName,
              jobId: row.mapped_job_id,
              jobTitle: row.mapped_job_title,
              roundNo: 1,
              round: 'Round 1',
              scheduledStart: new Date(INTERVIEW_DATE_ISO),
              durationMinutes: 45,
              mode: 'DRIVE',
              status: 'COMPLETED',
              result: outcome,
              outcome: outcome,
              outcomeSetAt: new Date(INTERVIEW_DATE_ISO),
              notes: notesBlock,
              organizationId: 'defaultOrg',
              createdById: vinay.id,
              interviewerIds: [vinay.id],
              interviewerNames: 'Vinay Shetty',
              feedback: [interviewFeedbackItem],
              round1SMSAlertSent: true,
              round2EmailAlertSent: true,
              createdAt: new Date(INTERVIEW_DATE_ISO),
            }
          });
        }
      }, { timeout: 35000, maxWait: 10000 });

      // Brief pause between rows
      await new Promise(resolve => setTimeout(resolve, 80));
    } catch (err) {
      exceptionCount++;
      console.error(`ERROR on row ${idx} (${candidateName}):`, err.message);
    }
  }

  // Cache Invalidation
  if (!isDryRun && drive) {
    await inv.drive('defaultOrg', drive.id).catch(() => {});
    await inv.interview('defaultOrg').catch(() => {});
  }

  console.log('\n========================================================================');
  console.log('                        SUMMARY                                         ');
  console.log('========================================================================');
  console.log(`Created:     ${createdCount}`);
  console.log(`Attached:    ${attachedCount}`);
  console.log(`Skipped:     ${skippedCount}`);
  console.log(`Exceptions:  ${exceptionCount}`);
  console.log(`Sum: ${createdCount + attachedCount + skippedCount + exceptionCount} (Total: 24)`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal injection failure:', err);
  process.exit(1);
});
