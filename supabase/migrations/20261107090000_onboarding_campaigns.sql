-- ---------------------------------------------------------------------------
-- Onboarding and promotional campaigns
--
-- Additive only: no existing table is replaced and no existing function changes shape.
-- A campaign owns ordered slides; the public read answers with the one campaign a visitor
-- may see right now (a promotion outranks the welcome sequence), and the database decides
-- eligibility from enabled state, the date window, the audience and the caller's own
-- history. Guest history is never stored here: only an authenticated customer's own
-- campaign views are recorded, and the customer can only ever touch their own row.
--
-- SQLSTATEs: NZ497 onboarding_not_found, NZ498 onboarding_invalid,
--            NZ499 onboarding_conflict.
--
-- NOT APPLIED: this file is a draft. It has not been executed against any database.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Campaigns
-- ---------------------------------------------------------------------------

create table public.onboarding_campaigns (
  id uuid primary key default gen_random_uuid(),
  internal_name text not null
    check (char_length(btrim(internal_name)) between 1 and 80),
  /** A welcome sequence introduces the store; a promotion announces something now. */
  kind text not null default 'welcome'
    check (kind in ('welcome', 'promotion')),
  /** Who may see it. `guest` never appears for a signed-in caller and the reverse. */
  audience text not null default 'all'
    check (audience in ('all', 'authenticated', 'guest')),
  frequency text not null default 'first_launch'
    check (frequency in ('first_launch', 'every_launch', 'once_per_campaign', 'interval')),
  /** Required for `interval`, refused for every other frequency. */
  repeat_days integer
    check (repeat_days is null or repeat_days between 1 and 365),
  /** How long each slide stays on screen before the next one. */
  slide_seconds integer not null default 5
    check (slide_seconds in (3, 5, 10)),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint onboarding_campaigns_window
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  /** A repeat interval needs its length, and only an interval campaign carries one. */
  constraint onboarding_campaigns_interval
    check (
      (frequency = 'interval' and repeat_days is not null)
      or (frequency <> 'interval' and repeat_days is null)
    ),
  /** A promotion is an announcement with a life: both ends of the window are required. */
  constraint onboarding_campaigns_promotion_window
    check (kind <> 'promotion' or (starts_at is not null and ends_at is not null))
);

comment on table public.onboarding_campaigns is
  'Admin-managed onboarding sequences and promotions. Reading is by RPC only.';
comment on column public.onboarding_campaigns.frequency is
  'first_launch = never onboarded, every_launch = always, once_per_campaign, interval = repeat_days.';

/**
 * At most one active campaign per kind: a second welcome (or promotion) can never be
 * switched on by accident, so two sequences can never compete for the same launch.
 */
create unique index onboarding_campaigns_one_active_per_kind
  on public.onboarding_campaigns (kind)
  where is_active;

create index onboarding_campaigns_window_idx
  on public.onboarding_campaigns (starts_at, ends_at);

alter table public.onboarding_campaigns enable row level security;

create trigger onboarding_campaigns_set_updated_at
  before update on public.onboarding_campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Slides
-- ---------------------------------------------------------------------------

