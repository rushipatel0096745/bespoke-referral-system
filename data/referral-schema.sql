-- ============================================================================
-- REFERRAL SYSTEM - Supabase schema
-- ----------------------------------------------------------------------------
-- Two tables:
--   referrer    - the lookup the edge function reads (one row per Memory Catcher)
--   commission  - written by the Stripe webhook, read by the hub dashboard
-- ============================================================================

-- ---- REFERRER (the registry) ----------------------------------------------
create table if not exists referrer (
  slug        text primary key,          -- salamata-bah   (the URL segment)
  name        text not null,             -- Salamata       (display first name)
  photo       text,                      -- /assets/...headshot.webp
  offer       text,                      -- short offer sentence shown on page
  code        text,                      -- display discount code (e.g. SALAMATA)
  stripe_ref  text not null,             -- STABLE id written to Stripe metadata
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- stripe_ref is what appears in Stripe + commission rows. Keep it STABLE even
-- if the slug is renamed later (DECISION #4), so historical attribution holds.
create unique index if not exists referrer_stripe_ref_idx on referrer (stripe_ref);

-- Public read (anon key) is fine for the edge lookup: only non-sensitive
-- display fields + the ref. Enable RLS and expose a read-only policy.
alter table referrer enable row level security;

create policy "referrer public read"
  on referrer for select
  using (active = true);

-- ---- COMMISSION (written by webhook, read by hub dashboard) ----------------
create table if not exists commission (
  order_id        text primary key,      -- Stripe checkout session id (idempotent)
  payment_intent  text,
  referrer_ref    text not null references referrer (stripe_ref),
  amount_total    integer not null,      -- pence
  currency        text not null default 'gbp',
  customer_email  text,
  created_at      timestamptz not null default now()
);

create index if not exists commission_referrer_idx on commission (referrer_ref);
create index if not exists commission_created_idx  on commission (created_at);

-- Commission rows are written by the service role (webhook) only; the hub
-- dashboard reads them filtered to the logged-in franchisee.
alter table commission enable row level security;

-- (Add a policy matching your hub auth, e.g. franchisee can read their own.)

-- ---- SEED (Salamata + Ashley) ----------------------------------------------
insert into referrer (slug, name, photo, offer, code, stripe_ref) values
  ('salamata-bah', 'Salamata', '/assets/mc-ashley.webp',
   'Use the code below to receive a FREE extra copy of your print. Perfect for gifting to grandparents.',
   'SALAMATA', 'ref_salamata_bah'),
  ('ashley-eccleston', 'Ashley', '/assets/mc-ashley-1000.webp',
   'A little welcome gift from the original Memory Catcher.',
   'ASHLEY', 'ref_ashley_eccleston')
on conflict (slug) do nothing;
