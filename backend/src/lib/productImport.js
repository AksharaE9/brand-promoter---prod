/**
 * Helpers for Sales product bulk import (CSV / Excel).
 * Normalizes messy headers and cell values so all data rows can be imported.
 */

function normalizeHeaderKey(key) {
  return String(key || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function cellToString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function isRowEmpty(normalized) {
  return !Object.values(normalized).some((v) => cellToString(v) !== "");
}

/**
 * Build a lowercase-header lookup from a sheet row object.
 * Handles BOM-prefixed headers and spacing variants.
 */
function normalizeRowKeys(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key === "__rowNum__") continue;
    const norm = normalizeHeaderKey(key);
    if (!norm) continue;
    // Prefer first non-empty value if duplicate headers collide
    if (out[norm] == null || cellToString(out[norm]) === "") {
      out[norm] = value;
    }
  }
  return out;
}

function pickField(normalizedRow, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeaderKey(alias);
    if (Object.prototype.hasOwnProperty.call(normalizedRow, key)) {
      const val = cellToString(normalizedRow[key]);
      if (val !== "") return val;
    }
  }
  return "";
}

const NAME_ALIASES = [
  "name",
  "product",
  "product name",
  "title",
  "item",
  "item name",
  "purchase",
  "purchase name",
];

const CATEGORY_ALIASES = [
  "category",
  "type",
  "product category",
  "product type",
  "group",
];

const LOCATION_ALIASES = ["location", "place", "city", "region", "area"];
const DESCRIPTION_ALIASES = ["description", "details", "notes", "desc"];
const PRICE_ALIASES = ["price", "amount", "cost", "value"];
const TAGS_ALIASES = ["tags", "tag", "labels", "label"];

/**
 * Map one spreadsheet row into product create payload.
 * Returns { ok: true, data } or { ok: false, reason }.
 */
function mapProductImportRow(row, options = {}) {
  const defaultCategory = options.defaultCategory || "General";
  const normalized = normalizeRowKeys(row);

  if (isRowEmpty(normalized)) {
    return { ok: false, reason: "empty_row", skip: true };
  }

  const name = pickField(normalized, NAME_ALIASES);
  let category = pickField(normalized, CATEGORY_ALIASES);

  if (!name) {
    return {
      ok: false,
      reason: "Missing product name",
      skip: false,
    };
  }

  if (!category) category = defaultCategory;

  const priceRaw = pickField(normalized, PRICE_ALIASES);
  let price = null;
  if (priceRaw !== "") {
    const cleaned = priceRaw.replace(/[,₹$]/g, "");
    const num = Number(cleaned);
    price = Number.isFinite(num) ? num : null;
  }

  const tagsRaw = pickField(normalized, TAGS_ALIASES);
  const tags = tagsRaw
    ? tagsRaw.split(/[,|;]/).map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    data: {
      name,
      category,
      location: pickField(normalized, LOCATION_ALIASES) || null,
      description: pickField(normalized, DESCRIPTION_ALIASES) || null,
      price,
      tags,
    },
  };
}

module.exports = {
  normalizeHeaderKey,
  normalizeRowKeys,
  cellToString,
  mapProductImportRow,
  NAME_ALIASES,
  CATEGORY_ALIASES,
};
