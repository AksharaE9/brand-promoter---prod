import { describe, it, expect } from 'vitest';
import { parseNotesSafely, isFollowUpUploaded } from '../../src/lib/interviewUtils.js';

/**
 * Unit tests for session-expiry + Excel View follow-up sync changes.
 * Tests the parseNotesSafely and isFollowUpUploaded utility functions.
 *
 * Both the full format { name, data } (detail endpoint) and
 * the stripped list-mode format { name, exists: true } (list endpoint)
 * must be handled correctly.
 */

describe('parseNotesSafely', () => {
  it('returns all nulls for null input', () => {
    const result = parseNotesSafely(null);
    expect(result.phoneFollowUp).toBeNull();
    expect(result.emailFollowUp).toBeNull();
    expect(result.morningFollowUp).toBeNull();
    expect(result.nextSchedule).toBeNull();
  });

  it('returns all nulls for empty string', () => {
    const result = parseNotesSafely('');
    expect(result.phoneFollowUp).toBeNull();
  });

  it('returns all nulls for malformed JSON (no crash)', () => {
    const result = parseNotesSafely('{bad json{{');
    expect(result.phoneFollowUp).toBeNull();
    expect(result.emailFollowUp).toBeNull();
  });

  it('parses full format { name, data } correctly', () => {
    const notes = JSON.stringify({
      phoneFollowUp: { name: 'call.mp3', data: 'SGVsbG8=' },
      emailFollowUp: { name: 'email.pdf', data: 'UERGZGFhYQ==' },
    });
    const result = parseNotesSafely(notes);
    expect(result.phoneFollowUp).toEqual({ name: 'call.mp3', data: 'SGVsbG8=' });
    expect(result.emailFollowUp).toEqual({ name: 'email.pdf', data: 'UERGZGFhYQ==' });
  });

  it('parses stripped list-mode format { name, exists: true } correctly', () => {
    const notes = JSON.stringify({
      phoneFollowUp: { name: 'call.mp3', exists: true },
      emailFollowUp: null,
      morningFollowUp: { name: 'morning.pdf', exists: true },
      nextSchedule: '2026-07-15',
    });
    const result = parseNotesSafely(notes);
    expect(result.phoneFollowUp).toEqual({ name: 'call.mp3', exists: true });
    expect(result.emailFollowUp).toBeNull();
    expect(result.morningFollowUp).toEqual({ name: 'morning.pdf', exists: true });
    expect(result.nextSchedule).toBe('2026-07-15');
  });
});

describe('isFollowUpUploaded', () => {
  it('returns false for null', () => {
    expect(isFollowUpUploaded(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isFollowUpUploaded(undefined)).toBe(false);
  });

  it('returns false for empty object (no data, no exists)', () => {
    expect(isFollowUpUploaded({})).toBe(false);
  });

  it('returns true for full format { name, data }', () => {
    expect(isFollowUpUploaded({ name: 'file.mp3', data: 'SGVsbG8=' })).toBe(true);
  });

  it('returns true for stripped list-mode format { name, exists: true }', () => {
    expect(isFollowUpUploaded({ name: 'file.mp3', exists: true })).toBe(true);
  });

  it('returns false when exists is false', () => {
    expect(isFollowUpUploaded({ name: 'file.mp3', exists: false })).toBe(false);
  });

  it('returns false when exists is a string (truthy but not === true)', () => {
    // Strict equality check: only boolean true counts
    expect(isFollowUpUploaded({ name: 'file.mp3', exists: 'true' })).toBe(false);
  });
});
