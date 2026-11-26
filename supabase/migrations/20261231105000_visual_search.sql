-- Visual product search (search by image)
--
-- Additive only. Nothing existing is dropped, renamed or rewritten, and no row of any
-- existing table changes.
--
-- 1. pgvector is switched on (Supabase ships it; it lives in the `extensions` schema).
-- 2. public.image_search_embeddings is the embedding *cache*: one row per image content and
--    model, so the same picture used by several products or variants is embedded once.
--    A cosine HNSW index answers the nearest-neighbour query.
-- 3. public.image_search_images is the per-product index state: one row per candidate image
--    (a product picture, or the picture a variant carries), with its eligibility, indexing
--    status, retry count and the content hash that points at the cached vector.
-- 4. public.image_search_settings is the single settings row (enabled, similarity threshold,
--    result cap and the embedding model the stored vectors belong to).
-- 5. public.image_search_jobs tracks backfill / reindex / retry runs; at most one job can be
--    queued or running at a time, which is what stops two operators reindexing at once.
-- 6. public.image_search_queries is the anonymised search log the admin screen reads: the
--    image hash, the model, the top matches, the product clicked and the outcome. A customer
--    photograph is never stored.
-- 7. Triggers keep the index in step with the catalogue: a new or replaced product picture,
--    a new or changed variant picture and a deletion all queue or remove exactly the rows
--    they affect, idempotently (the same event twice leaves one row).
-- 8. `image_search.manage` is the new permission behind every admin route.
--
-- Customer access is denied by default: RLS is enabled with no policies and every grant is
-- revoked from anon/authenticated. The API reaches these tables with the service role, and
-- the admin endpoints reach them through the SECURITY DEFINER functions below, each of which
-- checks the caller's permission again.

create extension if not exists vector with schema extensions;

begin;

create type public.image_search_status as enum ('pending', 'processing', 'indexed', 'failed', 'excluded');
create type public.image_search_kind as enum ('primary', 'gallery', 'variant');
create type public.image_search_job_kind as enum ('backfill', 'reindex_all', 'retry_failed');
create type public.image_search_job_status as enum ('queued', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------- the embedding cache

-- The embedding cache: one row per image content and model. The column is declared with the
-- configured model's width (512 for CLIP ViT-B/32) because an HNSW index needs a fixed
-- dimension; a model with a different width needs a migration that rebuilds this column.
create table public.image_search_embeddings (
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  model text not null check (char_length(model) between 1 and 120),
  dimensions integer not null check (dimensions = 512),
  embedding extensions.vector(512) not null,
  created_at timestamp with time zone not null default now(),
  primary key (content_hash, model)
);

-- Cosine distance: embeddings are L2-normalised by the provider, so cosine is the
-- similarity the model was trained and calibrated for.
create index image_search_embeddings_hnsw_idx
  on public.image_search_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- per-image index state

create table public.image_search_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  product_image_id uuid references public.product_images(id) on delete cascade,
  -- The row this candidate was derived from: product_images.id for a product picture,
  -- product_variants.id for a variant picture. Deterministic, so enqueueing twice is a no-op.
  source_ref uuid not null,
  kind public.image_search_kind not null,
  is_primary boolean not null default false,
  -- A media base key (products/<product>/<image>) or, for a variant, the public URL the
  -- admin stored. The worker reads whichever it is through the media host only.
  source_key text not null check (char_length(source_key) between 1 and 1000),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  model text,
  dimensions integer,
  status public.image_search_status not null default 'pending',
  exclusion_reason text check (exclusion_reason is null or char_length(exclusion_reason) between 1 and 200),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  next_attempt_at timestamp with time zone not null default now(),
  job_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint image_search_images_status_shape check (
    (status = 'indexed' and content_hash is not null and model is not null and dimensions is not null)
    or (status <> 'indexed' and exclusion_reason is null)
    or (status = 'excluded' and exclusion_reason is not null)
  )
);

-- One state row per source. Re-running an enqueue for the same picture updates the row.
create unique index image_search_images_source_key
  on public.image_search_images (kind, source_ref);

create index image_search_images_product_idx on public.image_search_images (product_id);
create index image_search_images_variant_idx
  on public.image_search_images (variant_id)
  where variant_id is not null;
create index image_search_images_pending_idx
  on public.image_search_images (next_attempt_at, created_at)
  where status = 'pending';
create index image_search_images_content_hash_idx
  on public.image_search_images (content_hash, model)
  where content_hash is not null;
create index image_search_images_job_idx
  on public.image_search_images (job_id)
  where job_id is not null;

-- ---------------------------------------------------------------- settings

create table public.image_search_settings (
  id boolean primary key default true,
  enabled boolean not null default true,
  similarity_threshold real not null default 0.70
    check (similarity_threshold >= 0 and similarity_threshold <= 1),
  max_results integer not null default 60 check (max_results between 1 and 120),
  -- The model the stored vectors belong to. Changing it means the catalogue must be
  -- reindexed; the admin screen says so instead of silently mixing incompatible vectors.
  model text not null default 'Xenova/clip-vit-base-patch32' check (char_length(model) between 1 and 120),
  model_version text not null default '1' check (char_length(model_version) between 1 and 60),
  dimensions integer not null default 512 check (dimensions = 512),
  last_indexed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint image_search_settings_single_row check (id)
);

