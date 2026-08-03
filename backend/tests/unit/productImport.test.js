const assert = require("assert");
const { mapProductImportRow, normalizeRowKeys } = require("../../src/lib/productImport");

// Case-insensitive + alias headers
{
  const mapped = mapProductImportRow({
    "Product Name": "Widget A",
    Type: "Hardware",
    Location: "Bangalore",
    Price: "1,299",
    Tags: "new, featured",
  });
  assert.strictEqual(mapped.ok, true);
  assert.strictEqual(mapped.data.name, "Widget A");
  assert.strictEqual(mapped.data.category, "Hardware");
  assert.strictEqual(mapped.data.price, 1299);
  assert.deepStrictEqual(mapped.data.tags, ["new", "featured"]);
}

// BOM header + missing category defaults to General
{
  const mapped = mapProductImportRow({
    "\uFEFFName": "Solo Item",
    Category: "",
  });
  assert.strictEqual(mapped.ok, true);
  assert.strictEqual(mapped.data.name, "Solo Item");
  assert.strictEqual(mapped.data.category, "General");
}

// Numeric tags from Excel should not crash
{
  const mapped = mapProductImportRow({
    Name: "Num Tags",
    Category: "Software",
    Tags: 12345,
  });
  assert.strictEqual(mapped.ok, true);
  assert.deepStrictEqual(mapped.data.tags, ["12345"]);
}

// Empty row skipped
{
  const mapped = mapProductImportRow({ Name: "", Category: "", Location: "" });
  assert.strictEqual(mapped.ok, false);
  assert.strictEqual(mapped.skip, true);
}

// Missing name fails (not silently ignored as empty)
{
  const mapped = mapProductImportRow({ Category: "Hardware", Description: "x" });
  assert.strictEqual(mapped.ok, false);
  assert.strictEqual(mapped.skip, false);
}

// 15 data-like rows all map
{
  const rows = Array.from({ length: 15 }, (_, i) => ({
    name: `Product ${i + 1}`,
    category: i % 2 ? "Software" : "Hardware",
    price: (i + 1) * 10,
  }));
  const results = rows.map(mapProductImportRow);
  assert.strictEqual(results.filter((r) => r.ok).length, 15);
}

// normalizeRowKeys strips BOM
{
  const norm = normalizeRowKeys({ "\uFEFFName": "A", Category: "B" });
  assert.strictEqual(norm.name, "A");
  assert.strictEqual(norm.category, "B");
}

console.log("productImport tests passed");
