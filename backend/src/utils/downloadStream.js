'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Streams a remote URL directly to the Express response,
 * robustly following HTTP/HTTPS redirects (up to 5 levels)
 * and handling both http and https protocols.
 *
 * @param {string} urlStr - The URL of the file to stream.
 * @param {object} res - The Express response object.
 * @param {number} [redirectCount=0] - Current redirect depth.
 */
function streamUrlWithRedirects(urlStr, res, redirectCount = 0) {
  if (redirectCount > 5) {
    console.error(`[DownloadStream] Too many redirects for URL: ${urlStr}`);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'Too many redirects trying to download file' });
    }
    return;
  }

  try {
    const urlObj = new URL(urlStr);
    const client = urlObj.protocol === 'https:' ? https : http;

    client.get(urlStr, (streamRes) => {
      // Handle redirect status codes (301, 302, 307, 308)
      if (streamRes.statusCode >= 300 && streamRes.statusCode < 400 && streamRes.headers.location) {
        const redirectUrl = new URL(streamRes.headers.location, urlStr).toString();
        return streamUrlWithRedirects(redirectUrl, res, redirectCount + 1);
      }

      if (streamRes.statusCode >= 400) {
        console.error(`[DownloadStream] HTTP Error ${streamRes.statusCode} for URL: ${urlStr}`);
        if (!res.headersSent) {
          return res.status(streamRes.statusCode).json({
            success: false,
            message: `Failed to download from storage: HTTP ${streamRes.statusCode}`
          });
        }
        return;
      }

      // Pipe the successful response stream directly into res
      streamRes.pipe(res);
    }).on('error', (err) => {
      console.error(`[DownloadStream] Network error for URL ${urlStr}:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error streaming file from storage' });
      }
    });
  } catch (err) {
    console.error(`[DownloadStream] URL parsing error for URL ${urlStr}:`, err.message);
    if (!res.headersSent) {
      res.status(400).json({ success: false, message: 'Invalid file URL' });
    }
  }
}

module.exports = { streamUrlWithRedirects };
