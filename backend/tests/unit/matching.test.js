'use strict';

const { validateResumeBuffer } = require('../../src/modules/matching/fileValidator');
const { scoreResumeAgainstJd } = require('../../src/modules/matching/scorer');
const { normalizeText } = require('../../src/modules/matching/cleaner');
const { redactPii } = require('../../src/modules/matching/structuredExtractor');

describe('Resume Parsing & JD Match Scoring Unit Tests', () => {

  describe('1. File Validator & Magic Bytes', () => {
    test('Validates authentic PDF magic bytes (%PDF)', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%Test PDF file content...');
      const res = validateResumeBuffer(pdfBuffer, 'resume.pdf');
      expect(res.isValid).toBe(true);
      expect(res.format).toBe('pdf');
      expect(res.mimeType).toBe('application/pdf');
    });

    test('Validates authentic DOCX magic bytes (PK\\x03\\x04)', () => {
      const docxHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const res = validateResumeBuffer(docxHeader, 'resume.docx');
      expect(res.isValid).toBe(true);
      expect(res.format).toBe('docx');
      expect(res.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

    test('Rejects executable or unknown formats', () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
      const res = validateResumeBuffer(exeBuffer, 'resume.exe');
      expect(res.isValid).toBe(false);
      expect(res.format).toBe('unsupported');
    });

    test('Rejects empty 0-byte buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      const res = validateResumeBuffer(emptyBuffer, 'empty.pdf');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('0 bytes');
    });
  });

  describe('2. Text Cleaner & Ligatures', () => {
    test('Normalizes Unicode ligatures, curved quotes, and line-end hyphens', () => {
      const messyText = 'Speci\uFB01c coordi-\nnation for \u2018Atlasia\u2019 \u2022 Event lead';
      const clean = normalizeText(messyText);
      expect(clean).toContain('Specific');
      expect(clean).toContain('coordination');
      expect(clean).toContain("'Atlasia'");
      expect(clean).toContain('- Event lead');
    });
  });

  describe('3. PII Redaction', () => {
    test('Redacts Indian phone numbers and emails completely', () => {
      const resume = 'Candidate John Doe, email john.doe@example.com, mobile +919876543210. Location: Bangalore.';
      const redacted = redactPii(resume);
      expect(redacted).not.toContain('john.doe@example.com');
      expect(redacted).not.toContain('9876543210');
      expect(redacted).toContain('[EMAIL_REDACTED]');
      expect(redacted).toContain('[PHONE_REDACTED]');
    });
  });

  describe('4. Scoring Engine & Sub-scores', () => {
    const mockJdVersion = {
      structuredRequirements: {
        core: 'Lead generation, client interaction, sales pitching, customer relationship',
        must_have: [
          {'skill': 'Communication', 'weight': 1.0, 'category': 'leadership_signals'},
          {'skill': 'Lead generation', 'weight': 1.0, 'category': 'sales_bd'},
          {'skill': 'Client interaction', 'weight': 1.0, 'category': 'sales_bd'}
        ],
        nice_to_have: [
          {'skill': 'B2B / B2C sales', 'weight': 0.8, 'category': 'sales_bd'},
          {'skill': 'Negotiation', 'weight': 0.7, 'category': 'sales_bd'}
        ],
        education: {
          degrees: ['BBA', 'BCom', 'MBA'],
          min_credit_other_degree: 50
        }
      },
      weights: {
        education: 15,
        experience: 25,
        skills: 25,
        communicationLeadership: 15,
        semantic: 10,
        careerInterest: 10
      }
    };

    test('Awards 100 for Business degrees and partial 50 for Engineering degrees', () => {
      const businessResume = {
        rawText: 'BBA graduate with experience in lead generation and client interaction.',
        summary: 'Passionate about sales and business development.',
        education: [{ degree: 'BBA', isBusiness: true, status: 'completed' }],
        experience: [{ title: 'Sales Intern', bullets: ['Lead generation', 'Client interaction'], customerFacing: true }],
        leadership: [{ role: 'Fest Coordinator', evidence: ['Organized annual college fest'] }],
        derived: { totalExperienceMonths: 6, customerFacingMonths: 6, isFinalYearOrFresher: true }
      };

      const bbaScore = scoreResumeAgainstJd(businessResume, mockJdVersion, 'BDE Intern');
      expect(bbaScore.subScores.educationFit).toBe(100);

      const engineeringResume = {
        ...businessResume,
        education: [{ degree: 'BE', isBusiness: false, status: 'completed' }]
      };
      const beScore = scoreResumeAgainstJd(engineeringResume, mockJdVersion, 'BDE Intern');
      expect(beScore.subScores.educationFit).toBe(50);
      expect(beScore.overall).toBeLessThan(bbaScore.overall);
    });

    test('FAIRNESS INVARIANCE: Modifying name, gender, photo or marital status never alters score', () => {
      const baseResume = {
        rawText: 'Skills: Lead generation, client interaction, B2B sales. Event Coordinator.',
        summary: 'Seeking BDE role.',
        education: [{ degree: 'BCom', isBusiness: true, status: 'completed' }],
        experience: [{ title: 'Sales Intern', bullets: ['Lead generation and client communication'], customerFacing: true }],
        leadership: [{ role: 'Event Coordinator', evidence: ['Managed campus fest'] }],
        derived: { totalExperienceMonths: 4, customerFacingMonths: 4, isFinalYearOrFresher: true }
      };

      const score1 = scoreResumeAgainstJd({
        ...baseResume,
        contact: { name: 'Rahul Sharma', gender: 'Male', maritalStatus: 'Single', hometown: 'Delhi' }
      }, mockJdVersion, 'BDE Intern');

      const score2 = scoreResumeAgainstJd({
        ...baseResume,
        contact: { name: 'Priya Patel', gender: 'Female', maritalStatus: 'Married', hometown: 'Mysore' }
      }, mockJdVersion, 'BDE Intern');

      expect(score1.overall).toBe(score2.overall);
      expect(score1.ratingOutOf10).toBe(score2.ratingOutOf10);
      expect(score1.subScores).toEqual(score2.subScores);
    });
  });

});
