# Niconi RTO Server

Express API that merges ITL, GoKwik, and optional Shiprocket CSV exports, computes RTO analytics per company (Niconi / Epitight), returns stats + Excel output, and persists runs to Supabase.

## Tech stack

- Node.js (ES modules)
- Express 4 + Multer
- csv-parse, ExcelJS
- Supabase

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (for run history)

## Setup

```bash
cd niconi-rto-server
npm install
cp .env.example .env
```

### Environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | From Settings → API |
| `PORT` | Server port | `3001` |
| `RATE_LIMIT_MAX` | Max API requests per window (default: 45) | `45` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms (default: 1 hour) | `3600000` |

### Database

Run `supabase/schema.sql` in the Supabase SQL editor before using run history endpoints.

## Run

```bash
npm run dev    # watch mode
# or
npm start
```

Server starts at `http://localhost:3001` (or your `PORT`).

## Rate limiting

All `/api/*` routes are limited to **45 requests per hour** per IP by default (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`). When exceeded, the server responds with `429 Too Many Requests`:

```json
{ "error": "Rate limit exceeded. Maximum 45 requests per hour." }
```

Standard `RateLimit-*` response headers are included.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/companies` | List supported companies |
| `POST` | `/api/process` | Upload & process CSVs |
| `GET` | `/api/runs` | List past runs (last 50) |
| `GET` | `/api/runs/:id` | Get a single run |

### `POST /api/process`

Multipart form fields:

| Field | Required | Description |
|-------|----------|-------------|
| `company` | No | `niconi` or `epitight` (default: `niconi`) |
| `startDay` | No | Day-of-month filter start (1–31) |
| `endDay` | No | Day-of-month filter end (1–31) |
| `itl` | Yes | ITL order CSV |
| `gokwik` | Yes | GoKwik payment CSV |
| `shiprocket` | No | Shiprocket order CSV |

Response includes stats, `excelBase64`, and a `logs` array with processing steps.

## Logging

Each `/api/process` request gets a short request ID and structured logs written to the **server console** and returned in the JSON `logs` field.

Example console output:

```
[a1b2c3d4] Processing request received {"status":"started","company":"niconi"}
[a1b2c3d4] Files received {"status":"processing","itl":{...},"gokwik":{...}}
[a1b2c3d4] Validating ITL file… {"status":"processing","file":"itl"}
[a1b2c3d4] ITL file validated {"status":"validated","file":"itl","rowCount":1200}
[a1b2c3d4] Processing complete {"status":"processed","processedCount":980,"skippedCount":45}
[a1b2c3d4] Request completed successfully {"status":"completed"}
```

Log `status` values:

| Status | Meaning |
|--------|---------|
| `started` | Request received |
| `processing` | File validation or row processing in progress |
| `validated` | A file passed validation |
| `processed` | Row processing finished |
| `saved` | Run persisted to Supabase |
| `completed` | Full request succeeded |
| `failed` | Error occurred |

On validation or processing errors, logs are still returned so you can see how far processing got.

## File validation

### File type checks

The server rejects swapped or wrong exports:

- **ITL** must have: `Order Number`, `Order Status`, `Attempt Count`, `Order Date`
- **GoKwik** must have: `Shopify Order Name`, `Payment Method`
- **Shiprocket** (if provided) must have: `Order ID`, `Status`, `Attempt Count`, `Shiprocket Created At`

If an ITL slot receives a GoKwik file (or vice versa), processing fails with a clear error.

### Company checks

When `company` is `niconi` or `epitight`, the ITL CSV is checked for:

- Product SKUs belonging to the **other** company → rejected
- Product names containing the wrong brand → rejected
- No recognized SKUs for the selected company → rejected

## CSV column reference

### ITL

| Column | Usage |
|--------|-------|
| `Order Number` | Order ID |
| `Order Status` | Delivery / RTO status |
| `Attempt Count` | Delivery attempts |
| `Order Date` | Date filtering & breakdown |
| `Product SKU` | Product stats & company validation |
| `Product Name` | Display fallback & brand validation |

### GoKwik

| Column | Usage |
|--------|-------|
| `Shopify Order Name` | Order ID (payment lookup) |
| `Payment Method` | `cod` → COD, else PREPAID |

### Shiprocket (optional)

| Column | Usage |
|--------|-------|
| `Order ID` | Order number |
| `Status` | Order status |
| `Attempt Count` | Delivery attempts |
| `Shiprocket Created At` | Date filtering |

## Project structure

```
src/
├── index.js           # Express app & routes
├── processor.js       # CSV parsing & RTO logic
├── validate.js        # File type & company validation
├── productConfigs.js  # Niconi / Epitight SKU maps
├── logger.js          # Request-scoped logging
└── supabase.js        # Run persistence
supabase/
└── schema.sql         # Database schema
```

## Supported companies & SKUs

**Niconi:** `DTanPack`, `B07NGMYJX6`, `JADTATVA01`, `B0GH71SCC1`, `B0F1TDDNGD`

**Epitight:** `B0DNDYWH4L`, `4R-J0EZ-9CL2`, `B0CVQSBQXQ`, `B0F6NKMVGZ`, `B0D8J6JBZ6`, `B0F38FVPPP`, `B0F5CL1D9H`, `B0DM6HD2XM`
