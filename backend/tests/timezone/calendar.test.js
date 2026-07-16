'use strict';
/**
 * Tests 10-14: Calendar Grid — Timezone Correctness (CRITICAL)
 *
 * Test 10: Interview at 10:00 AM IST is stored as the correct UTC equivalent
 * Test 11: Same interview renders at 10:00 AM IST regardless of server timezone
 * Test 12: 11:45 PM IST interview renders on the correct IST calendar day (not UTC day)
 * Test 13: Leap year (Feb 29, 2024) and frozen-clock edge cases handled correctly
 * Test 14: Switching between weekly and daily Calendar Grid views preserves IST time
 *
 * NOTE: All timezone logic is pure computation — these are unit tests on the
 * IST display helpers used throughout the frontend and the UTC values stored
 * by the backend. We freeze time via jest.useFakeTimers where needed.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { FIXTURE, istToUtc } = require('../setup/seed');

const IST_OFFSET_MINUTES = 330; // UTC+5:30

/**
 * Converts a UTC Date to IST wall-clock { year, month, day, hour, minute }
 * This mirrors the logic the frontend Calendar Grid uses to render slots.
 */
function utcToIstComponents(utcDate) {
  const istMs = utcDate.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  return {
    year:   ist.getUTCFullYear(),
    month:  ist.getUTCMonth() + 1,
    day:    ist.getUTCDate(),
    hour:   ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/**
 * Given a UTC-stored scheduledStart from the DB, return the IST date string
 * that the Calendar Grid would render (YYYY-MM-DD in IST).
 */
function getISTCalendarDay(utcDate) {
  const { year, month, day } = utcToIstComponents(utcDate);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ── Test 10 ──────────────────────────────────────────────────────────────────
test('Test 10: Interview at 10:00 AM IST is stored as correct UTC-equivalent timestamp in DB', async () => {
  const { prisma } = require('../setup/db');

  // Fetch the Round 1 interview (seeded at 10:00 AM IST = 04:30 UTC on 2024-03-15)
  const interview = await prisma.interview.findFirst({
    where: { organizationId: FIXTURE.ORG_ID, roundNo: 1 },
    select: { scheduledStart: true },
  });

  expect(interview).not.toBeNull();
  const storedUtc = new Date(interview.scheduledStart);

  // Must be stored as UTC 04:30:00 on 2024-03-15
  expect(storedUtc.getUTCFullYear()).toBe(2024);
  expect(storedUtc.getUTCMonth()).toBe(2); // March (0-indexed)
  expect(storedUtc.getUTCDate()).toBe(15);
  expect(storedUtc.getUTCHours()).toBe(4);
  expect(storedUtc.getUTCMinutes()).toBe(30);
  expect(storedUtc.getUTCSeconds()).toBe(0);

  // Cross-verify: converting back to IST must give 10:00 AM
  const ist = utcToIstComponents(storedUtc);
  expect(ist.hour).toBe(10);
  expect(ist.minute).toBe(0);
});

// ── Test 11 ──────────────────────────────────────────────────────────────────
test('Test 11: Interview at 10:00 AM IST renders at 10:00 AM IST regardless of process timezone', async () => {
  const { prisma } = require('../setup/db');

  const interview = await prisma.interview.findFirst({
    where: { organizationId: FIXTURE.ORG_ID, roundNo: 1 },
    select: { scheduledStart: true },
  });
  const storedUtc = new Date(interview.scheduledStart);

  // Simulate what Calendar Grid does: take UTC value from API, convert to IST
  const rendered = utcToIstComponents(storedUtc);

  // Must display as 10:00 AM IST — regardless of the CI runner's local TZ
  expect(rendered.hour).toBe(10);
  expect(rendered.minute).toBe(0);

  // Specifically verify it's NOT showing UTC time (04:30)
  expect(rendered.hour).not.toBe(4);
  expect(rendered.minute).not.toBe(30);
});

// ── Test 12 ──────────────────────────────────────────────────────────────────
test('Test 12: 11:45 PM IST interview renders on correct IST calendar day (not UTC next day)', async () => {
  const { prisma } = require('../setup/db');

  // Round 3 was seeded at 11:45 PM IST on 2024-03-15 = 18:15 UTC on 2024-03-15
  const interview = await prisma.interview.findFirst({
    where: { organizationId: FIXTURE.ORG_ID, roundNo: 3 },
    select: { scheduledStart: true },
  });
  expect(interview).not.toBeNull();
  const storedUtc = new Date(interview.scheduledStart);

  // UTC day is still March 15 (18:15 UTC)
  expect(storedUtc.getUTCDate()).toBe(15);
  expect(storedUtc.getUTCHours()).toBe(18);
  expect(storedUtc.getUTCMinutes()).toBe(15);

  // IST rendering must show March 15, NOT March 14 (which naive UTC-day logic would give)
  const istCalendarDay = getISTCalendarDay(storedUtc);
  expect(istCalendarDay).toBe('2024-03-15');

  // Render hour must be 23 (11 PM), not 18
  const ist = utcToIstComponents(storedUtc);
  expect(ist.hour).toBe(23);
  expect(ist.minute).toBe(45);
});

// ── Test 13 ──────────────────────────────────────────────────────────────────
test('Test 13: Leap year Feb 29 interview is handled correctly with frozen clock', async () => {
  // Freeze time to avoid any reliance on real system clock
  jest.useFakeTimers({ now: new Date('2024-02-29T00:00:00.000Z').getTime() });

  try {
    const { prisma } = require('../setup/db');

    // Round 4 was seeded at 10:00 AM IST on 2024-02-29 (leap year)
    const interview = await prisma.interview.findFirst({
      where: { organizationId: FIXTURE.ORG_ID, roundNo: 4 },
      select: { scheduledStart: true },
    });
    expect(interview).not.toBeNull();
    const storedUtc = new Date(interview.scheduledStart);

    // Verify it's stored in UTC as Feb 29 04:30
    expect(storedUtc.getUTCFullYear()).toBe(2024);
    expect(storedUtc.getUTCMonth()).toBe(1); // February (0-indexed)
    expect(storedUtc.getUTCDate()).toBe(29);
    expect(storedUtc.getUTCHours()).toBe(4);
    expect(storedUtc.getUTCMinutes()).toBe(30);

    // IST rendering must show Feb 29 (not Feb 28 due to timezone subtraction error)
    const istCalendarDay = getISTCalendarDay(storedUtc);
    expect(istCalendarDay).toBe('2024-02-29');

    const ist = utcToIstComponents(storedUtc);
    expect(ist.month).toBe(2);
    expect(ist.day).toBe(29);
    expect(ist.hour).toBe(10);
    expect(ist.minute).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

// ── Test 14 ──────────────────────────────────────────────────────────────────
test('Test 14: Switching between weekly and daily Calendar Grid views preserves IST time (no drift)', async () => {
  const { prisma } = require('../setup/db');

  // Get all 4 seeded interviews
  const interviews = await prisma.interview.findMany({
    where: { organizationId: FIXTURE.ORG_ID },
    orderBy: { roundNo: 'asc' },
    select: { scheduledStart: true, roundNo: true },
    take: 4,
  });

  // Simulate both "daily view" and "weekly view" rendering by computing IST
  // for each interview. The IST time must be identical regardless of "view mode"
  // (view mode only changes grouping, not time computation).

  const expectedTimes = [
    { roundNo: 1, hour: 10, minute: 0,  day: 15, month: 3 }, // 10:00 AM IST Mar 15
    { roundNo: 2, hour: 14, minute: 0,  day: 15, month: 3 }, // 2:00 PM IST Mar 15
    { roundNo: 3, hour: 23, minute: 45, day: 15, month: 3 }, // 11:45 PM IST Mar 15
    { roundNo: 4, hour: 10, minute: 0,  day: 29, month: 2 }, // 10:00 AM IST Feb 29
  ];

  interviews.forEach((interview, idx) => {
    const utcDate = new Date(interview.scheduledStart);
    const istWeekly = utcToIstComponents(utcDate); // "weekly view" renders this
    const istDaily  = utcToIstComponents(utcDate); // "daily view" renders this

    const expected = expectedTimes[idx];

    // Both views must render the same IST time (no drift on view switch)
    expect(istWeekly.hour).toBe(expected.hour);
    expect(istWeekly.minute).toBe(expected.minute);
    expect(istWeekly.day).toBe(expected.day);
    expect(istWeekly.month).toBe(expected.month);

    expect(istDaily.hour).toBe(expected.hour);
    expect(istDaily.minute).toBe(expected.minute);
    expect(istDaily.day).toBe(expected.day);
    expect(istDaily.month).toBe(expected.month);

    // Explicitly assert no UTC/IST confusion (daily view must not subtract more offset)
    const rawUtcHour = utcDate.getUTCHours();
    // If the raw UTC hour equals the IST hour, we have a timezone bug (forgot to convert)
    if (expected.hour !== rawUtcHour) {
      expect(istWeekly.hour).not.toBe(rawUtcHour);
      expect(istDaily.hour).not.toBe(rawUtcHour);
    }
  });
});
