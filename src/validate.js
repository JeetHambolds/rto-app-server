import { PRODUCT_CONFIGS } from "./productConfigs.js";

const ITL_REQUIRED_COLUMNS = [
  "Order Number",
  "Order Status",
  "Attempt Count",
  "Order Date",
];

const GOKWIK_REQUIRED_COLUMNS = ["Shopify Order Name", "Payment Method"];

const SHIPROCKET_REQUIRED_COLUMNS = [
  "Order ID",
  "Status",
  "Attempt Count",
  "Shiprocket Created At",
];

function getColumns(records) {
  if (!records.length) return [];
  return Object.keys(records[0]);
}

function missingColumns(columns, required) {
  return required.filter((col) => !columns.includes(col));
}

function hasAllColumns(columns, required) {
  return required.every((col) => columns.includes(col));
}

function validateNotEmpty(records, fileLabel) {
  if (!records.length) {
    throw new Error(`${fileLabel} CSV has no data rows`);
  }
}

export function validateItlFile(records) {
  validateNotEmpty(records, "ITL");
  const columns = getColumns(records);

  if (hasAllColumns(columns, GOKWIK_REQUIRED_COLUMNS) && !hasAllColumns(columns, ITL_REQUIRED_COLUMNS)) {
    throw new Error(
      "Invalid ITL file: this looks like a GoKwik CSV. Upload the ITL order export in the ITL slot.",
    );
  }

  const missing = missingColumns(columns, ITL_REQUIRED_COLUMNS);
  if (missing.length) {
    throw new Error(`ITL CSV missing required columns: ${missing.join(", ")}`);
  }

  return { rowCount: records.length, columns };
}

export function validateGokwikFile(records) {
  validateNotEmpty(records, "GoKwik");
  const columns = getColumns(records);

  if (hasAllColumns(columns, ITL_REQUIRED_COLUMNS) && !hasAllColumns(columns, GOKWIK_REQUIRED_COLUMNS)) {
    throw new Error(
      "Invalid GoKwik file: this looks like an ITL CSV. Upload the GoKwik payment export in the GoKwik slot.",
    );
  }

  const missing = missingColumns(columns, GOKWIK_REQUIRED_COLUMNS);
  if (missing.length) {
    throw new Error(`GoKwik CSV missing required columns: ${missing.join(", ")}`);
  }

  return { rowCount: records.length, columns };
}

export function validateShiprocketFile(records) {
  validateNotEmpty(records, "Shiprocket");
  const columns = getColumns(records);

  const missing = missingColumns(columns, SHIPROCKET_REQUIRED_COLUMNS);
  if (missing.length) {
    throw new Error(
      `Shiprocket CSV missing required columns: ${missing.join(", ")}`,
    );
  }

  return { rowCount: records.length, columns };
}

/**
 * Ensure ITL rows belong to the selected company (Niconi or Epitight).
 */
export function validateCompanyItlData(records, company) {
  const config = PRODUCT_CONFIGS[company];
  if (!config) {
    throw new Error(`Unknown company: ${company}`);
  }

  const companySkus = new Set(Object.keys(config.productDisplayMap));
  const otherCompanySkus = new Map();

  for (const [comp, cfg] of Object.entries(PRODUCT_CONFIGS)) {
    if (comp === company) continue;
    for (const sku of Object.keys(cfg.productDisplayMap)) {
      otherCompanySkus.set(sku, comp);
    }
  }

  const wrongSkus = new Set();
  let companySkuCount = 0;

  for (const row of records) {
    const sku = String(row["Product SKU"] || "").trim();
    if (!sku) continue;

    if (companySkus.has(sku)) {
      companySkuCount++;
    } else if (otherCompanySkus.has(sku)) {
      wrongSkus.add(sku);
    }
  }

  if (wrongSkus.size > 0) {
    const otherCompany = otherCompanySkus.get([...wrongSkus][0]);
    const label = otherCompany.charAt(0).toUpperCase() + otherCompany.slice(1);
    const selected = company.charAt(0).toUpperCase() + company.slice(1);
    const sample = [...wrongSkus].slice(0, 3).join(", ");
    const suffix = wrongSkus.size > 3 ? "…" : "";
    throw new Error(
      `ITL CSV contains ${label} product SKUs (${sample}${suffix}) but ${selected} was selected. Upload the correct company's ITL file.`,
    );
  }

  const wrongBrandPattern = company === "niconi" ? /\bepitight\b/i : /\bniconi\b/i;
  const ownBrandPattern = company === "niconi" ? /\bniconi\b/i : /\bepitight\b/i;

  let wrongBrandCount = 0;
  let ownBrandCount = 0;

  for (const row of records) {
    const name = String(row["Product Name"] || "").trim();
    if (!name) continue;
    if (wrongBrandPattern.test(name)) wrongBrandCount++;
    if (ownBrandPattern.test(name)) ownBrandCount++;
  }

  if (wrongBrandCount > 0 && wrongBrandCount >= ownBrandCount) {
    const other = company === "niconi" ? "Epitight" : "Niconi";
    const selected = company.charAt(0).toUpperCase() + company.slice(1);
    throw new Error(
      `ITL CSV appears to contain ${other} products but ${selected} was selected.`,
    );
  }

  if (companySkuCount === 0) {
    const hasAnySku = records.some((row) => String(row["Product SKU"] || "").trim());
    if (hasAnySku) {
      const selected = company.charAt(0).toUpperCase() + company.slice(1);
      throw new Error(
        `ITL CSV does not contain any recognized ${selected} product SKUs. Check that you selected the correct company.`,
      );
    }
  }

  return { companySkuCount, rowCount: records.length };
}
