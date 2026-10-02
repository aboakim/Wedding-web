const SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  phone text,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'PHOTOGRAPHER',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role CHECK (role IN ('PHOTOGRAPHER','SUPER_ADMIN','SUPPORT','FINANCE','TECH'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL,
  currency text NOT NULL DEFAULT 'AMD',
  max_photos integer NOT NULL,
  storage_limit_bytes bigint NOT NULL,
  retention_days integer NOT NULL,
  features jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id text NOT NULL REFERENCES plans(id),
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status CHECK (status IN ('PENDING','PAYMENT_STARTED','PAID','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')),
  CONSTRAINT orders_idem UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,
  provider_transaction_id text,
  provider_event_id text UNIQUE,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  raw_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_ledger (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  event_id text UNIQUE NOT NULL,
  transaction_id text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  merchant_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_ledger_one_paid ON provider_ledger (order_id) WHERE status = 'SUCCEEDED';

CREATE TABLE IF NOT EXISTS weddings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  order_id uuid UNIQUE REFERENCES orders(id),
  name text NOT NULL,
  couple text NOT NULL,
  event_date date,
  slug text UNIQUE NOT NULL,
  status text NOT NULL,
  processing_status text NOT NULL,
  allow_downloads boolean NOT NULL DEFAULT true,
  allow_sharing boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT weddings_status CHECK (status IN ('RESERVED','ACTIVE','ARCHIVED')),
  CONSTRAINT weddings_processing CHECK (processing_status IN ('CREATED','UPLOADING','PROCESSING','PARTIALLY_READY','READY','FAILED','ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  wedding_id uuid NOT NULL REFERENCES weddings(id),
  storage_key_original text,
  storage_key_thumbnail text,
  expected_hash text,
  file_hash text,
  file_size bigint,
  mime_type text,
  width integer,
  height integer,
  filename text,
  capture_time timestamptz,
  part_count integer,
  status text NOT NULL,
  error text,
  faces integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photos_status CHECK (status IN ('UPLOADING','UPLOADED','PROCESSING','READY','FAILED','DELETED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS photos_live_hash ON photos (wedding_id, expected_hash)
  WHERE expected_hash IS NOT NULL AND status IN ('UPLOADING','UPLOADED','PROCESSING','READY');

CREATE INDEX IF NOT EXISTS photos_wedding ON photos (wedding_id, status);

CREATE TABLE IF NOT EXISTS faces (
  id bigserial PRIMARY KEY,
  photo_id uuid NOT NULL REFERENCES photos(id),
  wedding_id uuid NOT NULL,
  embedding double precision[] NOT NULL,
  confidence real,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faces_wedding ON faces (wedding_id);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id uuid PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  wedding_id uuid NOT NULL REFERENCES weddings(id),
  photo_ids uuid[] NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
  token_hash text PRIMARY KEY,
  wedding_id uuid NOT NULL REFERENCES weddings(id),
  photo_ids uuid[] NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY,
  guest_session_id uuid,
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  photo_id uuid,
  wedding_id uuid,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  error text,
  payload jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_ready ON jobs (status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_photo ON jobs (photo_id, type)
  WHERE photo_id IS NOT NULL AND status IN ('PENDING','RETRY','RUNNING');

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text PRIMARY KEY,
  hits integer NOT NULL,
  reset_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_offers (
  plan_id text NOT NULL REFERENCES plans(id),
  occasion text NOT NULL,
  price integer NOT NULL,
  max_photos integer NOT NULL,
  photos_plus boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_id, occasion)
);
`;

const SEED = `
INSERT INTO plans (id, name, price, currency, max_photos, storage_limit_bytes, retention_days, features, active)
VALUES
  ('START', 'START', 5000, 'AMD', 1000, 536870912000, 365, '{"downloads":true,"sharing":true,"watermark":false,"branding":true,"photos_plus":false,"points":["custom domain","photographer-ի ամբողջական branding","analytics","WhatsApp/Telegram delivery","ավելի երկար storage"]}'::jsonb, true),
  ('PRO', 'PRO', 10000, 'AMD', 5000, 536870912000, 365, '{"downloads":true,"sharing":true,"watermark":false,"branding":true,"photos_plus":false,"points":["custom domain","photographer-ի ամբողջական branding","analytics","WhatsApp/Telegram delivery","ավելի երկար storage"]}'::jsonb, true),
  ('PREMIUM', 'PREMIUM', 20000, 'AMD', 10000, 536870912000, 365, '{"downloads":true,"sharing":true,"watermark":false,"branding":true,"photos_plus":true,"points":["custom domain","photographer-ի ամբողջական branding","analytics","WhatsApp/Telegram delivery","ավելի երկար storage"]}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  max_photos = EXCLUDED.max_photos,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  retention_days = EXCLUDED.retention_days,
  features = EXCLUDED.features,
  active = true;

UPDATE plans SET active = false WHERE id IN ('BASIC', 'BUSINESS');

INSERT INTO plan_offers (plan_id, occasion, price, max_photos, photos_plus) VALUES
  ('START', 'WEDDING', 5000, 1000, false),
  ('PRO', 'WEDDING', 10000, 5000, false),
  ('PREMIUM', 'WEDDING', 20000, 10000, true),
  ('START', 'CHRISTENING', 2000, 300, false),
  ('PRO', 'CHRISTENING', 4000, 700, false),
  ('PREMIUM', 'CHRISTENING', 6000, 1000, true),
  ('START', 'BIRTHDAY', 1500, 200, false),
  ('PRO', 'BIRTHDAY', 3000, 500, false),
  ('PREMIUM', 'BIRTHDAY', 5000, 1000, true),
  ('START', 'GATHERING', 2000, 300, false),
  ('PRO', 'GATHERING', 4000, 700, false),
  ('PREMIUM', 'GATHERING', 6000, 1000, true),
  ('START', 'LAST_BELL', 2000, 300, false),
  ('PRO', 'LAST_BELL', 4000, 700, false),
  ('PREMIUM', 'LAST_BELL', 7000, 1500, true),
  ('START', 'PARTY', 2000, 300, false),
  ('PRO', 'PARTY', 4000, 700, false),
  ('PREMIUM', 'PARTY', 6000, 1500, true),
  ('START', 'OTHER', 1500, 200, false),
  ('PRO', 'OTHER', 3000, 500, false),
  ('PREMIUM', 'OTHER', 5000, 1000, true)
ON CONFLICT (plan_id, occasion) DO UPDATE SET
  price = EXCLUDED.price,
  max_photos = EXCLUDED.max_photos,
  photos_plus = EXCLUDED.photos_plus;

INSERT INTO settings (key, value) VALUES
  ('FACE_MATCH_THRESHOLD', '0.50'),
  ('POLICY_VERSION', '2026-10-02')
ON CONFLICT (key) DO NOTHING;
`;

export async function migrate(query) {
  await query(SQL);
  await query(SEED);
  await query(`INSERT INTO schema_migrations (id) VALUES ('001') ON CONFLICT DO NOTHING`);
  await query(`ALTER TABLE weddings ADD COLUMN IF NOT EXISTS couple_token text`);
  await query(`ALTER TABLE guest_sessions ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'GUEST'`);
  await query(`UPDATE weddings SET couple_token = replace(gen_random_uuid()::text, '-', '') WHERE couple_token IS NULL`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS weddings_couple_token ON weddings (couple_token)`);
  await query(`ALTER TABLE weddings ADD COLUMN IF NOT EXISTS occasion text NOT NULL DEFAULT 'WEDDING'`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand text`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 text`);
}
