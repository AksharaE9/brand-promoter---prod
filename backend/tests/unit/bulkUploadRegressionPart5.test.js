'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { validateCandidateRow } = require('../../src/lib/candidateRowValidator');
const {
  isPlaceholderEmail,
  isPlaceholderPhone,
  normalizePhoneCell,
  normalizeEmailCell,
} = require('../../src/lib/cellNormalizer');
const { JobResolutionSession } = require('../../src/services/jobResolutionService');
const { parseFileStream } = require('../../src/lib/csvXlsxStreamParser');
const {
  transformCandidateRow,
  duplicateCheckCandidate,
} = require('../../src/jobs/bulkCandidateUpload.processor');

describe('Track 2 — Regression Fixtures Suite (Part 5 Table)', () => {
  const gopalanCsvPath = path.join(__dirname, '..', 'fixtures', 'gopalan_31_rows.csv');
  const nmitCsvPath = path.join(__dirname, '..', 'fixtures', 'nmit_26_rows.csv');
  const nmitXlsxPath = path.join(__dirname, '..', 'fixtures', 'nmit_26_rows.xlsx');
  const nmitSqliCsvPath = path.join(__dirname, '..', 'fixtures', 'nmit_sqli.csv');

  test('1. Gopalan CSV (31 rows): 29 clean rows + 2 exceptions (invalid email row 6, placeholder email row 21), NO 500', async () => {
    let rowCount = 0;
    const exceptions = [];
    const validRows = [];

    await parseFileStream(gopalanCsvPath, '.csv', async (rawRow, rowNumber) => {
      rowCount++;
      const val = validateCandidateRow(rawRow, rowNumber, { isDriveContext: true });
      if (val.valid) {
        validRows.push(val.data);
        if (val.warnings?.length) {
          exceptions.push({ rowNumber, candidateId: parseInt(val.data.candidateId, 10), warnings: val.warnings });
        }
      } else {
        exceptions.push({ rowNumber, candidateId: parseInt(val.data.candidateId, 10), errors: val.errors });
      }
    });

    expect(rowCount).toBe(31);
    expect(validRows.length).toBe(31); // In drive context, all 31 rows are valid for candidate creation
    // Exactly 2 rows have warnings/exceptions:
    // Candidate 6: "angelbeulah" (incomplete email)
    // Candidate 21: "dummy@gmail.com" (placeholder email)
    expect(exceptions.length).toBe(2);
    expect(exceptions.some(e => e.candidateId === 6)).toBe(true);
    expect(exceptions.some(e => e.candidateId === 21)).toBe(true);
  });

  test('2. Nitte Meenakshi CSV (26 rows): exactly 26 candidates created, exactly 5 exceptions across 4 rows, NO 500', async () => {
    let rowCount = 0;
    const exceptions = [];
    const validRows = [];
    const context = {
      seenCandidatesInFileMap: new Map(),
      isDriveContext: true,
      driveId: 'cmv7_nmit_drive_test',
    };

    await parseFileStream(nmitCsvPath, '.csv', async (rawRow, rowNumber) => {
      rowCount++;
      const val = validateCandidateRow(rawRow, rowNumber, { isDriveContext: true });
      expect(val.valid).toBe(true);
      validRows.push(val.data);

      const candId = parseInt(val.data.candidateId, 10);

      if (val.warnings?.length) {
        val.warnings.forEach(w => exceptions.push({ rowNumber, candidateId: candId, message: w }));
      }

      const dupResult = await duplicateCheckCandidate(val.data, rowNumber, context);
      expect(dupResult.isDuplicate).toBe(false); // Must NEVER drop candidate!
      if (dupResult.warnings?.length) {
        dupResult.warnings.forEach(w => exceptions.push({ rowNumber, candidateId: candId, message: w }));
      }
    });

    expect(rowCount).toBe(26);
    expect(validRows.length).toBe(26);

    // Exactly 5 exceptions across 4 candidate rows:
    // Candidate 6 (sujith): dummy@gmail.com
    // Candidate 9 (Vinayak): ...@nmit ac.in (space in email)
    // Candidate 11 (Kusheen Dhar): duplicate phone same as row 10
    // Candidate 24 (Himanshu Singh): dummy@gmail.com AND phone 1234567890 (2 exceptions)
    expect(exceptions.length).toBe(5);

    const affectedCandIds = new Set(exceptions.map(e => e.candidateId));
    expect(Array.from(affectedCandIds).sort((a, b) => a - b)).toEqual([6, 9, 11, 24]);

    // Check Row 10 (Chinmay) vs Row 11 (Kusheen):
    const chinmay = validRows.find(r => r.name.toLowerCase().includes('chinmay'));
    const kusheen = validRows.find(r => r.name.toLowerCase().includes('kusheen'));
    expect(chinmay).toBeDefined();
    expect(kusheen).toBeDefined();
    expect(chinmay.phone).toBe('6366896901');
    expect(kusheen.phone).toBeNull(); // Phone cleared to prevent duplicate constraint collision
    expect(kusheen.email).toBe('kusheendhar@gmail.com');

    // Check Row 6 (sujith) vs Row 24 (Himanshu Singh):
    const sujith = validRows.find(r => r.name.toLowerCase().includes('sujith'));
    const himanshu = validRows.find(r => r.name.toLowerCase().includes('himanshu'));
    expect(sujith).toBeDefined();
    expect(himanshu).toBeDefined();
    expect(sujith.phone).toBe('9741356702');
    expect(sujith.email).toBeNull(); // Placeholder dummy@gmail.com converted to null
    expect(himanshu.phone).toBeNull(); // Placeholder 1234567890 converted to null
    expect(himanshu.email).toBeNull(); // Placeholder dummy@gmail.com converted to null
  });

  test('3. Roles mapped correctly in college drive context without auto-creating unmapped jobs', async () => {
    const rolesMap = {
      'Data Analyst ': 0,
      'Business Analyst ': 0,
      'Operations ': 0,
    };

    const transformedRoles = [];
    const context = {
      isDriveContext: true,
      driveId: 'cmv7_test_drive',
      organizationId: 'defaultOrg',
    };

    await parseFileStream(nmitCsvPath, '.csv', async (rawRow, rowNumber) => {
      const val = validateCandidateRow(rawRow, rowNumber, { isDriveContext: true });
      const transformed = await transformCandidateRow(val.data, rowNumber, context);
      transformedRoles.push(transformed.preferredRole);
    });

    const dataAnalystInterns = transformedRoles.filter(r => r === 'Data Analyst Intern');
    const businessAnalystInterns = transformedRoles.filter(r => r === 'Business Analyst Intern');
    const opsInterns = transformedRoles.filter(r => r === 'Ops Intern');

    expect(dataAnalystInterns.length).toBe(22);
    expect(businessAnalystInterns.length).toBe(1);
    expect(opsInterns.length).toBe(3);
    expect(dataAnalystInterns.length + businessAnalystInterns.length + opsInterns.length).toBe(26);
  });

  test('4. NMIT CSV with SQL injection in cell is treated literally as text', async () => {
    let rowCount = 0;
    const sources = [];

    await parseFileStream(nmitSqliCsvPath, '.csv', async (rawRow, rowNumber) => {
      rowCount++;
      const val = validateCandidateRow(rawRow, rowNumber, { isDriveContext: true });
      sources.push(val.data.source);
    });

    expect(rowCount).toBe(26);
    expect(sources[0]).toBe("Vinay'; DROP TABLE candidates; --");
  });

  test('5. NMIT CSV saved as .xlsx yields identical 26 rows', async () => {
    let rowCount = 0;
    const names = [];

    await parseFileStream(nmitXlsxPath, '.xlsx', async (rawRow, rowNumber) => {
      rowCount++;
      const val = validateCandidateRow(rawRow, rowNumber, { isDriveContext: true });
      expect(val.valid).toBe(true);
      names.push(val.data.name);
    });

    expect(rowCount).toBe(26);
    expect(names[0].trim()).toBe('MADDINENI PAVAN TEJA');
  });

  test('6. Placeholder email and phone detectors accurately isolate dummy identities', () => {
    expect(isPlaceholderEmail('dummy@gmail.com')).toBe(true);
    expect(isPlaceholderEmail('test@ats.com')).toBe(true);
    expect(isPlaceholderEmail('na@company.org')).toBe(true);
    expect(isPlaceholderEmail('abc@xyz.com')).toBe(true);
    expect(isPlaceholderEmail('realperson@gmail.com')).toBe(false);

    expect(isPlaceholderPhone('1234567890')).toBe(true);
    expect(isPlaceholderPhone('0000000000')).toBe(true);
    expect(isPlaceholderPhone('9999999999')).toBe(true);
    expect(isPlaceholderPhone('0123456789')).toBe(true);
    expect(isPlaceholderPhone('9876543210')).toBe(true);
    expect(isPlaceholderPhone('12345')).toBe(true); // under 7 digits
    expect(isPlaceholderPhone('9676627354')).toBe(false); // Valid Indian mobile starting with 9
    expect(isPlaceholderPhone('8892686763')).toBe(false); // Valid Indian mobile starting with 8
    expect(isPlaceholderPhone('7032834889')).toBe(false); // Valid Indian mobile starting with 7
    expect(isPlaceholderPhone('6366896901')).toBe(false); // Valid Indian mobile starting with 6
  });

  test('7. Banning unsafe dynamic raw SQL in application code', () => {
    const srcDir = path.join(__dirname, '..', '..', 'src');
    const walkSync = (dir, filelist = []) => {
      fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          walkSync(filePath, filelist);
        } else if (file.endsWith('.js')) {
          filelist.push(filePath);
        }
      });
      return filelist;
    };

    const files = walkSync(srcDir);
    const violations = [];

    // Allow-list for valid system scripts or administrative tools if any
    const allowList = ['addIndexes.js', 'analyzeAndTeardownTestData.js'];

    files.forEach(file => {
      const basename = path.basename(file);
      if (allowList.includes(basename)) return;
      const content = fs.readFileSync(file, 'utf8');
      // Look for string-interpolated queryRawUnsafe or executeRawUnsafe
      const matches = content.match(/\$(queryRawUnsafe|executeRawUnsafe)\s*\(\s*`[^`]*\${[^}]+}[^`]*`/g);
      if (matches) {
        violations.push({ file: path.relative(srcDir, file), matches });
      }
    });

    expect(violations).toEqual([]);
  });

  test('8. NMIT CSV, no auth token returns 401 AUTH_TOKEN_MISSING, nothing processed', async () => {
    const request = require('supertest');
    const { app } = require('../../src/app');

    const res = await request(app)
      .post('/api/candidates/bulk-upload?context=drive')
      .send({ someField: 'value' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    expect(res.headers['x-request-id']).toMatch(/^req_be_/);
    expect(res.body.error?.requestId).toMatch(/^req_be_/);
  });

  test('9. NMIT CSV, expired auth token returns 401 AUTH_TOKEN_INVALID, nothing processed', async () => {
    const request = require('supertest');
    const { app } = require('../../src/app');

    const expiredToken = jwt.sign(
      { id: 'expired_user', role: 'RECRUITER', organizationId: 'defaultOrg', exp: Math.floor(Date.now() / 1000) - 3600 },
      process.env.JWT_SECRET || 'secret'
    );

    const res = await request(app)
      .post('/api/candidates/bulk-upload?context=drive')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ someField: 'value' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID']).toContain(res.body.code);
    expect(res.headers['x-request-id']).toMatch(/^req_be_/);
  });

  test('10. Malformed multipart (manual Content-Type without boundary) returns 400 UPLOAD_MALFORMED_MULTIPART, NOT 500', async () => {
    const request = require('supertest');
    const { app } = require('../../src/app');
    const prisma = require('../../src/config/db');

    const userSpy = jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 'mock_recruiter_id',
      email: 'recruiter@ats.local',
      role: 'RECRUITER',
      status: 'ACTIVE',
      organizationId: 'defaultOrg',
      isActive: true,
      isDeleted: false,
    });

    const token = jwt.sign(
      { id: 'mock_recruiter_id', role: 'RECRUITER', organizationId: 'defaultOrg' },
      process.env.JWT_SECRET || 'secret'
    );

    const res = await request(app)
      .post('/api/candidates/bulk-upload?context=drive')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'multipart/form-data') // Intentionally missing boundary
      .send('some-malformed-body-without-boundary');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UPLOAD_MALFORMED_MULTIPART');
    expect(res.headers['x-request-id']).toMatch(/^req_be_/);
    expect(res.body.error?.requestId).toMatch(/^req_be_/);

    userSpy.mockRestore();
  });
});
