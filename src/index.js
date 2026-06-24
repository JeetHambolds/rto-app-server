import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  processOrderData,
  parseDayRange,
  PRODUCT_CONFIGS,
} from "./processor.js";
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
    try {
      const company = (req.body.company || "niconi").toLowerCase();
      const dayRange = parseDayRange(req.body.startDay, req.body.endDay);

      const files = req.files || {};
      const itlFile = files.itl?.[0];
      const gokwikFile = files.gokwik?.[0];
      const shiprocketFile = files.shiprocket?.[0];

      if (!itlFile) {
        return res.status(400).json({ error: "ITL CSV is required" });
      }

      if (!gokwikFile) {
        return res.status(400).json({ error: "GoKwik CSV is required" });
      }

      const result = await processOrderData({
        company,
        dayRange,
        itlBuffer: itlFile.buffer,
        gokwikBuffer: gokwikFile.buffer,
        shiprocketBuffer: shiprocketFile?.buffer ?? null,
      });

      const savedRun = await saveProcessingRun(result, Boolean(shiprocketFile));

      const { excelBuffer, ...jsonResult } = result;

      res.json({
        ...jsonResult,
        id: savedRun.id,
        createdAt: savedRun.createdAt,
        excelBase64: excelBuffer.toString("base64"),
      });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || "Processing failed" });
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
