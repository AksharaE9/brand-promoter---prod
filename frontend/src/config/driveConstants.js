/**
 * Single shared constant for Drive description maximum word limit.
 */
export const DRIVE_DESCRIPTION_MAX_WORDS = 200;

/**
 * Counts words by trimming and splitting on any whitespace sequence.
 * Consistent across client and server.
 * @param {string} text 
 * @returns {number}
 */
export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Validates a drive description string against the word limit.
 * @param {string|null|undefined} description 
 * @returns {{ valid: boolean, wordCount: number, error?: string }}
 */
export function validateDriveDescription(description) {
  if (!description) {
    return { valid: true, wordCount: 0 };
  }
  const count = countWords(description);
  if (count > DRIVE_DESCRIPTION_MAX_WORDS) {
    return {
      valid: false,
      wordCount: count,
      error: `Description is ${count} words — please shorten to ${DRIVE_DESCRIPTION_MAX_WORDS} or fewer`,
    };
  }
  return { valid: true, wordCount: count };
}
