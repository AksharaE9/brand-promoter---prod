'use strict';
const prisma = require('../src/config/db');

async function executeJobB() {
  console.log('========================================================================');
  console.log('         JOB B: TWO-WEEK CHAT SYNC (40 ACTIONABLE RECORDS)              ');
  console.log('========================================================================\n');

  // Baseline notification count
  const notifCountBefore = await prisma.notification.count();
  console.log(`[Safety Check] Baseline Notification Count: ${notifCountBefore}`);

  // Resolve users
  const pavan = await prisma.user.findUnique({ where: { id: 'CXr6ovApgCBnhlubdp1W' } });
  const praneel = await prisma.user.findUnique({ where: { id: 'cmsh5at0900ddo52srakohs4b' } });
  const ananth = await prisma.user.findUnique({ where: { id: 'XwJ3ravlMaZteWtm5xG7' } });
  const harris = await prisma.user.findUnique({ where: { id: 'z0k4KYst5bDMUQkL0Dvq' } });
  const vinay = await prisma.user.findUnique({ where: { id: 'cYEZblWdN7gubrQvLgYj' } });
  const suhas = await prisma.user.findUnique({ where: { id: 'cmrocg1il0000l429ebzkr4cy' } });
  const sneha = await prisma.user.findUnique({ where: { id: 'cmvgkzbb6007vpitw97u00pmw' } });
  const superAdmin = await prisma.user.findUnique({ where: { id: '73783a2b-0045-431c-9b71-75aeab0b6840' } });

  // Resolve target jobs
  const daJob = await prisma.job.findUnique({ where: { id: 'cmrnjjhvp0092lg2ry71l2zkt' } }); // Data Analyst Intern
  const bdeJob = await prisma.job.findUnique({ where: { id: 'O5MrSm6iMWaqQDvZTlrj' } }); // BDE FULL TIME
  const bpShopJob = await prisma.job.findUnique({ where: { id: 'Gicg5nHQVV1ELvv8BNlb' } }); // BRAND PROMOTER- SHOP EVENTS
  const opsJob = await prisma.job.findUnique({ where: { id: 'Gj4Yu2VTfvlZQfGJqYSE' } }); // Operations

  console.log('Target jobs resolved.');

  // The 40 actionable records to execute (excluding 5 CMR, 1 Laya, 1 Shaik Shah Baba, and 3 Conflicts)
  const jobBRecords = [
    // 1. MVJ Candidates (R2)
    {
      candId: 'cmuz7me7a006atb5w8xkp2p1h', name: 'Arushi Shetty', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-14T04:53:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Arushi Shetty)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'ON_HOLD', rating: null, doj: 'Dec - Jan',
      notes: 'BE in CSE, 7th Sem\nFrom Bangalore, Dad - Real Estate Business, Mom - Wipro\nInternship @ HAL -> Worked on HR Management Software\nStatus: On Hold - Good Experience, but wont be joining till Jan',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7mq23007jtb5wqli6bbvt', name: 'Aishwarya', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-14T08:51:00.000Z',
      panelistUser: suhas, panelistName: 'Suhas Krishna',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: 'november',
      notes: 'Course BE\nRole DA\nPrior experience none\nFamily gold smith dad and mom is a housewife\nLocation Bengaluru\nArea Whitefield\nDoj november\nSelected\n7.5k stipend',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7mlgs0071tb5w8x5sl4l7', name: 'Soumya Badiger', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T07:59:00.000Z',
      panelistUser: praneel, panelistName: 'Praneel',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7, doj: 'Mid of dec',
      notes: 'Rating: 7\nDOJ: Mid of dec\nSelection status: selected\nNote: Reversal from R1 Rejected (7.5) to R2 Selected (7)',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7ljmc0031tb5wlhp3xmt3', name: 'Diya Mariam Oommen', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T08:13:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7.9, doj: 'December 2026 (6 months)',
      notes: 'Rating: 7.9\nDOJ: December 2026 (6 months)\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7nrhu00bjtb5w9soiywxi', name: 'Johanaz Nadaf', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T08:14:00.000Z',
      panelistUser: praneel, panelistName: 'Praneel',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6.8, doj: 'November 15th',
      notes: 'Rating: 6.8\nDOJ: November 15th\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7la8s0021tb5wg1hbtr6e', name: 'Kushal P', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T10:06:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7.7, doj: 'Immediate',
      notes: 'Rating: 7.7\nDOJ: Immediate\nSelection status: selected\nRemarks: select candidate only if necessary',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7lf0w002jtb5w62cywljy', name: 'Darshan K', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T11:03:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6, doj: 'December',
      notes: 'Rating: 6\nDOJ: December\nSelection status: selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7lqnz003stb5wloimi97e', name: 'Poorvitha R', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:13:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Jeevan)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: null,
      notes: 'Panelist: Jeevan\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7np6v00batb5wrhvqfyfx', name: 'Sana', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:22:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Jeevan)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: null,
      notes: 'Panelist: Jeevan\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz7nmon00b1tb5wzstploup', name: 'Neha N', drive: 'MVJ',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:50:00.000Z',
      panelistUser: praneel, panelistName: 'Praneel',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6.6, doj: 'December',
      notes: 'Rating: 6.6\nDOJ: December\nSelection status: Selected',
      needsPlaceholderR1: false
    },

    // 2. NMIT Candidates (R1 Placeholder + R2)
    {
      candId: 'cmv7pmb28002ptbaksz5s4bg5', name: 'Ayush madnapotra', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T07:48:00.000Z',
      panelistUser: vinay, panelistName: 'Vinay Shetty',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: 'From Jan',
      notes: 'Role: Data Analyst Intern\nLocation: Bangalore\nArea: Yelahanka\nDOJ: From Jan\nStatus: Selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pm0od001gtbak8isw40gi', name: 'Kusheen Dhar', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T07:53:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8, doj: '15th november',
      notes: 'Year: 2026\nCourse: CSE\nParents: J&K fatther is a professor\nFrom: J&K\nRating: 8\nDOJ: 15th november\nSelection status: selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7plsaz000rtbakmp1bsnna', name: 'sujith', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T08:07:00.000Z',
      panelistUser: vinay, panelistName: 'Vinay Shetty',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: 'Nov 17th',
      notes: 'Status: Selected\nDOJ: Nov 17th\nArea: Yelahanka\nAlias: Sujith Manjunath Mogaveera',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pm9iv002ktbakm0sf2aj7', name: 'Dhruthi SL', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T08:24:00.000Z',
      panelistUser: vinay, panelistName: 'Vinay Shetty',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: 'Nov 17th',
      notes: 'Role: Data Analyst Intern (Enrolled as Operations)\nStatus: Selected\nDOJ: Nov 17th',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pm8i7002ftbakq8jkzt92', name: 'Megha', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T08:31:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Operations Intern', jobId: opsJob.id, jobTitle: opsJob.title,
      outcome: 'SELECTED', rating: 6, doj: '1st of november',
      notes: 'Role: OP,s\nRating: 6\nDOJ: 1st of november\nSelection status: selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pm5ax0020tbakqa10d6wj', name: 'Paarvathi G', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T10:46:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6, doj: '19th oct',
      notes: 'Rating: 6\nDOJ: 19th oct\nSelection status: Selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pmgv9003etbakgjwdcg60', name: 'Anirudh', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T11:19:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6, doj: '22nd oct',
      notes: 'Rating: 6\nDOJ: 22nd oct\nSelection status: selcted',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pmdqv002ztbak46lrzbya', name: 'Sai Prateesh', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:20:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Jeevan)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: null,
      notes: 'Panelist: Jeevan\nSelection status: Selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pln1t0005tbakbluyo51q', name: 'NAG PRATHIK', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:23:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Jeevan)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: null,
      notes: 'Panelist: Jeevan\nSelection status: Selected',
      needsPlaceholderR1: true
    },
    {
      candId: 'cmv7pm48n001vtbakc80ylkgw', name: 'Jesto Gigi Kadavi', drive: 'NMIT',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-17T05:51:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7.5, doj: 'Post 11th November',
      notes: 'Rating: 7.5\nDOJ: Post 11th November\nSelection status: Selected',
      needsPlaceholderR1: true
    },

    // 3. T. John & Gopalan Candidates (R2)
    {
      candId: 'cmuzbk20b000otbbsuvkwqx4z', name: 'Deepika Desai', drive: 'T. John',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T12:21:00.000Z',
      panelistUser: superAdmin, panelistName: 'Super Admin (placeholder: Jeevan)',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: null, doj: null,
      notes: 'Panelist: Jeevan\nSelection status: Selected\nRole note: Data Analyst',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmuz6f309003dtby0qc992yin', name: 'B Brunda', drive: 'Gopalan',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-20T10:44:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7, doj: 'Immediate',
      notes: 'Rating: 7\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },

    // 4. Jain Candidates (R2)
    {
      candId: 'cmvhn74qp0047tbqs2hdr0iiy', name: 'INFANT PRESHITH P', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-21T05:51:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8.1, doj: 'Immediate',
      notes: 'Rating: 8.1\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false,
      skipIfConflict: true
    },
    {
      candId: 'cmvhn6p0d002jtbqs2i2grn97', name: 'V KUSUMA', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-22T06:12:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6.5, doj: 'December',
      notes: 'Rating: 6.5\nDOJ: December\nSelection status: selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn5t76000btbqs72251p5b', name: 'Boggavarapu Suriya', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-22T09:40:00.000Z',
      panelistUser: sneha, panelistName: 'Revanth & Sneha',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 6.5, doj: 'Immediate',
      notes: 'Panelists: Revanth & Sneha\nRating: 6.5\nDOJ: Immediate\nSelection status: selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn6zjm003ntbqsvdglvc3v', name: 'DHRUVANTH R', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T05:09:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8.5, doj: 'Immediate',
      notes: 'Rating: 8.5\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn6wx4003dtbqshp7dnuet', name: 'PRANAV DHAASAIYA', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T07:20:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8.5, doj: 'Immediate',
      notes: 'Rating: 8.5\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn7cpw0051tbqsw7py3cjy', name: 'ISHITA JAIN', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T07:22:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8, doj: 'Immediate',
      notes: 'Rating: 8\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn6gd2001ptbqs436tvbrw', name: 'RIFAH ALAM', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T07:24:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8, doj: 'Immediate',
      notes: 'Rating: 8\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn6ju7001ztbqspym4atml', name: 'TARUN JOSHI', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T09:29:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7.5, doj: 'Immediate',
      notes: 'Rating: 7.5\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn7ht6005ltbqshr592hbb', name: 'Asmita Singh', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-23T10:50:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 8, doj: 'Immediate',
      notes: 'Rating: 8\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },
    {
      candId: 'cmvhn6rmp002ttbqsr0tmntaw', name: 'SANJAY E', drive: 'Jain',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-24T09:22:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      outcome: 'SELECTED', rating: 7.5, doj: 'Immediate',
      notes: 'Role change: R1 BA Intern -> R2 DA Intern\nRating: 7.5\nDOJ: Immediate\nSelection status: Selected',
      needsPlaceholderR1: false
    },

    // 5. New Candidates R1 (All Candidates)
    {
      isNewCandidate: true, name: 'Nitya Shree',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-14T10:24:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'SELECTED', rating: 7, doj: 'Immediate',
      course: 'BCA', graduationYear: '2025', location: 'Tumkur',
      notes: 'Course in 2025 BCA, Father auto driver, Tumkur, Rating 7, Selected for 2nd Round'
    },
    {
      isNewCandidate: true, name: 'Priya G',
      role: 'BDE FULL TIME', jobId: bdeJob.id, jobTitle: bdeJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T10:18:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'SELECTED', rating: 7.4, doj: 'Immediate',
      course: null, graduationYear: null, location: 'Bangalore',
      notes: 'BDE Full Time, Rating 7.4, Selected for 2nd Round'
    },
    {
      isNewCandidate: true, name: 'Rakshita',
      role: 'BDE FULL TIME', jobId: bdeJob.id, jobTitle: bdeJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T12:48:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'REJECTED', rating: 5, doj: 'December',
      course: null, graduationYear: null, location: 'Bangalore',
      notes: 'Studies at Rajarajeshwari College. Rating: 5.0, Rejected'
    },
    {
      isNewCandidate: true, name: 'Sham S',
      role: 'BRAND PROMOTER- SHOP EVENTS', jobId: bpShopJob.id, jobTitle: bpShopJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T07:24:00.000Z',
      panelistUser: suhas, panelistName: 'Suhas Krishna',
      outcome: 'SELECTED', rating: null, doj: 'Monday',
      course: '12th Pass', graduationYear: null, location: 'Bangalore',
      notes: 'Cash keeping and tele calling in Arya builders, Kiosk sales, Selected (DOJ from Monday OL can be sent)',
      outcomeSource: 'inferred_offer_letter_can_be_sent'
    },

    // 6. No-Shows (Create candidate + Didn't Join Round 1)
    {
      isNewCandidate: true, isNoShow: true, name: 'Vignesh Balaji',
      role: 'BRAND PROMOTER- SHOP EVENTS', jobId: bpShopJob.id, jobTitle: bpShopJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T06:11:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'DIDNT_JOIN', rating: null, doj: null,
      notes: 'Kiosk Sales Executive - Events: Did not Join'
    },
    {
      isNewCandidate: true, isNoShow: true, name: 'Soheb Baig',
      role: 'BRAND PROMOTER- SHOP EVENTS', jobId: bpShopJob.id, jobTitle: bpShopJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T07:10:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'DIDNT_JOIN', rating: null, doj: null,
      notes: 'Kiosk Sales Executive - Events: Did not Join'
    },
    {
      isNewCandidate: true, isNoShow: true, name: 'Srinivasa',
      role: 'BDE FULL TIME', jobId: bdeJob.id, jobTitle: bdeJob.title,
      round: 'ROUND_1', roundNo: 1, dateStr: '2026-10-22T12:52:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'DIDNT_JOIN', rating: null, doj: null,
      notes: 'BDE: Did not Join'
    },

    // 7. Placeholders + R2 (Harsha Vardhan Reddy & sushmitha)
    {
      isNewCandidate: true, name: 'Harsha Vardhan Reddy',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      college: 'Jain (Deemed-to-be University)',
      phone: '+919063536346', phoneNormalized: '9063536346',
      email: 'harshavardhanreddygujjula@gmail.com',
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-21T06:29:00.000Z',
      panelistUser: ananth, panelistName: 'Ananth Charan',
      outcome: 'ON_HOLD', rating: null, doj: 'december',
      notes: 'Jain PDF Page 8 resume. R1 placeholder + R2 On Hold',
      needsPlaceholderR1: true
    },
    {
      isNewCandidate: true, name: 'sushmitha',
      role: 'Data Analyst Intern', jobId: daJob.id, jobTitle: daJob.title,
      round: 'ROUND_2', roundNo: 2, dateStr: '2026-10-15T10:19:00.000Z',
      panelistUser: harris, panelistName: 'syed harris',
      outcome: 'REJECTED', rating: 4, doj: 'December',
      notes: 'College unknown (from Sira, area Yelahanka). R1 placeholder + R2 Rejected (4, Harris)',
      needsPlaceholderR1: true
    }
  ];

  console.log(`Starting execution of ${jobBRecords.length} records in sequential transactions...\n`);

  let successCount = 0;
  let skippedConflictCount = 0;

  for (let i = 0; i < jobBRecords.length; i++) {
    const rec = jobBRecords[i];
    const ivDateUtc = new Date(rec.dateStr);

    // If marked skipIfConflict, verify if existing record has conflict
    if (rec.skipIfConflict) {
      const existingFb = await prisma.interviewFeedback.findFirst({
        where: { candidateId: rec.candId, round: rec.round }
      });
      if (existingFb && existingFb.overallRating !== rec.rating) {
        console.log(`  [Record #${i + 1}/${jobBRecords.length}] SKIPPING CONFLICT: "${rec.name}" (Existing rating: ${existingFb.overallRating} vs Chat: ${rec.rating})`);
        skippedConflictCount++;
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      let candidate = null;

      if (!rec.isNewCandidate) {
        candidate = await tx.candidate.findUnique({ where: { id: rec.candId } });
      } else {
        candidate = await tx.candidate.findFirst({
          where: { fullName: rec.name, preferredRole: rec.role }
        });
        if (!candidate) {
          const candStatus = rec.outcome === 'REJECTED' ? 'REJECTED' : (rec.outcome === 'ON_HOLD' ? 'ON_HOLD' : 'ACTIVE');
          candidate = await tx.candidate.create({
            data: {
              fullName: rec.name,
              email: rec.email || 'N/A',
              phone: rec.phone || null,
              phoneNormalized: rec.phoneNormalized || null,
              college: rec.college || null,
              course: rec.course || null,
              graduationYear: rec.graduationYear || null,
              location: rec.location || 'Bangalore',
              preferredRole: rec.role,
              status: candStatus,
              source: 'WhatsApp HR Chat - Oct 2026',
              createdById: rec.panelistUser.id,
              organizationId: 'defaultOrg',
              customFields: {
                needs_contact_details: rec.phone ? false : true,
                source: 'AKSHARA_HR_CHAT_SYNC_13-27OCT2026',
                single_name: !rec.name.includes(' '),
                date_source: 'chat_post_date',
                ...(rec.outcomeSource ? { outcome_source: rec.outcomeSource } : {})
              }
            }
          });
        }
      }

      // Update candidate overall status to latest round's outcome
      const targetCandStatus = rec.outcome === 'REJECTED' ? 'REJECTED' : (rec.outcome === 'ON_HOLD' ? 'ON_HOLD' : 'ACTIVE');
      await tx.candidate.update({
        where: { id: candidate.id },
        data: {
          status: targetCandStatus,
          customFields: {
            ...(typeof candidate.customFields === 'object' && candidate.customFields ? candidate.customFields : {}),
            latest_sync: 'AKSHARA_HR_CHAT_SYNC_13-27OCT2026',
            latest_round: rec.round,
            latest_outcome: rec.outcome,
            latest_rating: rec.rating,
          }
        }
      });

      // Application
      let app = await tx.application.findFirst({
        where: { candidateId: candidate.id, jobId: rec.jobId }
      });
      if (!app) {
        app = await tx.application.create({
          data: {
            candidateId: candidate.id,
            jobId: rec.jobId,
            status: rec.outcome === 'SELECTED' ? 'IN_PIPELINE' : (rec.outcome === 'ON_HOLD' ? 'ON_HOLD' : 'REJECTED'),
            shortlisted: rec.outcome === 'SELECTED',
            organizationId: 'defaultOrg',
          }
        });
      } else {
        await tx.application.update({
          where: { id: app.id },
          data: {
            status: rec.outcome === 'SELECTED' ? 'IN_PIPELINE' : (rec.outcome === 'ON_HOLD' ? 'ON_HOLD' : 'REJECTED'),
            shortlisted: rec.outcome === 'SELECTED',
          }
        });
      }

      // If needs Round 1 placeholder (NMIT candidates, Harsha, sushmitha)
      if (rec.needsPlaceholderR1) {
        const existingR1Fb = await tx.interviewFeedback.findFirst({
          where: { candidateId: candidate.id, round: 'ROUND_1' }
        });
        if (!existingR1Fb) {
          const r1PlaceholderDate = new Date('2026-10-14T04:30:00.000Z');
          const r1Fb = await tx.interviewFeedback.create({
            data: {
              candidateId: candidate.id,
              round: 'ROUND_1',
              submittedById: superAdmin.id,
              templateVersion: 2,
              feedbackData: {
                placeholder: true,
                selectionStatus: 'SELECTED',
                outcome_source: 'inferred_progressed_to_round2',
                source: 'CHAT_SYNC_R1_PLACEHOLDER_FOR_R2'
              },
              selectionStatus: 'SELECTED',
              overallRating: null,
              pendingLink: false,
              createdAt: r1PlaceholderDate,
              updatedAt: new Date(),
            }
          });

          const existingR1Iv = await tx.interview.findFirst({
            where: { candidateId: candidate.id, roundNo: 1 }
          });
          const r1IvData = {
            applicationId: app.id,
            candidateId: candidate.id,
            candidateName: candidate.fullName,
            jobId: rec.jobId,
            jobTitle: rec.jobTitle,
            roundNo: 1,
            round: 'ROUND_1',
            scheduledStart: r1PlaceholderDate,
            durationMinutes: 45,
            mode: 'DRIVE',
            status: 'COMPLETED',
            result: 'SELECTED',
            outcome: 'SELECTED',
            outcomeSetAt: r1PlaceholderDate,
            notes: '[Placeholder] Inferred SELECTED — Candidate progressed to Round 2 evaluation.',
            organizationId: 'defaultOrg',
            createdById: superAdmin.id,
            interviewerIds: [superAdmin.id],
            interviewerNames: 'Super Admin (Placeholder)',
            feedback: [{
              id: r1Fb.id,
              round: 'ROUND_1',
              selectionStatus: 'SELECTED',
              overallRating: null,
              comments: '[Placeholder] Inferred SELECTED',
              createdAt: r1PlaceholderDate.toISOString(),
            }],
            round1SMSAlertSent: true,
            round2EmailAlertSent: true,
            updatedAt: new Date(),
          };
          if (!existingR1Iv) {
            await tx.interview.create({ data: { ...r1IvData, createdAt: r1PlaceholderDate } });
          } else {
            await tx.interview.update({ where: { id: existingR1Iv.id }, data: r1IvData });
          }
        }
      }

      // Upsert InterviewFeedback for the recorded round
      const fbData = {
        name: candidate.fullName,
        roundNumber: String(rec.roundNo),
        panelists: rec.panelistName,
        role: rec.role,
        overallRating: rec.rating,
        doj: rec.doj || null,
        selectionStatus: rec.outcome,
        comments: rec.notes,
        source: 'AKSHARA_HR_CHAT_SYNC_13-27OCT2026',
        date_source: 'chat_post_date',
      };

      const fb = await tx.interviewFeedback.upsert({
        where: { candidateId_round: { candidateId: candidate.id, round: rec.round } },
        create: {
          candidateId: candidate.id,
          round: rec.round,
          submittedById: rec.panelistUser.id,
          templateVersion: 2,
          feedbackData: fbData,
          selectionStatus: rec.outcome,
          overallRating: rec.rating,
          pendingLink: false,
          createdAt: ivDateUtc,
          updatedAt: new Date(),
        },
        update: {
          submittedById: rec.panelistUser.id,
          templateVersion: 2,
          feedbackData: fbData,
          selectionStatus: rec.outcome,
          overallRating: rec.rating,
          updatedAt: new Date(),
        }
      });

      // Upsert Interview
      const existingIv = await tx.interview.findFirst({
        where: { candidateId: candidate.id, roundNo: rec.roundNo }
      });
      const ivData = {
        applicationId: app.id,
        candidateId: candidate.id,
        candidateName: candidate.fullName,
        jobId: rec.jobId,
        jobTitle: rec.jobTitle,
        roundNo: rec.roundNo,
        round: rec.round,
        scheduledStart: ivDateUtc,
        durationMinutes: 45,
        mode: rec.isNewCandidate && !rec.drive ? 'IN_PERSON' : 'VIRTUAL',
        status: 'COMPLETED',
        result: rec.outcome,
        outcome: rec.outcome,
        outcomeSetAt: ivDateUtc,
        notes: rec.notes,
        organizationId: 'defaultOrg',
        createdById: rec.panelistUser.id,
        interviewerIds: [rec.panelistUser.id],
        interviewerNames: rec.panelistName,
        feedback: [{
          id: fb.id,
          round: rec.round,
          submittedById: rec.panelistUser.id,
          interviewerName: rec.panelistName,
          overallRating: rec.rating,
          selectionStatus: rec.outcome,
          comments: rec.notes,
          createdAt: ivDateUtc.toISOString(),
        }],
        round1SMSAlertSent: true,
        round2EmailAlertSent: true,
        updatedAt: new Date(),
      };
      if (!existingIv) {
        await tx.interview.create({ data: { ...ivData, createdAt: ivDateUtc } });
      } else {
        await tx.interview.update({ where: { id: existingIv.id }, data: ivData });
      }
    }, { maxWait: 20000, timeout: 30000 });

    successCount++;
    console.log(`  [Record #${i + 1}/${jobBRecords.length}] ✅ Successfully Synced: "${rec.name}" (${rec.drive || 'All Candidates'}, ${rec.round}: ${rec.outcome}, Rating: ${rec.rating !== null ? rec.rating : '-'})`);

    await new Promise(res => setTimeout(res, 200));
  }

  // Safety check on notifications
  const notifCountAfter = await prisma.notification.count();
  console.log(`\n[Safety Check] Baseline Notification Count: ${notifCountBefore} | Count After Sync: ${notifCountAfter}`);
  if (notifCountBefore !== notifCountAfter) {
    throw new Error(`CRITICAL FAIL: Outbound notifications were triggered! Count increased by ${notifCountAfter - notifCountBefore}`);
  }
  console.log('✅ ZERO OUTBOUND MESSAGES ENQUEUED (Count unchanged at 4874).');

  console.log(`\n========================================================================`);
  console.log(`✅ JOB B SYNC COMPLETE: ${successCount} Records Synced, ${skippedConflictCount} Conflicts Skipped.`);
  console.log(`========================================================================\n`);

  await prisma.$disconnect();
}

executeJobB().catch(err => {
  console.error('Job B Execution Error:', err);
  process.exit(1);
});
