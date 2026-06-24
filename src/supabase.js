import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function pct(v, t) {
  return t ? ((v / t) * 100).toFixed(2) + "%" : "0.00%";
}

function overallRowsToDb(overall) {
  const delivered = overall.find((r) => r.label === "Delivered");
  const rto = overall.find((r) => r.label === "RTO");
  const total = overall.find((r) => r.label === "Grand Total");

  return {
    cod_delivered: delivered?.cod ?? 0,
    cod_rto: rto?.cod ?? 0,
    cod_total: total?.cod ?? 0,
    prepaid_delivered: delivered?.prepaid ?? 0,
    prepaid_rto: rto?.prepaid ?? 0,
    prepaid_total: total?.prepaid ?? 0,
  };
}

function overallDbToApi(row) {
  const overallDelivered = row.cod_delivered + row.prepaid_delivered;
  const overallRto = row.cod_rto + row.prepaid_rto;
  const overallTotal = row.cod_total + row.prepaid_total;

  return [
    {
      label: "Delivered",
      cod: row.cod_delivered,
      prepaid: row.prepaid_delivered,
      overall: overallDelivered,
    },
    {
      label: "RTO",
      cod: row.cod_rto,
      prepaid: row.prepaid_rto,
      overall: overallRto,
    },
    {
      label: "Grand Total",
      cod: row.cod_total,
      prepaid: row.prepaid_total,
      overall: overallTotal,
    },
    {
      label: "RTO %",
      cod: pct(row.cod_rto, row.cod_total),
      prepaid: pct(row.prepaid_rto, row.prepaid_total),
      overall: pct(overallRto, overallTotal),
    },
  ];
}

function productRowsToDb(products) {
  return products.map((p) => ({
    sku: p.sku,
    product_name: p.product,
    cod_total: p.codTotal,
    cod_rto: p.codRto,
    prepaid_total: p.prepaidTotal,
    prepaid_rto: p.prepaidRto,
  }));
}

function productDbToApi(rows) {
  return rows.map((row) => ({
    product: row.product_name,
    sku: row.sku,
    codTotal: row.cod_total,
    codRto: row.cod_rto,
    codRtoPerc: pct(row.cod_rto, row.cod_total),
    prepaidTotal: row.prepaid_total,
    prepaidRto: row.prepaid_rto,
    prepaidRtoPerc: pct(row.prepaid_rto, row.prepaid_total),
    overallRtoPerc: pct(
      row.cod_rto + row.prepaid_rto,
      row.cod_total + row.prepaid_total,
    ),
  }));
}

function toRunMeta(row) {
  return {
    id: row.id,
    company: row.company,
    dayRange:
      row.start_day != null && row.end_day != null
        ? { startDay: row.start_day, endDay: row.end_day }
        : null,
    processedCount: row.processed_count,
    skippedCount: row.skipped_count,
    hasShiprocket: row.has_shiprocket,
    createdAt: row.created_at,
  };
}

function assembleRun(runRow, overallRows, productRows) {
  const meta = toRunMeta(runRow);
  const totalOverall = overallRows.find((r) => r.stat_date == null);
  const dailyOverall = overallRows.filter((r) => r.stat_date != null);
  const totalProducts = productRows.filter((r) => r.stat_date == null);
  const dailyProducts = productRows.filter((r) => r.stat_date != null);

  const dailyBreakdown =
    dailyOverall.length > 0
      ? dailyOverall
          .sort((a, b) => String(a.stat_date).localeCompare(String(b.stat_date)))
          .map((dayRow) => ({
            date: dayRow.stat_date,
            overall: overallDbToApi(dayRow),
            products: productDbToApi(
              dailyProducts.filter(
                (p) => String(p.stat_date) === String(dayRow.stat_date),
              ),
            ),
          }))
      : null;

  return {
    ...meta,
    overall: totalOverall ? overallDbToApi(totalOverall) : [],
    products: productDbToApi(totalProducts),
    dailyBreakdown,
  };
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }
}

export async function saveProcessingRun(result, hasShiprocket) {
  requireSupabase();

  const { data: run, error: insertError } = await supabase
    .from("processing_runs")
    .insert({
      company: result.company,
      start_day: result.dayRange?.startDay ?? null,
      end_day: result.dayRange?.endDay ?? null,
      processed_count: result.processedCount,
      skipped_count: result.skippedCount,
      has_shiprocket: hasShiprocket,
    })
    .select()
    .single();

  if (insertError) throw insertError;

  const overallInserts = [
    { run_id: run.id, stat_date: null, ...overallRowsToDb(result.overall) },
  ];

  const productInserts = productRowsToDb(result.products).map((row) => ({
    run_id: run.id,
    stat_date: null,
    ...row,
  }));

  if (result.dailyBreakdown?.length) {
    for (const day of result.dailyBreakdown) {
      overallInserts.push({
        run_id: run.id,
        stat_date: day.date,
        ...overallRowsToDb(day.overall),
      });
      for (const product of productRowsToDb(day.products)) {
        productInserts.push({
          run_id: run.id,
          stat_date: day.date,
          ...product,
        });
      }
    }
  }

  const { error: overallError } = await supabase
    .from("run_overall_stats")
    .insert(overallInserts);

  if (overallError) {
    await supabase.from("processing_runs").delete().eq("id", run.id);
    throw overallError;
  }

  if (productInserts.length > 0) {
    const { error: productError } = await supabase
      .from("run_product_stats")
      .insert(productInserts);

    if (productError) {
      await supabase.from("processing_runs").delete().eq("id", run.id);
      throw productError;
    }
  }

  return assembleRun(run, overallInserts, productInserts);
}

export async function listProcessingRuns(limit = 50) {
  requireSupabase();

  const { data: runs, error: runsError } = await supabase
    .from("processing_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (runsError) throw runsError;
  if (!runs.length) return [];

  const runIds = runs.map((r) => r.id);
  const { data: overallStats, error: statsError } = await supabase
    .from("run_overall_stats")
    .select("*")
    .in("run_id", runIds)
    .is("stat_date", null);

  if (statsError) throw statsError;

  const statsByRunId = new Map(overallStats.map((s) => [s.run_id, s]));

  return runs.map((run) => {
    const overallRow = statsByRunId.get(run.id);
    return {
      ...toRunMeta(run),
      overall: overallRow ? overallDbToApi(overallRow) : [],
    };
  });
}

export async function getProcessingRun(id) {
  requireSupabase();

  const { data: run, error: runError } = await supabase
    .from("processing_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (runError) throw runError;

  const { data: overallStats, error: overallError } = await supabase
    .from("run_overall_stats")
    .select("*")
    .eq("run_id", id);

  if (overallError) throw overallError;

  const { data: productStats, error: productError } = await supabase
    .from("run_product_stats")
    .select("*")
    .eq("run_id", id);

  if (productError) throw productError;

  return assembleRun(run, overallStats, productStats);
}
