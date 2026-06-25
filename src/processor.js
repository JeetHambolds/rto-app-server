import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { PRODUCT_CONFIGS } from "./productConfigs.js";
import {
  validateItlFile,
  validateGokwikFile,
  validateShiprocketFile,
  validateCompanyItlData,
} from "./validate.js";

export { PRODUCT_CONFIGS };

function csvBufferToRecords(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true,
    trim: true,
  });
  return records;
}

function getCellString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function getMonthKey(value) {
  if (!value) return "UNKNOWN";

  const str = String(value).trim();
  let date;

  if (/^\d{2}-\d{2}-\d{4}/.test(str)) {
    const [datePart] = str.split(" ");
    const [day, month, year] = datePart.split("-");
    date = new Date(`${year}-${month}-${day}`);
  } else {
    date = new Date(str);
  }

  if (isNaN(date)) return "UNKNOWN";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDateObject(value) {
  if (!value) return null;

  const str = String(value).trim();
  let date;

  if (/^\d{2}-\d{2}-\d{4}/.test(str)) {
    const [datePart] = str.split(" ");
    const [day, month, year] = datePart.split("-");
    date = new Date(`${year}-${month}-${day}`);
  } else {
    date = new Date(str);
  }

  if (isNaN(date)) return null;
  return date;
}

function getDateKey(value) {
  const date = getDateObject(value);
  if (!date) return "UNKNOWN";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function isDateInDayRange(rawDate, dayRange) {
  if (!dayRange) return true;
  const date = getDateObject(rawDate);
  if (!date) return false;
  const day = date.getDate();
  return day >= dayRange.startDay && day <= dayRange.endDay;
}

const STATUS_MAPPING = {
  delivered: "Delivered",
  lost: "Delivered",
  damaged: "Delivered",
  shipped: "Delivered",
  "shipment lost": "Delivered",

  rto: "RTO",
  "rto delivered": "RTO",
  returned: "RTO",
  "returned to origin": "RTO",
  "reached at origin": "RTO",
  "rto in transit": "RTO",
  "rto out for delivery": "RTO",
  "rto processing": "RTO",
  "rto undelivered": "RTO",
  "rto shortage": "RTO",
  "rto ndr": "RTO",
  "rto ofd": "RTO",
  "undelivered-3rd attempt": "RTO",
  "reached back at_seller_city": "RTO",
  "reached destination hub": "RTO",
  "return pending": "RTO",
  "rto initiated": "RTO",

  "in transit": "Open",
  "out for delivery": "Open",
  delayed: "Open",
  "reached at destination": "Open",
  "undelivered-1st attempt": "Open",
  "undelivered-2nd attempt": "Open",
  "in transit-en-route": "Open",
  undelivered: "Open",

  cancelled: "Cancelled",
  canceled: "Cancelled",
  manifested: "Cancelled",
  "cancellation requested": "Cancelled",
  "new order": "Cancelled",
  "pickup error": "Cancelled",
  "pickup exception": "Cancelled",
  "pickup rescheduled": "Cancelled",
  "pickup scheduled": "Cancelled",
  "cancel request approved": "Cancelled",
  "cancel request pending": "Cancelled",
};

function getFinalStatus(rawStatus, attemptCount, paymentMethod) {
  const status = getCellString(rawStatus).toLowerCase().trim();
  const attempts = Number(attemptCount) || 0;
  const payment = paymentMethod?.toUpperCase().trim();

  if (status.includes("out of delivery area")) {
    return payment === "PREPAID" ? "Delivered" : "RTO";
  }

  if (
    status === "reached at destination" ||
    status === "undelivered" ||
    status === "out for delivery"
  ) {
    return attempts <= 2 ? "Open" : "RTO";
  }

  if (STATUS_MAPPING[status]) return STATUS_MAPPING[status];

  for (const key of Object.keys(STATUS_MAPPING).sort(
    (a, b) => b.length - a.length,
  )) {
    if (status.includes(key)) return STATUS_MAPPING[key];
  }

  return "Open";
}

function cleanOrderNumber(value) {
  if (!value) return null;

  const str = String(value).trim();
  if (str.toUpperCase().includes("_INF")) return null;

  const match = str.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function isSuffixOrder(value) {
  if (!value) return false;
  return /-\s*CR\b/i.test(String(value).trim());
}

function mergeFinalStatus(a, b) {
  if (a === "Delivered" || b === "Delivered") return "Delivered";
  return "RTO";
}

function pickBetterOrderRow(existing, incoming, mergedStatus) {
  const rows = [existing, incoming];

  if (mergedStatus === "Delivered") {
    const baseDelivered = rows.find(
      (r) => !r.fromSuffix && r.finalStatus === "Delivered",
    );
    if (baseDelivered) return { ...baseDelivered, finalStatus: mergedStatus };

    const deliveredRow = rows.find((r) => r.finalStatus === "Delivered");
    if (deliveredRow) return { ...deliveredRow, finalStatus: mergedStatus };
  }

  const baseRow = rows.find((r) => !r.fromSuffix);
  if (baseRow) return { ...baseRow, finalStatus: mergedStatus };

  return { ...existing, finalStatus: mergedStatus };
}

function normalizePayment(method) {
  const val = getCellString(method).toLowerCase().trim();
  return val === "cod" ? "COD" : "PREPAID";
}


function initStats() {
  return {
    COD: { total: 0, Delivered: 0, RTO: 0 },
    PREPAID: { total: 0, Delivered: 0, RTO: 0 },
  };
}

function pct(v, t) {
  return t ? ((v / t) * 100).toFixed(2) + "%" : "0.00%";
}

export function buildStatsTable(stats) {
  return [
    {
      label: "Delivered",
      cod: stats.COD.Delivered,
      prepaid: stats.PREPAID.Delivered,
      overall: stats.COD.Delivered + stats.PREPAID.Delivered,
    },
    {
      label: "RTO",
      cod: stats.COD.RTO,
      prepaid: stats.PREPAID.RTO,
      overall: stats.COD.RTO + stats.PREPAID.RTO,
    },
    {
      label: "Grand Total",
      cod: stats.COD.total,
      prepaid: stats.PREPAID.total,
      overall: stats.COD.total + stats.PREPAID.total,
    },
    {
      label: "RTO %",
      cod: pct(stats.COD.RTO, stats.COD.total),
      prepaid: pct(stats.PREPAID.RTO, stats.PREPAID.total),
      overall: pct(
        stats.COD.RTO + stats.PREPAID.RTO,
        stats.COD.total + stats.PREPAID.total,
      ),
    },
  ];
}

export function buildProductTableRows(statsBySku, productDisplayMap) {
  return Object.entries(statsBySku).map(([sku, stats]) => {
    const displayName = productDisplayMap[sku] || sku;
    return {
      product: displayName,
      sku,
      codTotal: stats.COD.total,
      codRto: stats.COD.RTO,
      codRtoPerc: pct(stats.COD.RTO, stats.COD.total),
      prepaidTotal: stats.PREPAID.total,
      prepaidRto: stats.PREPAID.RTO,
      prepaidRtoPerc: pct(stats.PREPAID.RTO, stats.PREPAID.total),
      overallRtoPerc: pct(
        stats.COD.RTO + stats.PREPAID.RTO,
        stats.COD.total + stats.PREPAID.total,
      ),
    };
  });
}

/**
 * @param {object} options
 * @param {'niconi'|'epitight'} options.company
 * @param {{ startDay: number, endDay: number }|null} options.dayRange
 * @param {Buffer|null} options.itlBuffer
 * @param {Buffer|null} options.gokwikBuffer
 * @param {Buffer|null} options.shiprocketBuffer
 * @param {{ info?: Function, warn?: Function }} [options.logger]
 */
export async function processOrderData({
  company = "niconi",
  dayRange = null,
  itlBuffer = null,
  gokwikBuffer = null,
  shiprocketBuffer = null,
  logger = null,
}) {
  const log = logger || { info: () => {}, warn: () => {} };
  const productConfig = PRODUCT_CONFIGS[company];
  if (!productConfig) {
    throw new Error(`Unknown company: ${company}`);
  }

  const PRODUCT_MAP = productConfig.productMap;
  const PRODUCT_DISPLAY_MAP = productConfig.productDisplayMap;

  log.info("Parsing CSV files…", { status: "processing" });

  const itlData = itlBuffer ? csvBufferToRecords(itlBuffer) : [];
  const gokwikData = gokwikBuffer ? csvBufferToRecords(gokwikBuffer) : [];
  const shiprocketData = shiprocketBuffer
    ? csvBufferToRecords(shiprocketBuffer)
    : [];

  log.info("Validating ITL file…", { status: "processing", file: "itl" });
  const itlMeta = validateItlFile(itlData);
  log.info("ITL file validated", {
    status: "validated",
    file: "itl",
    rowCount: itlMeta.rowCount,
  });

  log.info("Validating GoKwik file…", { status: "processing", file: "gokwik" });
  const gokwikMeta = validateGokwikFile(gokwikData);
  log.info("GoKwik file validated", {
    status: "validated",
    file: "gokwik",
    rowCount: gokwikMeta.rowCount,
  });

  if (shiprocketBuffer) {
    log.info("Validating Shiprocket file…", {
      status: "processing",
      file: "shiprocket",
    });
    const shiprocketMeta = validateShiprocketFile(shiprocketData);
    log.info("Shiprocket file validated", {
      status: "validated",
      file: "shiprocket",
      rowCount: shiprocketMeta.rowCount,
    });
  }

  log.info("Checking ITL data matches selected company…", {
    status: "processing",
    company,
  });
  const companyMeta = validateCompanyItlData(itlData, company);
  log.info("Company validation passed", {
    status: "validated",
    company,
    companySkuCount: companyMeta.companySkuCount,
  });

  log.info("Processing order rows…", { status: "processing" });

  const paymentMap = new Map();

  gokwikData.forEach((row) => {
    const orderId = cleanOrderNumber(row["Shopify Order Name"]);
    if (!orderId) return;
    const payment = normalizePayment(row["Payment Method"]);
    paymentMap.set(orderId, payment);
  });

  const outWorkbook = new ExcelJS.Workbook();
  const processedSheet = outWorkbook.addWorksheet("Processed");
  const skippedSheet = outWorkbook.addWorksheet("Skipped Rows");

  processedSheet.addRow([
    "Order Number",
    "Order Status",
    "Attempt Count",
    "Payment Method",
    "Order Month",
    "Final Status",
  ]);

  skippedSheet.addRow([
    "Source",
    "Order Number",
    "Order Status",
    "Attempt Count",
    "Payment Method",
    "Order Month",
    "Reason",
  ]);

  const ordersById = new Map();
  const skippedRows = [];

  function recordSkipped(row) {
    skippedSheet.addRow(row);
    skippedRows.push({
      source: row[0],
      orderNumber: row[1],
      orderStatus: row[2],
      attemptCount: row[3],
      paymentMethod: row[4],
      orderMonth: row[5],
      reason: row[6],
    });
  }

  function recordOrder(entry) {
    const existing = ordersById.get(entry.orderNumber);

    if (!existing) {
      ordersById.set(entry.orderNumber, entry);
      return;
    }

    const mergedStatus = mergeFinalStatus(
      existing.finalStatus,
      entry.finalStatus,
    );
    const bestRow = pickBetterOrderRow(existing, entry, mergedStatus);

    ordersById.set(entry.orderNumber, {
      ...bestRow,
      finalStatus: mergedStatus,
      sku: entry.sku || existing.sku,
      sourceName:
        entry.sourceName === "ITL" || existing.sourceName === "ITL"
          ? "ITL"
          : bestRow.sourceName,
    });

    recordSkipped([
      entry.sourceName,
      entry.orderNumber,
      entry.rawStatus,
      entry.attemptCount,
      entry.paymentMethod,
      entry.monthKey,
      `Merged duplicate → ${mergedStatus} (kept ${bestRow.rawOrder})`,
    ]);
  }

  function processRows(
    rows,
    sourceName,
    orderKey,
    statusKey,
    attemptKey,
    dateKey,
    productKey = null,
    skuKey = null,
  ) {
    rows.forEach((row) => {
      const rawOrder = row[orderKey];
      const orderNumber = cleanOrderNumber(rawOrder);
      const rawStatus = row[statusKey];
      const attemptCount = Number(row[attemptKey]) || 0;
      const rawDate = row[dateKey];

      const paymentMethod = paymentMap.get(orderNumber);
      const monthKey = getMonthKey(rawDate);

      if (!isDateInDayRange(rawDate, dayRange)) {
        return;
      }

      let productName = null;
      let sku = null;

      if (sourceName === "ITL" && productKey && skuKey) {
        productName = getCellString(row[productKey]);
        sku = getCellString(row[skuKey]).trim();

        if (!productName && PRODUCT_MAP[sku]) {
          productName = PRODUCT_MAP[sku];
        }
      }

      if (!orderNumber || !paymentMethod) {
        recordSkipped([
          sourceName,
          orderNumber,
          rawStatus,
          attemptCount,
          paymentMethod,
          monthKey,
          "Missing Order / Payment",
        ]);
        return;
      }

      const finalStatus = getFinalStatus(
        rawStatus,
        attemptCount,
        paymentMethod,
      );

      if (finalStatus === "Cancelled" || finalStatus === "Open") {
        recordSkipped([
          sourceName,
          orderNumber,
          rawStatus,
          attemptCount,
          paymentMethod,
          monthKey,
          `Excluded: ${finalStatus}`,
        ]);
        return;
      }

      recordOrder({
        orderNumber,
        rawOrder,
        fromSuffix: isSuffixOrder(rawOrder),
        sourceName,
        rawStatus,
        attemptCount,
        paymentMethod,
        monthKey,
        finalStatus,
        rawDate,
        sku,
      });
    });
  }

  processRows(
    itlData,
    "ITL",
    "Order Number",
    "Order Status",
    "Attempt Count",
    "Order Date",
    "Product Name",
    "Product SKU",
  );

  processRows(
    shiprocketData,
    "Shiprocket",
    "Order ID",
    "Status",
    "Attempt Count",
    "Shiprocket Created At",
  );

  const overallStats = initStats();
  const productStats = {};
  const dailyOverallStats = dayRange ? {} : null;
  const dailyProductStats = dayRange ? {} : null;
  const processedRows = [];

  for (const entry of ordersById.values()) {
    const {
      orderNumber,
      rawStatus,
      attemptCount,
      paymentMethod,
      monthKey,
      finalStatus,
      rawDate,
      sku,
      sourceName,
    } = entry;

    overallStats[paymentMethod].total++;
    overallStats[paymentMethod][finalStatus]++;

    if (dayRange) {
      const dateKey = getDateKey(rawDate);
      if (dateKey !== "UNKNOWN") {
        if (!dailyOverallStats[dateKey])
          dailyOverallStats[dateKey] = initStats();
        dailyOverallStats[dateKey][paymentMethod].total++;
        dailyOverallStats[dateKey][paymentMethod][finalStatus]++;
      }
    }

    if (sourceName === "ITL" && sku && PRODUCT_DISPLAY_MAP[sku]) {
      const key = sku;

      if (!productStats[key]) {
        productStats[key] = initStats();
      }

      productStats[key][paymentMethod].total++;
      productStats[key][paymentMethod][finalStatus]++;

      if (dayRange) {
        const dateKey = getDateKey(rawDate);
        if (dateKey !== "UNKNOWN") {
          if (!dailyProductStats[dateKey]) dailyProductStats[dateKey] = {};
          if (!dailyProductStats[dateKey][key]) {
            dailyProductStats[dateKey][key] = initStats();
          }
          dailyProductStats[dateKey][key][paymentMethod].total++;
          dailyProductStats[dateKey][key][paymentMethod][finalStatus]++;
        }
      }
    }

    processedSheet.addRow([
      orderNumber,
      rawStatus,
      attemptCount,
      paymentMethod,
      monthKey,
      finalStatus,
    ]);

    processedRows.push({
      orderNumber,
      orderStatus: rawStatus,
      attemptCount,
      paymentMethod,
      orderMonth: monthKey,
      finalStatus,
    });
  }

  const excelBuffer = Buffer.from(await outWorkbook.xlsx.writeBuffer());

  log.info("Processing complete", {
    status: "processed",
    processedCount: processedRows.length,
    skippedCount: skippedRows.length,
  });

  const dailyBreakdown = dayRange
    ? Object.keys(dailyOverallStats)
        .sort()
        .map((date) => ({
          date,
          overall: buildStatsTable(dailyOverallStats[date]),
          products: buildProductTableRows(
            dailyProductStats[date] || {},
            PRODUCT_DISPLAY_MAP,
          ),
        }))
    : null;

  return {
    company,
    dayRange,
    overall: buildStatsTable(overallStats),
    products: buildProductTableRows(productStats, PRODUCT_DISPLAY_MAP),
    dailyBreakdown,
    processedCount: processedRows.length,
    skippedCount: skippedRows.length,
    processedRows,
    skippedRows,
    excelBuffer,
  };
}

export function parseDayRange(startDay, endDay) {
  if (startDay == null || endDay == null || startDay === "" || endDay === "") {
    return null;
  }

  const start = Number(startDay);
  const end = Number(endDay);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end > 31 ||
    start > end
  ) {
    throw new Error(
      "Invalid day range. Use values between 1 and 31 with startDay <= endDay.",
    );
  }

  return { startDay: start, endDay: end };
}
