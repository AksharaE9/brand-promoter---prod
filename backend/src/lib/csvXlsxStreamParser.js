'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const XLSX = require('xlsx');
const { resolveHeader } = require('./headerAliasMap');

/**
 * Streaming parser wrapper for CSV and XLSX files.
 *
 * Prevents memory overload and handles root causes:
 * 1. Preserves raw text for phone numbers (raw: false, no numeric coercion).
 * 2. Case & whitespace-insensitive header mapping via resolveHeader.
 * 3. Strips UTF-8 BOM (\uFEFF) on CSV/header cells.
 * 4. Ignores blank trailing rows.
 * 5. Handles multi-sheet workbooks (only processes 1st sheet, notes extra sheets).
 *
 * @param {string} filePath - Absolute path to uploaded file on disk
 * @param {string} fileExt - File extension (e.g. '.csv', '.xlsx', '.xls')
 * @param {Function} rowCallback - async (mappedRow, rowNumber) => void
 * @returns {Promise<object>} { totalSheets: number, sheetName: string, extraSheetNames: string[] }
 */
async function parseFileStream(filePath, fileExt, rowCallback) {
  const ext = (fileExt || path.extname(filePath)).toLowerCase();

  if (ext === '.csv') {
    return parseCsvFile(filePath, rowCallback);
  } else if (ext === '.xlsx' || ext === '.xls') {
    return parseXlsxFile(filePath, rowCallback);
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }
}

/**
 * CSV file parser using stream pipeline
 */
function parseCsvFile(filePath, rowCallback) {
  return new Promise((resolve, reject) => {
    let rowCount = 0;
    let headerMap = null; // index -> canonical field key

    const parser = parse({
      bom: true, // Auto-strip UTF-8 BOM
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => reject(new Error(`File read error: ${err.message}`)));
    parser.on('error', (err) => reject(new Error(`CSV parse error: ${err.message}`)));

    let processingPromise = Promise.resolve();

    parser.on('data', (record) => {
      // Pause stream to await callback async processing
      parser.pause();

      processingPromise = processingPromise
        .then(async () => {
          rowCount++;

          if (rowCount === 1) {
            // Header row
            headerMap = {};
            record.forEach((rawCol, idx) => {
              const cleaned = String(rawCol || '').trim().replace(/^\uFEFF/, '');
              const canonicalKey = resolveHeader(rawCol) || cleaned;
              if (canonicalKey) {
                headerMap[idx] = canonicalKey;
              }
            });
          } else {
            // Data row
            const mappedRow = {};
            let hasAnyData = false;

            record.forEach((val, idx) => {
              const key = headerMap[idx];
              if (key) {
                const strVal = String(val ?? '').trim();
                mappedRow[key] = strVal;
                if (strVal) hasAnyData = true;
              }
            });

            // Skip blank trailing rows
            if (hasAnyData) {
              await rowCallback(mappedRow, rowCount);
            }
          }
        })
        .then(() => {
          parser.resume();
        })
        .catch((err) => {
          stream.destroy(err);
          reject(err);
        });
    });

    parser.on('end', () => {
      processingPromise.then(() => {
        resolve({ totalSheets: 1, sheetName: 'CSV', extraSheetNames: [] });
      }).catch(reject);
    });

    stream.pipe(parser);
  });
}

/**
 * XLSX file parser (using raw: false to ensure text cell extraction)
 */
async function parseXlsxFile(filePath, rowCallback) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: true, cellText: true });
  const sheetNames = workbook.SheetNames || [];

  if (sheetNames.length === 0) {
    throw new Error('Workbook contains no worksheets');
  }

  const primarySheetName = sheetNames[0];
  const worksheet = workbook.Sheets[primarySheetName];
  const extraSheetNames = sheetNames.slice(1);

  // Convert worksheet to JSON rows with string cell values
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });

  if (rawRows.length === 0) {
    return { totalSheets: sheetNames.length, sheetName: primarySheetName, extraSheetNames };
  }

  // Header row (row 0)
  const headerRow = rawRows[0];
  const headerMap = {};

  headerRow.forEach((rawCol, idx) => {
    const cleaned = String(rawCol || '').trim().replace(/^\uFEFF/, '');
    const canonicalKey = resolveHeader(rawCol) || cleaned;
    if (canonicalKey) {
      headerMap[idx] = canonicalKey;
    }
  });

  // Data rows (starting from row 1)
  for (let i = 1; i < rawRows.length; i++) {
    const record = rawRows[i];
    const rowNumber = i + 1; // 1-indexed file row
    const mappedRow = {};
    let hasAnyData = false;

    if (Array.isArray(record)) {
      record.forEach((val, idx) => {
        const key = headerMap[idx];
        if (key) {
          const strVal = String(val ?? '').trim();
          mappedRow[key] = strVal;
          if (strVal) hasAnyData = true;
        }
      });
    }

    // Skip blank trailing rows
    if (hasAnyData) {
      await rowCallback(mappedRow, rowNumber);
    }
  }

  return {
    totalSheets: sheetNames.length,
    sheetName: primarySheetName,
    extraSheetNames,
  };
}

module.exports = {
  parseFileStream,
};
