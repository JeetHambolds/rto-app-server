-- Run this in the Supabase SQL editor

-- ---------------------------------------------------------------------------
-- App users (RTO / RECO)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('RTO', 'RECO')),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, user_type)
);

CREATE INDEX IF NOT EXISTS idx_app_users_user_type_is_approved
  ON public.app_users (user_type, is_approved);

CREATE INDEX IF NOT EXISTS idx_app_users_email_user_type
  ON public.app_users (email, user_type);

ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Refresh tokens (opaque tokens stored hashed; access JWTs stay client-side)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
  ON public.refresh_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON public.refresh_tokens (user_id);

ALTER TABLE public.refresh_tokens DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Processing runs
-- ---------------------------------------------------------------------------

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
