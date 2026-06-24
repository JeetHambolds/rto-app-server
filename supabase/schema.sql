-- Run this in the Supabase SQL editor

create table if not exists processing_runs (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('niconi', 'epitight')),
  start_day int check (start_day between 1 and 31),
  end_day int check (end_day between 1 and 31),
  processed_count int not null default 0,
  skipped_count int not null default 0,
  has_shiprocket boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists processing_runs_created_at_idx
  on processing_runs (created_at desc);

create index if not exists processing_runs_company_idx
  on processing_runs (company);

create table if not exists run_overall_stats (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references processing_runs (id) on delete cascade,
  stat_date date,
  cod_delivered int not null default 0,
  cod_rto int not null default 0,
  cod_total int not null default 0,
  prepaid_delivered int not null default 0,
  prepaid_rto int not null default 0,
  prepaid_total int not null default 0,
  unique (run_id, stat_date)
);

create index if not exists run_overall_stats_run_id_idx
  on run_overall_stats (run_id);

create table if not exists run_product_stats (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references processing_runs (id) on delete cascade,
  stat_date date,
  sku text not null,
  product_name text not null,
  cod_total int not null default 0,
  cod_rto int not null default 0,
  prepaid_total int not null default 0,
  prepaid_rto int not null default 0,
  unique (run_id, stat_date, sku)
);

create index if not exists run_product_stats_run_id_idx
  on run_product_stats (run_id);