create table public.onboarding_slides (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null
    references public.onboarding_campaigns (id) on delete cascade,
  internal_name text not null
    check (char_length(btrim(internal_name)) between 1 and 80),
  heading text not null
    check (char_length(btrim(heading)) between 1 and 80),
  description text not null
    check (char_length(btrim(description)) between 1 and 240),
  /** A media key the existing media pipeline produced, never a URL. */
  image_key text
    check (image_key is null or image_key ~ '^(products|categories|seo|brand)/[A-Za-z0-9/_-]{1,172}$'),
  /** One of the app's semantic icon names; free text would invite nothing usable. */
  icon text
    check (icon is null or icon in (
      'shop', 'search', 'wishlist', 'cart', 'cash', 'delivery',
      'success', 'verified', 'location', 'orders', 'returns', 'help'
    )),
  cta_label text
    check (cta_label is null or char_length(btrim(cta_label)) between 1 and 40),
  /** A path inside the store: an onboarding slide can never send a customer off-site. */
  cta_path text
    check (cta_path is null or (
      cta_path ~ '^/[A-Za-z0-9/_?=&%.~-]{0,199}$'
      and position('//' in cta_path) = 0
    )),
  alt_text text
    check (alt_text is null or char_length(btrim(alt_text)) between 1 and 160),
  position integer not null default 1 check (position between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_slides_label_needs_path
    check (cta_label is null or cta_path is not null),
  /** Deferred so a reorder can move every slide in one statement. */
  constraint onboarding_slides_position_key unique (campaign_id, position)
    deferrable initially deferred
);

comment on table public.onboarding_slides is
  'Ordered slides of one campaign. The public read only ever returns enabled ones.';
comment on column public.onboarding_slides.cta_path is
  'Same-store path shown on the slide’s action, e.g. /products.';

create index onboarding_slides_campaign_idx
  on public.onboarding_slides (campaign_id, position);

alter table public.onboarding_slides enable row level security;

create trigger onboarding_slides_set_updated_at
  before update on public.onboarding_slides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Authenticated campaign history (guest history stays on the device)
-- ---------------------------------------------------------------------------

create table public.onboarding_views (
  campaign_id uuid not null
    references public.onboarding_campaigns (id) on delete cascade,
  /** Always auth.uid(): never a client-supplied id. */
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  /** Set when the sequence finished or was skipped; drives once/interval rules. */
  completed_at timestamptz,
  view_count integer not null default 1 check (view_count between 0 and 1000000),
  primary key (campaign_id, user_id)
);

comment on table public.onboarding_views is
  'One row per authenticated customer and campaign. Guest views are never inserted here.';

create index onboarding_views_user_idx
  on public.onboarding_views (user_id, completed_at desc);

alter table public.onboarding_views enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Shared shape
-- ---------------------------------------------------------------------------

/**
 * What a customer may receive about one campaign: the presentation fields and its enabled
 * slides in order. Internal names, activation state, audience and history never leave here.
 */
create function private.onboarding_payload(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'frequency', c.frequency,
    'repeatDays', c.repeat_days,
    'slideSeconds', c.slide_seconds,
    'endsAt', c.ends_at,
    'slides', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'heading', s.heading,
          'description', s.description,
          'imageKey', s.image_key,
          'icon', s.icon,
          'ctaLabel', s.cta_label,
          'ctaPath', s.cta_path,
          'altText', s.alt_text,
          'position', s.position
        )
        order by s.position
      )
      from public.onboarding_slides s
      where s.campaign_id = c.id and s.is_active
    ), '[]'::jsonb)
  )
  from public.onboarding_campaigns c
  where c.id = p_campaign_id;
$$;

revoke execute on function private.onboarding_payload(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public reads and authenticated completion
-- ---------------------------------------------------------------------------

/**
 * The one campaign this caller may see right now, or null.
 *
 * A promotion outranks the welcome sequence; between two of the same kind the newest
 * window wins (the unique index makes that a tie-break, not a competition). Disabled,
 * not-yet-started, expired and audience-ineligible campaigns never appear. For a
 * signed-in caller the campaign's own frequency is applied to their history here, so a
 * finished campaign is not sent again. A guest has no history row: the app applies the
 * same rules to its own device-local record, and nothing about the guest is stored.
 */
create function public.public_onboarding()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_campaign uuid;
begin
  select c.id into v_campaign
  from public.onboarding_campaigns c
  where c.is_active
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and case c.audience
      when 'all' then true
      when 'authenticated' then v_user is not null
      else v_user is null
    end
    and case
      when v_user is null then true
      else case c.frequency
        -- Never onboarded at all: the first campaign this account ever sees.
        when 'first_launch' then not exists (
          select 1 from public.onboarding_views v where v.user_id = v_user
        )
        when 'every_launch' then true
        when 'once_per_campaign' then not exists (
          select 1 from public.onboarding_views v
          where v.user_id = v_user and v.campaign_id = c.id and v.completed_at is not null
        )
        else coalesce(
          (select v.completed_at is null
             or v.completed_at + make_interval(days => c.repeat_days) <= now()
           from public.onboarding_views v
           where v.user_id = v_user and v.campaign_id = c.id),
          true
        )
      end
    end
  order by case c.kind when 'promotion' then 0 else 1 end,
           c.starts_at desc nulls last,
           c.updated_at desc
  limit 1;

  if v_campaign is null then
    return null;
  end if;
  return private.onboarding_payload(v_campaign);
end;
$$;

/**
 * Records that the signed-in caller finished (or skipped) a campaign they were shown.
 *
 * The campaign must be one this caller could actually see: an arbitrary id is refused,
 * so a client cannot mark a stranger's campaign as finished. Writing twice keeps the
 * first completion time, which makes a retry safe and keeps the frequency rules stable.
 */
create function public.complete_onboarding(p_campaign_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_visible boolean;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.onboarding_campaigns c
    where c.id = p_campaign_id
      and c.is_active
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at is null or c.ends_at >= now())
      and c.audience in ('all', 'authenticated')
  ) into v_visible;

  if not v_visible then
    raise exception 'that campaign is not available' using errcode = 'NZ497';
  end if;

  insert into public.onboarding_views as v
    (campaign_id, user_id, first_viewed_at, last_viewed_at, completed_at, view_count)
  values (p_campaign_id, v_user, now(), now(), now(), 1)
  on conflict (campaign_id, user_id) do update
    set last_viewed_at = now(),
        completed_at = coalesce(v.completed_at, now()),
        view_count = least(v.view_count + 1, 1000000);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin: campaigns
