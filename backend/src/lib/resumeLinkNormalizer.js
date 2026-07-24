'use strict';

/**
 * Detects resume link cloud providers (Google Drive, Dropbox, OneDrive) and returns
 * direct download URLs.
 *
 * @param {string} rawUrl - Raw resume link from file
 * @returns {object|null} { originalUrl, downloadUrl, provider }
 */
function normalizeResumeLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch (_) {
    return null;
  }

  if (url.hostname.includes('drive.google.com')) {
    const match = trimmed.match(/\/file\/d\/([^/]+)/) || trimmed.match(/[?&]id=([^&]+)/);
    const fileId = match?.[1];
    return fileId
      ? {
          originalUrl: trimmed,
          downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
          provider: 'google_drive',
        }
      : { originalUrl: trimmed, downloadUrl: trimmed, provider: 'unknown' };
  }

  if (url.hostname.includes('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return { originalUrl: trimmed, downloadUrl: url.toString(), provider: 'dropbox' };
  }

  if (url.hostname.includes('onedrive') || url.hostname.includes('sharepoint.com')) {
    url.searchParams.set('download', '1');
    return { originalUrl: trimmed, downloadUrl: url.toString(), provider: 'onedrive' };
  }

  return { originalUrl: trimmed, downloadUrl: trimmed, provider: 'unknown' };
}

module.exports = {
  normalizeResumeLink,
};