insert into public.image_search_settings (id) values (true) on conflict (id) do nothing;

create table public.image_search_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.image_search_job_kind not null,
  status public.image_search_job_status not null default 'queued',
  total integer not null default 0 check (total >= 0),
  indexed integer not null default 0 check (indexed >= 0),
  failed integer not null default 0 check (failed >= 0),
  excluded integer not null default 0 check (excluded >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error text check (error is null or char_length(error) <= 500)
);

-- One operator at a time: a second reindex request is refused while one is queued or running.
create unique index image_search_jobs_one_active
  on public.image_search_jobs ((true))
  where status in ('queued', 'running');

alter table public.image_search_images
  add constraint image_search_images_job_fkey
  foreign key (job_id) references public.image_search_jobs(id) on delete set null;

-- ---------------------------------------------------------------- the anonymised search log

create table public.image_search_queries (
  id uuid primary key default gen_random_uuid(),
  image_hash text check (image_hash is null or image_hash ~ '^[0-9a-f]{64}$'),
  model text,
  threshold real,
  result_count integer not null default 0 check (result_count >= 0),
  top_product_ids uuid[] not null default '{}',
  clicked_product_id uuid references public.products(id) on delete set null,
  outcome text not null check (outcome in ('results', 'no_results', 'barcode', 'disabled')),
  client text check (client is null or client in ('web', 'android', 'api')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamp with time zone not null default now()
);

create index image_search_queries_created_idx on public.image_search_queries (created_at desc);
create index image_search_queries_clicked_idx
  on public.image_search_queries (clicked_product_id)
  where clicked_product_id is not null;

-- ---------------------------------------------------------------- lockdown

alter table public.image_search_embeddings enable row level security;
alter table public.image_search_images enable row level security;
alter table public.image_search_settings enable row level security;
alter table public.image_search_jobs enable row level security;
alter table public.image_search_queries enable row level security;

revoke all on public.image_search_embeddings from anon, authenticated;
revoke all on public.image_search_images from anon, authenticated;
revoke all on public.image_search_settings from anon, authenticated;
revoke all on public.image_search_jobs from anon, authenticated;
revoke all on public.image_search_queries from anon, authenticated;

grant select, insert, update, delete on public.image_search_embeddings to service_role;
grant select, insert, update, delete on public.image_search_images to service_role;
grant select, insert, update, delete on public.image_search_settings to service_role;
grant select, insert, update, delete on public.image_search_jobs to service_role;
grant select, insert, update, delete on public.image_search_queries to service_role;

-- ---------------------------------------------------------------- the permission

insert into public.permissions (name, description) values
  ('image_search.manage', 'Manage image search settings, indexing and search activity')
on conflict (name) do nothing;

insert into public.role_permissions (role, permission) values
  ('super_admin', 'image_search.manage'),
  ('admin', 'image_search.manage')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------- the eligibility policy
--
-- One place decides whether a picture may be indexed. A picture below the minimum size is
-- excluded with a reason rather than queued and retried as a failed embedding job. The
-- worker applies the same rules, and adds the checks that need the bytes (decodability and
-- the near-uniform "placeholder" heuristic).

create or replace function private.image_index_exclusion_reason(p_width integer, p_height integer)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_width is null or p_height is null then 'unknown_dimensions'
    when p_width < 128 or p_height < 128 then 'too_small'
    else null
  end;
$function$;

-- ---------------------------------------------------------------- queue helpers

/**
 * Queues one product picture. Called by the trigger on product_images; safe to run twice
 * (the unique source index turns the second insert into an update that keeps the status).
 */
create or replace function private.image_search_queue_product_image(p_image_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_image public.product_images;
  v_kind public.image_search_kind;
  v_primary boolean;
  v_reason text;
begin
  select * into v_image from public.product_images where id = p_image_id;
  if not found then
    return;
  end if;

  -- A finished row for a picture that has been replaced is stale: drop it first, so the
  -- unique (kind, source_ref) row always describes the picture currently stored.
  delete from public.image_search_images
  where kind in ('primary', 'gallery')
    and source_ref = p_image_id
    and source_key <> v_image.storage_key;

  v_primary := v_image.position = 0;
  v_kind := case when v_primary then 'primary'::public.image_search_kind else 'gallery'::public.image_search_kind end;
  v_reason := private.image_index_exclusion_reason(v_image.width, v_image.height);

  insert into public.image_search_images
    (product_id, product_image_id, source_ref, kind, is_primary, source_key, width, height,
     status, exclusion_reason)
  values
    (v_image.product_id, v_image.id, v_image.id, v_kind, v_primary, v_image.storage_key,
     v_image.width, v_image.height,
     case when v_reason is null then 'pending'::public.image_search_status else 'excluded'::public.image_search_status end,
     v_reason)
  on conflict (kind, source_ref) do update
    set product_id = excluded.product_id,
        product_image_id = excluded.product_image_id,
        is_primary = excluded.is_primary,
        source_key = excluded.source_key,
        width = excluded.width,
        height = excluded.height,
        -- A picture that is still the same keeps its indexed vector; a changed one starts again.
        status = case
          when public.image_search_images.source_key = excluded.source_key
            then public.image_search_images.status
          when excluded.status = 'excluded' then 'excluded'::public.image_search_status
          else 'pending'::public.image_search_status
        end,
        exclusion_reason = excluded.exclusion_reason,
        content_hash = case
          when public.image_search_images.source_key = excluded.source_key
            then public.image_search_images.content_hash
          else null
        end,
        attempts = case when public.image_search_images.source_key = excluded.source_key
          then public.image_search_images.attempts else 0 end,
        next_attempt_at = now(),
        updated_at = now();
end;
$function$;

/** The trigger body for product_images (insert, update and delete). */
create or replace function private.image_search_product_image_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.image_search_images
    where kind in ('primary', 'gallery') and source_ref = old.id;
    return old;
  end if;

  perform private.image_search_queue_product_image(new.id);
  return new;
end;
$function$;

/** Queues the picture a variant carries, or removes the row when it carries none. */
create or replace function private.image_search_queue_variant(p_variant_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_variant public.product_variants;
  v_url text;
begin
  select * into v_variant from public.product_variants where id = p_variant_id;
  if not found then
    return;
  end if;

  v_url := nullif(btrim(coalesce(v_variant.image_url, '')), '');
  if v_url is null then
    delete from public.image_search_images where kind = 'variant' and source_ref = p_variant_id;
    return;
  end if;

  delete from public.image_search_images
  where kind = 'variant' and source_ref = p_variant_id and source_key <> v_url;

  insert into public.image_search_images
    (product_id, variant_id, source_ref, kind, is_primary, source_key, status)
  values
    (v_variant.product_id, v_variant.id, v_variant.id, 'variant', false, v_url, 'pending')
  on conflict (kind, source_ref) do update
    set product_id = excluded.product_id,
        variant_id = excluded.variant_id,
        status = case
          when public.image_search_images.source_key = excluded.source_key
            then public.image_search_images.status
          else 'pending'::public.image_search_status
        end,
        source_key = excluded.source_key,
        content_hash = case
          when public.image_search_images.source_key = excluded.source_key
            then public.image_search_images.content_hash
          else null
        end,
        attempts = case when public.image_search_images.source_key = excluded.source_key
          then public.image_search_images.attempts else 0 end,
        exclusion_reason = case
          when public.image_search_images.source_key = excluded.source_key
            then public.image_search_images.exclusion_reason
          else null
        end,
        next_attempt_at = now(),
        updated_at = now();
end;
$function$;

create or replace function private.image_search_variant_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.image_search_images where kind = 'variant' and source_ref = old.id;
    return old;
  end if;

  perform private.image_search_queue_variant(new.id);
  return new;
end;
$function$;

drop trigger if exists product_images_image_search on public.product_images;
create trigger product_images_image_search
  after insert or update of storage_key, width, height, position or delete
  on public.product_images
  for each row execute function private.image_search_product_image_trigger();

drop trigger if exists product_variants_image_search on public.product_variants;
create trigger product_variants_image_search
  after insert or update of image_url or delete
  on public.product_variants
  for each row execute function private.image_search_variant_trigger();

/**
 * Queues everything currently in the catalogue that has no state row yet, re-evaluates the
 * eligibility of the pictures already queued, and returns how many rows are now pending.
 * Backfill, "Reindex All" and the first run after this migration all go through here, so
 * they apply the same policy.
 */
create or replace function public.image_search_queue_all()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_image record;
  v_pending integer;
begin
  -- Existing state rows: refresh the recorded size and the eligibility verdict.
  update public.image_search_images i
  set width = pi.width,
      height = pi.height,
      exclusion_reason = private.image_index_exclusion_reason(pi.width, pi.height),
      status = case
        when private.image_index_exclusion_reason(pi.width, pi.height) is not null
          and i.status <> 'excluded' then 'excluded'::public.image_search_status
        when private.image_index_exclusion_reason(pi.width, pi.height) is null
          and i.status = 'excluded' then 'pending'::public.image_search_status
        else i.status
      end,
      -- Only a picture that becomes eligible again goes back into the queue now; an
      -- unchanged failed row keeps its backoff instead of being retried by every reindex.
      next_attempt_at = case
        when private.image_index_exclusion_reason(pi.width, pi.height) is null
          and i.status = 'excluded' then now()
        else i.next_attempt_at
      end,
      updated_at = now()
  from public.product_images pi
  where pi.id = i.product_image_id
    and i.kind in ('primary', 'gallery');

  -- Product pictures with no state row at all.
  for v_image in
    select pi.id from public.product_images pi
    where not exists (
      select 1 from public.image_search_images i
      where i.kind in ('primary', 'gallery') and i.source_ref = pi.id
    )
  loop
    perform private.image_search_queue_product_image(v_image.id);
  end loop;

  -- Variant pictures with no state row.
  for v_image in
    select pv.id from public.product_variants pv
    where nullif(btrim(coalesce(pv.image_url, '')), '') is not null
      and not exists (
        select 1 from public.image_search_images i
        where i.kind = 'variant' and i.source_ref = pv.id
      )
  loop
    perform private.image_search_queue_variant(v_image.id);
  end loop;

  select count(*) into v_pending
  from public.image_search_images
  where status = 'pending';

  return coalesce(v_pending, 0);
end;
$function$;

-- ---------------------------------------------------------------- worker primitives

/**
 * Claims up to `p_limit` pending pictures for embedding. SKIP LOCKED lets two API instances
 * work side by side without ever embedding the same picture twice.
 */
create or replace function public.image_search_claim(p_limit integer, p_job_id uuid default null)
 returns table (
   id uuid,
   product_id uuid,
   variant_id uuid,
   product_image_id uuid,
   kind public.image_search_kind,
   source_key text,
   is_primary boolean,
   attempts integer
 )
 language sql
 security definer
 set search_path to ''
as $function$
  with claimed as (
    select i.id
    from public.image_search_images i
    where i.status = 'pending'
      and i.next_attempt_at <= now()
    order by i.next_attempt_at, i.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 200))
    for update skip locked
  )
  update public.image_search_images i
  set status = 'processing',
      attempts = i.attempts + 1,
      updated_at = now(),
      job_id = coalesce(p_job_id, i.job_id)
  from claimed c
  where i.id = c.id
  returning i.id, i.product_id, i.variant_id, i.product_image_id, i.kind, i.source_key,
            i.is_primary, i.attempts;
$function$;

/** Stores an embedding (once per content hash and model) and marks the picture indexed. */
create or replace function public.image_search_record_indexed(
  p_id uuid,
  p_content_hash text,
  p_model text,
  p_dimensions integer,
  p_embedding extensions.vector,
  p_width integer default null,
  p_height integer default null
)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  insert into public.image_search_embeddings (content_hash, model, dimensions, embedding)
  values (p_content_hash, p_model, p_dimensions, p_embedding)
  on conflict (content_hash, model) do nothing;

  update public.image_search_images
  set status = 'indexed',
      content_hash = p_content_hash,
      model = p_model,
      dimensions = p_dimensions,
      width = coalesce(p_width, width),
      height = coalesce(p_height, height),
      exclusion_reason = null,
      last_error = null,
      next_attempt_at = now(),
      updated_at = now()
  where id = p_id;

  update public.image_search_settings
  set last_indexed_at = now()
  where id;
end;
$function$;

/** A failed attempt: retried with backoff a few times, then parked as failed. */
create or replace function public.image_search_record_failure(
  p_id uuid,
  p_error text,
  p_retryable boolean default true,
  p_max_attempts integer default 3
)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.image_search_images where id = p_id;
  if not found then
    return;
  end if;

  update public.image_search_images
  set status = case
        when p_retryable and coalesce(v_attempts, 0) < greatest(1, coalesce(p_max_attempts, 3))
          then 'pending'::public.image_search_status
        else 'failed'::public.image_search_status
      end,
      last_error = left(coalesce(p_error, 'unknown error'), 500),
      next_attempt_at = case
        when p_retryable and coalesce(v_attempts, 0) < greatest(1, coalesce(p_max_attempts, 3))
          then now() + make_interval(secs => least(900, 30 * power(2, greatest(0, coalesce(v_attempts, 1) - 1))))
        else now()
      end,
      updated_at = now()
  where id = p_id;
end;
$function$;

/** A picture that the bytes themselves disqualify (undecodable, a placeholder, too small). */
create or replace function public.image_search_record_exclusion(p_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.image_search_images
  set status = 'excluded',
      exclusion_reason = left(coalesce(p_reason, 'ineligible'), 200),
      content_hash = null,
      model = null,
      dimensions = null,
      last_error = null,
      updated_at = now()
  where id = p_id;
end;
$function$;

/** Returns pictures left "processing" by an interrupted process to the queue. */
create or replace function public.image_search_recover_stale(p_stale_seconds integer default 600)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_count integer;
begin
  with stale as (
    update public.image_search_images
    set status = 'pending',
        next_attempt_at = now(),
        updated_at = now()
    where status = 'processing'
      and updated_at < now() - make_interval(secs => greatest(60, coalesce(p_stale_seconds, 600)))
    returning 1
  )
  select count(*) into v_count from stale;
  return coalesce(v_count, 0);
end;
$function$;

/**
 * Refreshes a job's counters from the pictures it claimed and finishes it once nothing is
 * left. Called by the worker after every batch, so progress is derived from real rows.
 */
create or replace function public.image_search_sync_job(p_job_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_indexed integer;
  v_failed integer;
  v_excluded integer;
  v_open integer;
begin
  select
    count(*) filter (where status = 'indexed'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'excluded'),
    count(*) filter (where status in ('pending', 'processing'))
  into v_indexed, v_failed, v_excluded, v_open
  from public.image_search_images
  where job_id = p_job_id;

  update public.image_search_jobs
  set indexed = coalesce(v_indexed, 0),
      failed = coalesce(v_failed, 0),
      excluded = coalesce(v_excluded, 0),
      status = case
        when coalesce(v_open, 0) = 0 then 'completed'::public.image_search_job_status
        else 'running'::public.image_search_job_status
      end,
      started_at = coalesce(started_at, now()),
      finished_at = case when coalesce(v_open, 0) = 0 then now() else null end
  where id = p_job_id
    and status in ('queued', 'running');
end;
$function$;

-- ---------------------------------------------------------------- nearest-neighbour search

/**
 * The nearest indexed pictures to a query embedding, best first. Only pictures of products
 * on sale are considered, and only vectors produced by the same model: embeddings of two
 * different models are never compared.
 */
create or replace function public.image_search_nearest(
  p_embedding extensions.vector,
  p_model text,
  p_dimensions integer,
  p_limit integer default 150
)
 returns table (
   image_id uuid,
   product_id uuid,
   kind public.image_search_kind,
   is_primary boolean,
   similarity real
 )
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with nearest as (
    select e.content_hash, (1 - (e.embedding OPERATOR(extensions.<=>) p_embedding))::real as similarity
    from public.image_search_embeddings e
    where e.model = p_model
      and e.dimensions = p_dimensions
    order by e.embedding OPERATOR(extensions.<=>) p_embedding
    limit greatest(1, least(coalesce(p_limit, 150), 500))
  )
  select i.id, i.product_id, i.kind, i.is_primary, n.similarity
  from nearest n
  join public.image_search_images i
    on i.content_hash = n.content_hash
   and i.model = p_model
   and i.status = 'indexed'
  join public.products p on p.id = i.product_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and c.is_active
  order by n.similarity desc, i.is_primary desc;
$function$;

/**
 * The product cards of a set of ids, priced exactly as catalog_products() prices them (a
 * live campaign first, the product's own sale price otherwise). Only products on sale are
 * returned, so an id that slipped out of the catalogue simply yields no card.
 */
create or replace function public.catalog_products_by_ids(p_ids uuid[])
 returns table (
   id uuid,
   slug text,
   sku text,
   name text,
   summary text,
   price_minor bigint,
   compare_at_price_minor bigint,
   stock_quantity integer,
   max_order_quantity integer,
   is_featured boolean,
   published_at timestamp with time zone,
   category_slug text,
   category_name text,
   campaign_id uuid,
   campaign_title text,
   campaign_ends_at timestamp with time zone,
   campaign_discount_kind campaign_discount_kind,
   campaign_discount_value bigint
 )
 language sql
 stable
 set search_path to ''
as $function$
  with matched as (
    select
      p.id, p.slug, p.sku, p.name, p.summary, p.price_minor, p.compare_at_price_minor,
      p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at,
      coalesce(p.compare_at_price_minor, p.price_minor) as list_minor,
      c.slug as category_slug, c.name as category_name
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.status = 'active'
      and c.is_active
      and p.id = any (coalesce(p_ids, '{}'::uuid[]))
  ),
  priced as (
    select
      m.*,
      k.campaign_id, k.campaign_title, k.ends_at as campaign_ends_at,
      k.discount_kind as campaign_discount_kind, k.discount_value as campaign_discount_value,
      case
        when k.campaign_id is null then m.price_minor
        else m.list_minor - public.campaign_discount_minor(
          m.list_minor, k.discount_kind, k.discount_value, k.max_discount_minor)
      end as effective_minor,
      case
        when k.campaign_id is null then m.compare_at_price_minor
        else m.list_minor
      end as effective_compare_minor
    from matched m
    left join public.product_campaigns(array(select m2.id from matched m2)) k on k.product_id = m.id
  )
  select
    f.id, f.slug, f.sku, f.name, f.summary, f.effective_minor, f.effective_compare_minor,
    f.stock_quantity, f.max_order_quantity, f.is_featured, f.published_at,
    f.category_slug, f.category_name,
    f.campaign_id, f.campaign_title, f.campaign_ends_at,
    f.campaign_discount_kind, f.campaign_discount_value
  from priced f;
$function$;

-- ---------------------------------------------------------------- search logging

create or replace function public.image_search_log(
  p_image_hash text,
  p_model text,
  p_threshold real,
  p_result_count integer,
  p_top_product_ids uuid[],
  p_outcome text,
  p_client text,
  p_duration_ms integer
)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  insert into public.image_search_queries
    (image_hash, model, threshold, result_count, top_product_ids, outcome, client, duration_ms)
  values
    (p_image_hash, p_model, p_threshold, greatest(0, coalesce(p_result_count, 0)),
     coalesce(p_top_product_ids, '{}'), coalesce(p_outcome, 'no_results'),
     p_client, p_duration_ms)
  returning id into v_id;
  return v_id;
end;
$function$;

/** Records which result a shopper opened. Only a search logged in the last day is matched. */
create or replace function public.image_search_record_click(p_id uuid, p_product_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.image_search_queries
  set clicked_product_id = p_product_id
  where id = p_id
    and created_at > now() - interval '1 day'
    and (p_product_id is null or p_product_id = any (top_product_ids));
  return found;
end;
$function$;

-- ---------------------------------------------------------------- admin reads and writes

/** The settings row as the admin screen reads it (image_search.manage). */
create or replace function public.admin_image_search_settings()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'enabled', s.enabled,
    'similarityThreshold', s.similarity_threshold,
    'maxResults', s.max_results,
    'model', s.model,
    'modelVersion', s.model_version,
    'dimensions', s.dimensions,
    'lastIndexedAt', s.last_indexed_at,
    'updatedAt', s.updated_at
  )
  from public.image_search_settings s
  where s.id
    and private.require_permission('image_search.manage') is not null;
$function$;

/**
 * Saves the settings and returns them. Disabling never deletes a vector; enabling never
 * fabricates one. A model change is allowed but reported, because the vectors stored for the
 * previous model are no longer comparable until the catalogue is reindexed.
 */
create or replace function public.admin_save_image_search_settings(
  p_enabled boolean,
  p_similarity_threshold real,
  p_max_results integer,
  p_model text,
  p_model_version text,
  p_dimensions integer
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := private.require_permission('image_search.manage');
  v_previous public.image_search_settings;
begin
  if p_enabled is null then
    raise exception 'enabled is required' using errcode = 'NZ412';
  end if;
  if p_similarity_threshold is null or p_similarity_threshold < 0 or p_similarity_threshold > 1 then
    raise exception 'the similarity threshold must be between 0 and 1' using errcode = 'NZ412';
  end if;
  if p_max_results is null or p_max_results < 1 or p_max_results > 120 then
    raise exception 'max results must be between 1 and 120' using errcode = 'NZ412';
  end if;
  if p_model is null or char_length(btrim(p_model)) not between 1 and 120 then
    raise exception 'the embedding model is required' using errcode = 'NZ412';
  end if;
  if p_model_version is null or char_length(btrim(p_model_version)) not between 1 and 60 then
    raise exception 'the model version is required' using errcode = 'NZ412';
  end if;
  if p_dimensions is null or p_dimensions <> 512 then
    raise exception 'the embedding dimensions must match the indexed vector column (512)' using errcode = 'NZ412';
  end if;

  select * into v_previous from public.image_search_settings where id;

  update public.image_search_settings
  set enabled = p_enabled,
      similarity_threshold = p_similarity_threshold,
      max_results = p_max_results,
      model = btrim(p_model),
      model_version = btrim(p_model_version),
      dimensions = p_dimensions,
      updated_by = v_actor,
      updated_at = now()
  where id;

  perform private.audit(v_actor, 'settings.saved', 'image_search_settings', 'image_search',
    jsonb_build_object(
      'enabled', p_enabled,
      'similarityThreshold', p_similarity_threshold,
      'maxResults', p_max_results,
      'model', btrim(p_model),
      'modelVersion', btrim(p_model_version),
      'dimensions', p_dimensions,
      'modelChanged', v_previous.model is distinct from btrim(p_model)
    ));

  return public.admin_image_search_settings();
end;
$function$;

/** Live index statistics, computed from the tables on every call (image_search.manage). */
create or replace function public.admin_image_search_stats()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with counted as (
    select
      count(*) filter (where i.status = 'indexed') as indexed,
      count(*) filter (where i.status = 'pending') as pending,
      count(*) filter (where i.status = 'processing') as processing,
      count(*) filter (where i.status = 'failed') as failed,
      count(*) filter (where i.status = 'excluded') as excluded,
      count(*) as candidates,
      count(distinct i.content_hash) filter (where i.status = 'indexed') as vectors,
      max(i.updated_at) filter (where i.status = 'indexed') as last_indexed_at
    from public.image_search_images i
  ),
  products as (
    select count(*) as total,
           count(*) filter (where p.status = 'active') as active
    from public.products p
    where p.status <> 'archived'
  ),
  models as (
    select coalesce(jsonb_object_agg(m.model, m.total), '{}'::jsonb) as by_model
    from (
      select e.model, count(*) as total
      from public.image_search_embeddings e
      group by e.model
    ) m
  )
  select jsonb_build_object(
    'indexed', c.indexed,
    'pending', c.pending,
    'processing', c.processing,
    'failed', c.failed,
    'excluded', c.excluded,
    'eligible', c.indexed + c.pending + c.processing + c.failed,
    'candidates', c.candidates,
    'uniqueVectors', c.vectors,
    'lastIndexedAt', coalesce(c.last_indexed_at, s.last_indexed_at),
    'products', p.total,
    'activeProducts', p.active,
    'vectorsByModel', m.by_model,
    'settings', jsonb_build_object(
      'enabled', s.enabled,
      'similarityThreshold', s.similarity_threshold,
      'maxResults', s.max_results,
      'model', s.model,
      'modelVersion', s.model_version,
      'dimensions', s.dimensions
    )
  )
  from counted c, products p, models m, public.image_search_settings s
  where s.id
    and private.require_permission('image_search.manage') is not null;
$function$;

/**
 * Products without a usable picture: either none at all, or every picture they have is
 * excluded. `reason` says which, so the screen can point at the real cause.
 */
create or replace function public.admin_image_search_missing_images(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total integer;
  v_rows jsonb;
begin
  perform private.require_permission('image_search.manage');

  -- One CTE per statement: a CTE belongs to the statement that declares it, so the count and
  -- the page both build the same candidate list rather than one reading the other's name.
  with candidates as (
    select
      p.id as product_id,
      p.name,
      p.sku,
      p.status::text as product_status,
      count(i.id) as images,
      count(i.id) filter (where i.status = 'indexed') as indexed,
      count(i.id) filter (where i.status = 'excluded') as excluded,
      min(i.exclusion_reason) as exclusion_reason
    from public.products p
    left join public.image_search_images i on i.product_id = p.id
    where p.status <> 'archived'
      and (v_query is null or p.name ilike '%' || v_query || '%' or p.sku ilike '%' || v_query || '%')
    group by p.id, p.name, p.sku, p.status
  ),
  missing as (
    select * from candidates c where c.images = 0 or c.indexed = 0
  )
  select count(*) into v_total from missing;

  with candidates as (
    select
      p.id as product_id,
      p.name,
      p.sku,
      p.status::text as product_status,
      count(i.id) as images,
      count(i.id) filter (where i.status = 'indexed') as indexed,
      count(i.id) filter (where i.status = 'excluded') as excluded,
      min(i.exclusion_reason) as exclusion_reason
    from public.products p
    left join public.image_search_images i on i.product_id = p.id
    where p.status <> 'archived'
      and (v_query is null or p.name ilike '%' || v_query || '%' or p.sku ilike '%' || v_query || '%')
    group by p.id, p.name, p.sku, p.status
  ),
  missing as (
    select * from candidates c where c.images = 0 or c.indexed = 0
  )
  select coalesce(jsonb_agg(row_to_json(m) order by m.name), '[]'::jsonb) into v_rows
  from (
    select
      c.product_id,
      c.name,
      c.sku,
      c.product_status,
      c.images,
      c.indexed,
      c.excluded,
      case
        when c.images = 0 then 'no_images'
        -- Every picture was refused by the eligibility policy: say which rule refused it.
        when c.indexed = 0 and c.excluded = c.images
          then coalesce(c.exclusion_reason, 'ineligible')
        -- Pictures exist and none has been embedded yet: queued, not ineligible.
        when c.indexed = 0 then 'pending'
        else null
      end as reason
    from missing c
    order by c.name
    limit v_limit offset v_offset
  ) m;

  return jsonb_build_object('items', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$function$;

/** The anonymised recent search log (image_search.manage). No image is ever stored. */
create or replace function public.admin_image_search_activity(
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total integer;
  v_rows jsonb;
begin
  perform private.require_permission('image_search.manage');

  -- Each statement carries its own CTE: a CTE is scoped to one statement, so the count and the
  -- page build the same filtered view rather than one referring to the other's name.
  with filtered as (
    select q.*
    from public.image_search_queries q
    where v_query is null
      or q.image_hash like v_query || '%'
      or q.outcome = v_query
      or exists (
        select 1 from public.products p
        where p.id = any (q.top_product_ids) and p.name ilike '%' || v_query || '%'
      )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select q.*
    from public.image_search_queries q
    where v_query is null
      or q.image_hash like v_query || '%'
      or q.outcome = v_query
      or exists (
        select 1 from public.products p
        where p.id = any (q.top_product_ids) and p.name ilike '%' || v_query || '%'
      )
  )
  select coalesce(jsonb_agg(row_to_json(m) order by m.created_at desc), '[]'::jsonb) into v_rows
  from (
    select
      f.id,
      f.created_at,
      f.image_hash,
      f.model,
      f.threshold,
      f.result_count,
      f.top_product_ids,
      f.clicked_product_id,
      cp.name as clicked_product_name,
      f.outcome,
      f.client,
      f.duration_ms
    from filtered f
    left join public.products cp on cp.id = f.clicked_product_id
    order by f.created_at desc
    limit v_limit offset v_offset
  ) m;

  return jsonb_build_object('items', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$function$;

/** The most recent jobs, newest first (image_search.manage). */
create or replace function public.admin_image_search_jobs()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(row_to_json(j) order by j.created_at desc), '[]'::jsonb)
  from (
    select id, kind::text, status::text, total, indexed, failed, excluded,
           created_at, started_at, finished_at, error
    from public.image_search_jobs
    order by created_at desc
    limit 10
  ) j
  where private.require_permission('image_search.manage') is not null;
$function$;

/**
 * Starts a backfill, a full reindex or a retry of the failed pictures, and returns the job.
 * One job may be queued or running at a time; a second request is refused with NZ409 rather
 * than running two reindexes over the same rows.
 */
create or replace function public.admin_start_image_search_job(p_kind text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := private.require_permission('image_search.manage');
  v_job public.image_search_jobs;
  v_total integer;
begin
  if p_kind is null or p_kind not in ('backfill', 'reindex_all', 'retry_failed') then
    raise exception 'unknown job kind' using errcode = 'NZ412';
  end if;

  if exists (select 1 from public.image_search_jobs where status in ('queued', 'running')) then
    raise exception 'an indexing job is already running' using errcode = 'NZ409';
  end if;

  if p_kind = 'retry_failed' then
    update public.image_search_images
    set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now(), updated_at = now()
    where status = 'failed';
    select count(*) into v_total from public.image_search_images where status = 'pending';
  elsif p_kind = 'reindex_all' then
    perform public.image_search_queue_all();
    update public.image_search_images
    set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now(),
        content_hash = null, model = null, dimensions = null, updated_at = now()
    where status in ('indexed', 'failed', 'processing');
    select count(*) into v_total from public.image_search_images where status = 'pending';
  else
    perform public.image_search_queue_all();
    select count(*) into v_total from public.image_search_images where status = 'pending';
  end if;

  insert into public.image_search_jobs (kind, status, total, created_by, started_at)
  values (p_kind::public.image_search_job_kind, 'queued', coalesce(v_total, 0), v_actor, now())
  returning * into v_job;

  perform private.audit(v_actor, 'image_search.job_started', 'image_search_jobs', v_job.id::text,
    jsonb_build_object('kind', p_kind, 'total', v_total));

  return jsonb_build_object(
    'id', v_job.id, 'kind', v_job.kind::text, 'status', v_job.status::text,
    'total', v_job.total, 'indexed', v_job.indexed, 'failed', v_job.failed,
    'excluded', v_job.excluded, 'createdAt', v_job.created_at,
    'startedAt', v_job.started_at, 'finishedAt', v_job.finished_at
  );
end;
$function$;

/** Claims the queued job for this worker and marks it running. Null when another worker has it. */
create or replace function public.image_search_take_job()
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  select id into v_id
  from public.image_search_jobs
  where status = 'queued'
  order by created_at
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.image_search_jobs
  set status = 'running', started_at = coalesce(started_at, now())
  where id = v_id;
  return v_id;
end;
$function$;

/** The active job, or null (the worker reads it to keep working after a restart). */
create or replace function public.image_search_active_job()
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select id from public.image_search_jobs
  where status = 'running'
  order by created_at
  limit 1;
$function$;

grant execute on function public.image_search_queue_all() to service_role;
grant execute on function public.image_search_claim(integer, uuid) to service_role;
grant execute on function public.image_search_record_indexed(uuid, text, text, integer, extensions.vector, integer, integer) to service_role;
grant execute on function public.image_search_record_failure(uuid, text, boolean, integer) to service_role;
grant execute on function public.image_search_record_exclusion(uuid, text) to service_role;
grant execute on function public.image_search_recover_stale(integer) to service_role;
grant execute on function public.image_search_sync_job(uuid) to service_role;
grant execute on function public.image_search_nearest(extensions.vector, text, integer, integer) to service_role;
grant execute on function public.catalog_products_by_ids(uuid[]) to anon, authenticated, service_role;
grant execute on function public.image_search_log(text, text, real, integer, uuid[], text, text, integer) to service_role;
grant execute on function public.image_search_record_click(uuid, uuid) to service_role;
grant execute on function public.image_search_take_job() to service_role;
grant execute on function public.image_search_active_job() to service_role;

-- Admin functions are reachable by a signed-in account; the permission check inside each one
-- is what actually decides. They are never granted to anon.
revoke all on function public.admin_image_search_settings() from public;
revoke all on function public.admin_save_image_search_settings(boolean, real, integer, text, text, integer) from public;
revoke all on function public.admin_image_search_stats() from public;
revoke all on function public.admin_image_search_missing_images(text, integer, integer) from public;
revoke all on function public.admin_image_search_activity(text, integer, integer) from public;
revoke all on function public.admin_image_search_jobs() from public;
revoke all on function public.admin_start_image_search_job(text) from public;

grant execute on function public.admin_image_search_settings() to authenticated, service_role;
grant execute on function public.admin_save_image_search_settings(boolean, real, integer, text, text, integer) to authenticated, service_role;
grant execute on function public.admin_image_search_stats() to authenticated, service_role;
grant execute on function public.admin_image_search_missing_images(text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_image_search_activity(text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_image_search_jobs() to authenticated, service_role;
grant execute on function public.admin_start_image_search_job(text) to authenticated, service_role;

commit;
