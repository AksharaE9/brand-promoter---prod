'use strict';

const XLSX = require('xlsx');
const { resolveHeader } = require('./headerAliasMap');

/**
 * Generic Sheet Parser Helper
 *
 * Reads CSV / XLS / XLSX buffer cleanly preserving text strings (raw: false)
 * and resolves column headers using resolveHeader alias map.
 */
function parseSheetBuffer(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const allRows = [];
  const errors = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Convert sheet to JSON rows with string values
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    rawRows.forEach((row, idx) => {
      const normalizedRow = {
        _sheetName: sheetName,
        _rowIndex: idx + 2, // 1-indexed header + row index
      };

      for (const [key, val] of Object.entries(row)) {
        const canonicalKey = resolveHeader(key) || String(key).trim();
        normalizedRow[canonicalKey] = val;
      }

      allRows.push(normalizedRow);
    });
  }

  return {
    rows: allRows,
    sheetCount: workbook.SheetNames.length,
    errors,
  };
}

module.exports = {
  parseSheetBuffer,
};