-- ---------------------------------------------------------------------------

/** Every campaign with the counts the management list needs. */
create function public.admin_list_onboarding()
returns table (
  id uuid,
  internal_name text,
  kind text,
  audience text,
  frequency text,
  repeat_days integer,
  slide_seconds integer,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean,
  slide_count integer,
  active_slide_count integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');

  return query
  select c.id, c.internal_name, c.kind, c.audience, c.frequency, c.repeat_days,
         c.slide_seconds, c.starts_at, c.ends_at, c.is_active,
         (select count(*)::integer from public.onboarding_slides s where s.campaign_id = c.id),
         (select count(*)::integer from public.onboarding_slides s
           where s.campaign_id = c.id and s.is_active),
         c.updated_at
  from public.onboarding_campaigns c
  order by c.is_active desc, c.kind, c.updated_at desc;
end;
$$;

/** One campaign with every slide, including the disabled ones, for editing. */
create function public.admin_get_onboarding(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_permission('settings.manage');

  select jsonb_build_object(
    'id', c.id,
    'internalName', c.internal_name,
    'kind', c.kind,
    'audience', c.audience,
    'frequency', c.frequency,
    'repeatDays', c.repeat_days,
    'slideSeconds', c.slide_seconds,
    'startsAt', c.starts_at,
    'endsAt', c.ends_at,
    'isActive', c.is_active,
    'updatedAt', c.updated_at,
    'slides', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'campaignId', s.campaign_id,
          'internalName', s.internal_name,
          'heading', s.heading,
          'description', s.description,
          'imageKey', s.image_key,
          'icon', s.icon,
          'ctaLabel', s.cta_label,
          'ctaPath', s.cta_path,
          'altText', s.alt_text,
          'position', s.position,
          'isActive', s.is_active
        )
        order by s.position
      )
      from public.onboarding_slides s
      where s.campaign_id = c.id
    ), '[]'::jsonb)
  ) into v_result
  from public.onboarding_campaigns c
  where c.id = p_campaign_id;

  if v_result is null then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;
  return v_result;
end;
$$;

/**
 * Creates or updates one campaign and returns its id.
 *
 * `p_campaign_id` is null to create. Activation is part of the payload, but it is
 * validated here: a campaign cannot be switched on with no enabled slide, and the unique
 * index refuses a second active campaign of the same kind (NZ499), so the sequence a
 * customer sees is never ambiguous.
 */
