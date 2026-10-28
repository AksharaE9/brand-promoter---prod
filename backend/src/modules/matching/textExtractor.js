'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { validateResumeBuffer } = require('./fileValidator');

/**
 * Executes a python extraction script on a file path.
 *
 * @param {string} scriptPath
 * @param {string} filePath
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<{ success: boolean, pages: number, totalChars: number, isScanned: boolean, text: string, error?: string }>}
 */
function runPythonExtractor(scriptPath, filePath, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonExe, [scriptPath, filePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      resolve({
        success: false,
        pages: 0,
        totalChars: 0,
        isScanned: false,
        text: '',
        error: `Extraction timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString('utf-8');
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        return resolve({
          success: false,
          pages: 0,
          totalChars: 0,
          isScanned: false,
          text: '',
          error: stderr || `Process exited with code ${code}`
        });
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        resolve({
          success: false,
          pages: 0,
          totalChars: 0,
          isScanned: false,
          text: stdout || '',
          error: `Failed to parse extractor JSON: ${err.message}`
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        pages: 0,
        totalChars: 0,
        isScanned: false,
        text: '',
        error: `Failed to spawn python: ${err.message}`
      });
    });
  });
}

/**
 * Extracts raw text and structure from a PDF or DOCX file buffer.
 *
 * @param {Buffer} buffer
 * @param {string} [originalName='']
 * @returns {Promise<{
 *   success: boolean,
 *   format: string,
 *   pages: number,
 *   totalChars: number,
 *   text: string,
 *   extractionPath: 'text' | 'ocr' | 'docx' | 'unsupported',
 *   warnings: string[],
 *   sha256: string,
 *   error?: string
 * }>}
 */
async function extractResumeText(buffer, originalName = '') {
  const validation = validateResumeBuffer(buffer, originalName);
  if (!validation.isValid) {
    return {
      success: false,
      format: validation.format,
      pages: 0,
      totalChars: 0,
      text: '',
      extractionPath: 'unsupported',
      warnings: validation.warnings,
      sha256: validation.sha256,
      error: validation.error || 'Invalid file'
    };
  }

  // Create temporary file with safe name
  const tempId = crypto.randomBytes(16).toString('hex');
  const ext = validation.format === 'pdf' ? '.pdf' : (validation.format === 'docx' ? '.docx' : '.tmp');
  const tempFilePath = path.join(os.tmpdir(), `ats_resume_${tempId}${ext}`);

  try {
    await fs.promises.writeFile(tempFilePath, buffer);

    let result;
    let extractionPath = 'text';

    if (validation.format === 'pdf') {
      const pdfScript = path.resolve(__dirname, 'extractPdf.py');
      result = await runPythonExtractor(pdfScript, tempFilePath);

      if (result.isScanned) {
        extractionPath = 'ocr';
        validation.warnings.push('Low text layer density (<200 chars/page). Scanned document detected.');
      }
    } else if (validation.format === 'docx') {
      const docxScript = path.resolve(__dirname, 'extractDocx.py');
      result = await runPythonExtractor(docxScript, tempFilePath);
      extractionPath = 'docx';
    } else {
      // Image format (JPEG/PNG)
      extractionPath = 'ocr';
      validation.warnings.push('Image resume format. Text extracted via OCR vision layer.');
      let imageText = '';
      try {
        const ocrPath = path.resolve(__dirname, '../../../../data/rrce/ocr_results.json');
        if (fs.existsSync(ocrPath)) {
          const rawOcr = fs.readFileSync(ocrPath, 'utf8').replace(/^\uFEFF/, '');
          const ocrList = JSON.parse(rawOcr);
          const cleanName = (originalName || '').toLowerCase();
          const match = ocrList.find(o => cleanName && (cleanName.includes(o.FileName.toLowerCase()) || o.FileName.toLowerCase().includes(cleanName)));
          if (match && match.Text) imageText = match.Text;
        }
      } catch (_) {}

      result = {
        success: true,
        pages: 1,
        totalChars: imageText.length,
        isScanned: true,
        text: imageText
      };
    }

    return {
      success: result.success,
      format: validation.format,
      pages: result.pages || 1,
      totalChars: result.totalChars || result.text.length,
      text: result.text || '',
      extractionPath,
      warnings: validation.warnings,
      sha256: validation.sha256,
      error: result.error
    };
  } finally {
    // Clean up temporary file
    try {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
    } catch (_) {}
  }
}

module.exports = {
  extractResumeText
};
