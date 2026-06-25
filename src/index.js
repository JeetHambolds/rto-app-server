import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "crypto";
import {
  processOrderData,
  parseDayRange,
  PRODUCT_CONFIGS,
} from "./processor.js";
import { createRequestLogger } from "./logger.js";
import {
  supabaseConfigured,
  saveProcessingRun,
  listProcessingRuns,
  getProcessingRun,
} from "./supabase.js";

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (
      file.mimetype === "text/csv" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", supabase: supabaseConfigured });
});

app.get("/api/companies", (_req, res) => {
  res.json({
    companies: Object.keys(PRODUCT_CONFIGS).map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    })),
  });
});

app.get("/api/runs", async (_req, res) => {
  try {
    const runs = await listProcessingRuns();
    res.json({ runs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch runs" });
  }
});

app.get("/api/runs/:id", async (req, res) => {
  try {
    const run = await getProcessingRun(req.params.id);
    res.json(run);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: err.message || "Run not found" });
  }
});

app.post(
  "/api/process",
  upload.fields([
    { name: "itl", maxCount: 1 },
    { name: "gokwik", maxCount: 1 },
    { name: "shiprocket", maxCount: 1 },
  ]),
  async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    const logger = createRequestLogger(requestId);

    try {
      const company = (req.body.company || "niconi").toLowerCase();

      if (!PRODUCT_CONFIGS[company]) {
        logger.error("Invalid company", { company });
        return res.status(400).json({
          error: "company must be niconi or epitight",
          logs: logger.getLogs(),
        });
      }

      logger.info("Processing request received", {
        status: "started",
        company,
        startDay: req.body.startDay || null,
        endDay: req.body.endDay || null,
      });

      const dayRange = parseDayRange(req.body.startDay, req.body.endDay);

      const files = req.files || {};
      const itlFile = files.itl?.[0];
      const gokwikFile = files.gokwik?.[0];
      const shiprocketFile = files.shiprocket?.[0];

      if (!itlFile) {
        logger.error("ITL CSV missing");
        return res.status(400).json({
          error: "ITL CSV is required",
          logs: logger.getLogs(),
        });
      }

      if (!gokwikFile) {
        logger.error("GoKwik CSV missing");
        return res.status(400).json({
          error: "GoKwik CSV is required",
          logs: logger.getLogs(),
        });
      }

      logger.info("Files received", {
        status: "processing",
        itl: { name: itlFile.originalname, size: itlFile.size },
        gokwik: { name: gokwikFile.originalname, size: gokwikFile.size },
        shiprocket: shiprocketFile
          ? { name: shiprocketFile.originalname, size: shiprocketFile.size }
          : null,
      });

      const result = await processOrderData({
        company,
        dayRange,
        itlBuffer: itlFile.buffer,
        gokwikBuffer: gokwikFile.buffer,
        shiprocketBuffer: shiprocketFile?.buffer ?? null,
        logger,
      });

      logger.info("Saving run to database…", { status: "processing" });
      const savedRun = await saveProcessingRun(result, Boolean(shiprocketFile));
      logger.info("Run saved", { status: "saved", runId: savedRun.id });

      const { excelBuffer, ...jsonResult } = result;

      logger.info("Request completed successfully", { status: "completed" });

      res.json({
        ...jsonResult,
        id: savedRun.id,
        createdAt: savedRun.createdAt,
        excelBase64: excelBuffer.toString("base64"),
        logs: logger.getLogs(),
      });
    } catch (err) {
      logger.error(err.message || "Processing failed", { status: "failed" });
      console.error(err);
      res.status(400).json({
        error: err.message || "Processing failed",
        logs: logger.getLogs(),
      });
    }
  },
);

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!supabaseConfigured) {
    console.warn(
      "Warning: Supabase not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
    );
  }
});