create function public.admin_save_onboarding_campaign(
  p_campaign_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_id uuid := p_campaign_id;
  v_kind text := p_payload ->> 'kind';
  v_audience text := p_payload ->> 'audience';
  v_frequency text := p_payload ->> 'frequency';
  v_seconds integer := (p_payload ->> 'slideSeconds')::integer;
  v_repeat integer := nullif(p_payload ->> 'repeatDays', '')::integer;
  v_active boolean := coalesce((p_payload ->> 'isActive')::boolean, false);
  v_starts timestamptz := nullif(p_payload ->> 'startsAt', '')::timestamptz;
  v_ends timestamptz := nullif(p_payload ->> 'endsAt', '')::timestamptz;
  v_active_slides integer;
begin
  if p_payload ->> 'internalName' is null then
    raise exception 'the campaign needs a name' using errcode = 'NZ498';
  end if;
  if v_kind not in ('welcome', 'promotion') then
    raise exception 'unknown campaign kind' using errcode = 'NZ498';
  end if;
  if v_audience not in ('all', 'authenticated', 'guest') then
    raise exception 'unknown audience' using errcode = 'NZ498';
  end if;
  if v_frequency not in ('first_launch', 'every_launch', 'once_per_campaign', 'interval') then
    raise exception 'unknown frequency' using errcode = 'NZ498';
  end if;
  if v_seconds not in (3, 5, 10) then
    raise exception 'a slide lasts 3, 5 or 10 seconds' using errcode = 'NZ498';
  end if;
  if (v_frequency = 'interval') <> (v_repeat is not null) then
    raise exception 'only a repeat interval needs a number of days' using errcode = 'NZ498';
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'a campaign ends after it starts' using errcode = 'NZ498';
  end if;
  if v_kind = 'promotion' and (v_starts is null or v_ends is null) then
    raise exception 'a promotion needs a start and an end' using errcode = 'NZ498';
  end if;

  if v_id is null then
    begin
      insert into public.onboarding_campaigns
        (internal_name, kind, audience, frequency, repeat_days, slide_seconds,
         starts_at, ends_at, is_active, updated_by)
      values
        (btrim(p_payload ->> 'internalName'), v_kind, v_audience, v_frequency, v_repeat,
         v_seconds, v_starts, v_ends, false, v_actor)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'another campaign of this kind is already active' using errcode = 'NZ499';
    end;
  else
    begin
      update public.onboarding_campaigns
      set internal_name = btrim(p_payload ->> 'internalName'),
          kind = v_kind,
          audience = v_audience,
          frequency = v_frequency,
          repeat_days = v_repeat,
          slide_seconds = v_seconds,
          starts_at = v_starts,
          ends_at = v_ends,
          updated_by = v_actor
      where id = v_id;
    exception when unique_violation then
      raise exception 'another campaign of this kind is already active' using errcode = 'NZ499';
    end;
    if not found then
      raise exception 'that campaign does not exist' using errcode = 'NZ497';
    end if;
  end if;

  if v_active then
    select count(*)::integer into v_active_slides
    from public.onboarding_slides s
    where s.campaign_id = v_id and s.is_active;
    if coalesce(v_active_slides, 0) = 0 then
      raise exception 'add an enabled slide before activating' using errcode = 'NZ498';
    end if;
    perform public.admin_set_onboarding_active(v_id, true);
  else
    -- The form shows the switch, so saving it off must switch it off.
    perform public.admin_set_onboarding_active(v_id, false);
  end if;

  return v_id;
end;
$$;

/** Activation is its own switch, so the list can toggle one campaign in a click. */
create function public.admin_set_onboarding_active(
  p_campaign_id uuid,
  p_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_slides integer;
begin
  if not exists (select 1 from public.onboarding_campaigns c where c.id = p_campaign_id) then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;

  if p_active then
    select count(*)::integer into v_slides
    from public.onboarding_slides s
    where s.campaign_id = p_campaign_id and s.is_active;
    if coalesce(v_slides, 0) = 0 then
      raise exception 'add an enabled slide before activating' using errcode = 'NZ498';
    end if;
    begin
      update public.onboarding_campaigns
      set is_active = true, updated_by = v_actor
      where id = p_campaign_id;
    exception when unique_violation then
      raise exception 'another campaign of this kind is already active' using errcode = 'NZ499';
    end;
  else
    update public.onboarding_campaigns
    set is_active = false, updated_by = v_actor
    where id = p_campaign_id;
  end if;
end;
$$;

/** Deleting is refused while a campaign is live: switch it off first, on purpose. */
create function public.admin_delete_onboarding_campaign(p_campaign_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');

  if exists (
    select 1 from public.onboarding_campaigns c where c.id = p_campaign_id and c.is_active
  ) then
    raise exception 'deactivate this campaign before deleting it' using errcode = 'NZ499';
  end if;

  delete from public.onboarding_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;
end;
$$;

/** What the Admin preview shows: the customer-facing shape of any campaign, live or not. */
create function public.admin_preview_onboarding(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_permission('settings.manage');

  v_result := private.onboarding_payload(p_campaign_id);
  if v_result is null then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin: slides
-- ---------------------------------------------------------------------------

/** Creates or updates one slide and returns it, in the editing shape. */
create function public.admin_save_onboarding_slide(
  p_slide_id uuid,
  p_campaign_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slide_id uuid := p_slide_id;
  v_position integer := nullif(p_payload ->> 'position', '')::integer;
  v_result jsonb;
begin
  perform private.require_permission('settings.manage');

  if not exists (select 1 from public.onboarding_campaigns c where c.id = p_campaign_id) then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;

  if p_payload ->> 'heading' is null or p_payload ->> 'description' is null then
    raise exception 'a slide needs a heading and a description' using errcode = 'NZ498';
  end if;

  if (p_payload ->> 'ctaLabel' is not null) <> (p_payload ->> 'ctaPath' is not null) then
    raise exception 'an action needs both a label and a place to go' using errcode = 'NZ498';
  end if;

  if v_slide_id is null then
    if v_position is null then
      select coalesce(max(s.position), 0) + 1 into v_position
      from public.onboarding_slides s
      where s.campaign_id = p_campaign_id;
    end if;
    insert into public.onboarding_slides
      (campaign_id, internal_name, heading, description, image_key, icon,
       cta_label, cta_path, alt_text, position, is_active)
    values (
      p_campaign_id,
      btrim(p_payload ->> 'internalName'),
      btrim(p_payload ->> 'heading'),
      btrim(p_payload ->> 'description'),
      nullif(p_payload ->> 'imageKey', ''),
      nullif(p_payload ->> 'icon', ''),
      nullif(p_payload ->> 'ctaLabel', ''),
      nullif(p_payload ->> 'ctaPath', ''),
      nullif(p_payload ->> 'altText', ''),
      v_position,
      coalesce((p_payload ->> 'isActive')::boolean, true)
    )
    returning id into v_slide_id;
  else
    if not exists (
      select 1 from public.onboarding_slides s
      where s.id = v_slide_id and s.campaign_id = p_campaign_id
    ) then
      raise exception 'that slide does not exist' using errcode = 'NZ497';
    end if;
    update public.onboarding_slides s
    set internal_name = btrim(p_payload ->> 'internalName'),
        heading = btrim(p_payload ->> 'heading'),
        description = btrim(p_payload ->> 'description'),
        image_key = nullif(p_payload ->> 'imageKey', ''),
        icon = nullif(p_payload ->> 'icon', ''),
        cta_label = nullif(p_payload ->> 'ctaLabel', ''),
        cta_path = nullif(p_payload ->> 'ctaPath', ''),
        alt_text = nullif(p_payload ->> 'altText', ''),
        position = coalesce(v_position, s.position),
        is_active = coalesce((p_payload ->> 'isActive')::boolean, s.is_active)
    where s.id = v_slide_id;
  end if;

  select jsonb_build_object(
    'id', s.id,
    'campaignId', s.campaign_id,
    'internalName', s.internal_name,
    'heading', s.heading,
    'description', s.description,
    'imageKey', s.image_key,
    'icon', s.icon,
    'ctaLabel', s.cta_label,
    'ctaPath', s.cta_path,
    'altText', s.alt_text,
    'position', s.position,
    'isActive', s.is_active
  ) into v_result
  from public.onboarding_slides s
  where s.id = v_slide_id;

  return v_result;
end;
$$;

create function public.admin_delete_onboarding_slide(p_slide_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');

  delete from public.onboarding_slides s where s.id = p_slide_id;
  if not found then
    raise exception 'that slide does not exist' using errcode = 'NZ497';
  end if;
end;
$$;

/** Rewrites every position in one statement; the list must name this campaign's slides exactly. */
create function public.admin_reorder_onboarding_slides(
  p_campaign_id uuid,
  p_slide_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_expected integer;
  v_given integer := coalesce(array_length(p_slide_ids, 1), 0);
begin
  if not exists (select 1 from public.onboarding_campaigns c where c.id = p_campaign_id) then
    raise exception 'that campaign does not exist' using errcode = 'NZ497';
  end if;

  select count(*)::integer into v_expected
  from public.onboarding_slides s
  where s.campaign_id = p_campaign_id;

  if v_expected <> v_given then
    raise exception 'the order must name every slide once' using errcode = 'NZ498';
  end if;

  if (
    select count(distinct x) from unnest(p_slide_ids) as x
  ) <> v_given then
    raise exception 'the order must name every slide once' using errcode = 'NZ498';
  end if;

  if exists (
    select 1 from unnest(p_slide_ids) as x
    where not exists (
      select 1 from public.onboarding_slides s
      where s.id = x and s.campaign_id = p_campaign_id
    )
  ) then
    raise exception 'the order names a slide from another campaign' using errcode = 'NZ498';
  end if;

  update public.onboarding_slides s
  set position = ordered.rn::integer,
      updated_at = now()
  from (
    select x.id, x.rn
    from unnest(p_slide_ids) with ordinality as x (id, rn)
  ) as ordered
  where s.id = ordered.id;

  update public.onboarding_campaigns c
  set updated_by = v_actor
  where c.id = p_campaign_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.public_onboarding() from public, anon, authenticated;
revoke execute on function public.complete_onboarding(uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_onboarding() from public, anon, authenticated;
revoke execute on function public.admin_get_onboarding(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_onboarding_campaign(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.admin_set_onboarding_active(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_delete_onboarding_campaign(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_preview_onboarding(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_onboarding_slide(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.admin_delete_onboarding_slide(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_reorder_onboarding_slides(uuid, uuid[])
  from public, anon, authenticated;

grant execute on function public.public_onboarding() to anon, authenticated;
grant execute on function public.complete_onboarding(uuid) to authenticated;
grant execute on function public.admin_list_onboarding() to authenticated;
grant execute on function public.admin_get_onboarding(uuid) to authenticated;
grant execute on function public.admin_save_onboarding_campaign(uuid, jsonb) to authenticated;
grant execute on function public.admin_set_onboarding_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_onboarding_campaign(uuid) to authenticated;
grant execute on function public.admin_preview_onboarding(uuid) to authenticated;
grant execute on function public.admin_save_onboarding_slide(uuid, uuid, jsonb) to authenticated;
grant execute on function public.admin_delete_onboarding_slide(uuid) to authenticated;
grant execute on function public.admin_reorder_onboarding_slides(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The default welcome sequence
-- ---------------------------------------------------------------------------
-- The five slides the app ships with, so a fresh install has a finished first
-- launch instead of an empty one. Every word here is a fact about the shop as it
-- exists today: cash on delivery, delivery to a Bangladesh address, orders and
-- returns in the account. No discount, delivery time or promise is claimed, and no
-- illustration key is guessed — a slide without one draws its own icon.
--
-- These are ordinary rows: the owner can rename, reorder, disable or delete them in
-- Admin > Marketing > Onboarding, exactly like a campaign they created themselves.
-- `on conflict do nothing` keeps the script safe to re-read against a database where
-- the sequence already exists.

insert into public.onboarding_campaigns
  (id, internal_name, kind, audience, frequency, repeat_days, slide_seconds,
   starts_at, ends_at, is_active)
values
  ('0f000000-0000-4000-8000-00000000c001', 'Welcome sequence', 'welcome', 'all',
   'first_launch', null, 5, null, null, true)
on conflict (id) do nothing;

insert into public.onboarding_slides
  (id, campaign_id, internal_name, heading, description, image_key, icon,
   cta_label, cta_path, alt_text, position, is_active)
values
  ('0f000000-0000-4000-8000-00000000d001', '0f000000-0000-4000-8000-00000000c001',
   'Welcome / discover', 'Discover Nilzora',
   'One shop, chosen with care. Browse the catalogue by category and find what you came for.',
   null, 'shop', null, null, null, 1, true),
  ('0f000000-0000-4000-8000-00000000d002', '0f000000-0000-4000-8000-00000000c001',
   'Welcome / favourites', 'Keep your favourites',
   'Tap the heart on anything you like and it waits for you in your wishlist.',
   null, 'wishlist', null, null, null, 2, true),
  ('0f000000-0000-4000-8000-00000000d003', '0f000000-0000-4000-8000-00000000c001',
   'Welcome / cart', 'Your cart, your choice',
   'Add what you want, change the quantity, and see the full total before you order.',
   null, 'cart', null, null, null, 3, true),
  ('0f000000-0000-4000-8000-00000000d004', '0f000000-0000-4000-8000-00000000c001',
   'Welcome / cash on delivery', 'Shop with confidence',
   'Pay cash on delivery when your parcel reaches you. No card needed to place an order.',
   null, 'cash', null, null, null, 4, true),
  ('0f000000-0000-4000-8000-00000000d005', '0f000000-0000-4000-8000-00000000c001',
   'Welcome / delivered', 'Delivered to your door',
   'Choose your division and district at checkout, then follow the order from your account.',
   null, 'delivery', null, null, null, 5, true)
on conflict (id) do nothing;
