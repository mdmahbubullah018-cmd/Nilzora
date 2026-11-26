-- Promotional popups
-- ==================
-- One admin-managed popup, shown over the storefront and inside the native app a few seconds
-- after a customer opens it. This is deliberately a single surface, not a marketing suite: no
-- coupons, no vouchers, no discount codes, no copy-code anything.
--
-- Why a table of its own rather than a new banner placement or an onboarding campaign:
--
--   * a banner is placed *in* a page and scrolls with it; a popup is a modal over the page,
--     has its own delay and its own per-device frequency, and carries either designed copy
--     beside artwork or one complete piece of artwork. None of that fits a banner row.
--   * an onboarding campaign is a launch sequence of several slides, played once over the app
--     before the shop is usable. A popup is one card, on the website and in the app, shown
--     after the customer has already started shopping.
--
-- Everything else is shared with them: the `settings.manage` permission, the audit log, the
-- media pipeline (R2 through the API only), the service-role-only read path, and the rule that
-- the database, not a client, decides what is eligible.
--
-- Two ways to store the artwork, decided by what was uploaded:
--   still     a JPEG, PNG or WebP that went through the picture pipeline: two WebP variants are
--             written beside the base key (`<key>/full.webp`, `<key>/thumb.webp`).
--   animated  an animated GIF kept byte for byte under a single key, because re-encoding it
--             would silently freeze the animation.
-- `image_kind` records which, so the API builds the right address and nothing has to guess.
--
-- SQLSTATEs: NZ497 popup_not_found, NZ498 popup_invalid, NZ499 popup_conflict. A missing or
-- refused permission is NZ403 or 42501, as everywhere else.
--
-- Applied to the local development database first, then to the hosted project on 2026-11-18 with
-- the owner's explicit approval; this file is the record of both, and the two schemas match.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table public.popups (
  id uuid primary key default gen_random_uuid(),
  internal_name text not null
    check (char_length(btrim(internal_name)) between 1 and 80),
  -- template = artwork with optional copy beside it; artwork = one complete picture.
  display_mode text not null default 'template'
    check (display_mode in ('template', 'artwork')),

  -- The artwork every popup has. `image_key` is the base key for a still (its two WebP
  -- variants live beside it) and the exact object key for an animated file.
  image_key text,
  image_kind text check (image_kind in ('still', 'animated')),
  image_width integer check (image_width is null or image_width between 1 and 8000),
  image_height integer check (image_height is null or image_height between 1 and 8000),
  image_bytes integer check (image_bytes is null or image_bytes between 0 and 5242880),
  image_format text check (image_format is null or image_format in ('jpeg', 'png', 'webp', 'gif')),
  image_alt text check (image_alt is null or char_length(btrim(image_alt)) between 1 and 160),

  -- Optional copy for the designed template. Only a button has to come as a pair: complete
  -- artwork carries its own words, so it may carry none of these.
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  subtitle text check (subtitle is null or char_length(btrim(subtitle)) between 1 and 200),
  description text check (description is null or char_length(btrim(description)) between 1 and 400),
  button_label text check (button_label is null or char_length(btrim(button_label)) between 1 and 30),
  -- Only links inside the storefront: a path, never another site (the same rule as a banner).
  button_href text check (
    button_href is null
    or (char_length(button_href) <= 300 and button_href ~ '^/[A-Za-z0-9/_?=&%.~-]*$'
        and button_href !~ '^//')
  ),

  -- Seconds after the page or app opens before the popup may appear. Two values only.
  delay_seconds integer not null default 10 check (delay_seconds in (10, 15)),
  frequency text not null default 'once_per_session'
    check (frequency in ('once_per_session', 'once_per_day', 'every_visit')),

  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A popup is its artwork: a live one always has it. A draft is allowed to exist without a
  -- picture, because the Admin creates the popup first and uploads the artwork next; switching it
  -- on is what requires the picture (admin_set_popup_active refuses a popup without one).
  constraint popups_needs_artwork
    check (
      not is_active
      or (image_key is not null and image_kind is not null
          and image_width is not null and image_height is not null)
    ),
  -- A label with nowhere to go would be a dead control. A destination without a label is the
  -- complete-artwork case: the whole picture is the link.
  constraint popups_button_pair check (button_label is null or button_href is not null),
  -- A designed template draws a button, so it needs both halves.
  constraint popups_template_button_pair
    check (display_mode = 'artwork' or (button_label is null) = (button_href is null)),
  constraint popups_schedule check (starts_at is null or ends_at is null or ends_at > starts_at),
  -- Complete artwork speaks for itself: no heading, subtitle, description or button label.
  constraint popups_artwork_carries_its_own_words
    check (
      display_mode <> 'artwork'
      or (title is null and subtitle is null and description is null and button_label is null)
    )
);

comment on table public.popups is
  'Admin-managed promotional popups for the storefront and the app. Reading is by RPC only.';
comment on column public.popups.image_kind is
  'still = picture pipeline, two WebP variants beside the base key; animated = one GIF kept as uploaded.';
comment on column public.popups.frequency is
  'How often one device may see it; the client keeps the history, the API decides eligibility.';
comment on column public.popups.delay_seconds is
  'Seconds after the page or app opens before the popup appears.';

/**
 * At most one live popup at a time.
 *
 * Two competing popups would stack (or fight) over the same page, so the database refuses a
 * second one the moment it is switched on, whatever the Admin form does. The index is partial
 * on `is_active`, so any number of drafts and switched-off popups may exist beside it.
 */
create unique index popups_one_live on public.popups ((true)) where is_active;

create index popups_listing_idx on public.popups (is_active desc, updated_at desc);

create trigger popups_set_updated_at
  before update on public.popups
  for each row execute function public.set_updated_at();

alter table public.popups enable row level security;

-- No end-user policy at all: a customer's client never reads this table. The one row a customer
-- may see arrives through public_popup(), which decides eligibility itself. Admin access is by
-- the functions below, which check the permission. The service role keeps full access because
-- the API writes through it.
revoke all on table public.popups from public, anon, authenticated;
grant select, insert, update, delete on table public.popups to service_role;

-- ---------------------------------------------------------------------------
-- 2. Public read: at most one eligible popup
-- ---------------------------------------------------------------------------

/**
 * The popup a customer may see right now, or null.
 *
 * Eligible means switched on and inside its window. There is never more than one (see
 * popups_one_live); the ordering is only a tie-break for a row that was switched on in the same
 * statement as another, so the answer is always the most recently prepared popup.
 *
 * The customer identity is deliberately not consulted: a promotional popup is public. Nothing
 * here touches a session, a token or a role, so an anonymous visitor gets the same answer as a
 * signed-in one, and nothing about the caller can leak into the payload.
 */
create function public.public_popup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'displayMode', p.display_mode,
    'imageKey', p.image_key,
    'imageKind', p.image_kind,
    'imageWidth', p.image_width,
    'imageHeight', p.image_height,
    'imageFormat', p.image_format,
    'imageAlt', p.image_alt,
    'title', p.title,
    'subtitle', p.subtitle,
    'description', p.description,
    'buttonLabel', p.button_label,
    'buttonHref', p.button_href,
    'delaySeconds', p.delay_seconds,
    'frequency', p.frequency,
    'endsAt', p.ends_at
  )
  from public.popups p
  where p.is_active
    and (p.starts_at is null or p.starts_at <= now())
    and (p.ends_at is null or p.ends_at > now())
  order by p.updated_at desc
  limit 1;
$$;

comment on function public.public_popup() is
  'The one popup a customer may see, with no management fields. Null when nothing is eligible.';

-- ---------------------------------------------------------------------------
-- 3. Admin management
-- ---------------------------------------------------------------------------

/** One row of the management list, newest first. Requires settings.manage. */
create function public.admin_list_popups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.require_permission('settings.manage');
  select coalesce(jsonb_agg(entry order by entry ->> 'updatedAt' desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'id', p.id,
      'internalName', p.internal_name,
      'displayMode', p.display_mode,
      'title', p.title,
      'imageKey', p.image_key,
      'imageKind', p.image_kind,
      'imageWidth', p.image_width,
      'imageHeight', p.image_height,
      'imageBytes', p.image_bytes,
      'imageFormat', p.image_format,
      'imageAlt', p.image_alt,
      'subtitle', p.subtitle,
      'description', p.description,
      'buttonLabel', p.button_label,
      'buttonHref', p.button_href,
      'delaySeconds', p.delay_seconds,
      'frequency', p.frequency,
      'isActive', p.is_active,
      'startsAt', p.starts_at,
      'endsAt', p.ends_at,
      'updatedAt', p.updated_at
    ) as entry
    from public.popups p
  ) rows;
  return v_rows;
end;
$$;

/** One popup as the editor reads it, or null when there is no such id. */
create function public.admin_get_popup(p_popup_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
begin
  perform private.require_permission('settings.manage');
  select jsonb_build_object(
    'id', p.id,
    'internalName', p.internal_name,
    'displayMode', p.display_mode,
    'title', p.title,
    'imageKey', p.image_key,
    'imageKind', p.image_kind,
    'imageWidth', p.image_width,
    'imageHeight', p.image_height,
    'imageBytes', p.image_bytes,
    'imageFormat', p.image_format,
    'imageAlt', p.image_alt,
    'subtitle', p.subtitle,
    'description', p.description,
    'buttonLabel', p.button_label,
    'buttonHref', p.button_href,
    'delaySeconds', p.delay_seconds,
    'frequency', p.frequency,
    'isActive', p.is_active,
    'startsAt', p.starts_at,
    'endsAt', p.ends_at,
    'updatedAt', p.updated_at
  )
    into v_entry
  from public.popups p
  where p.id = p_popup_id;
  return v_entry;
end;
$$;

/**
 * Creates (p_popup_id null) or updates one popup. Returns its id.
 *
 * Every rule the form checks is checked here too, because the form is not the only caller: the
 * shape of the payload is validated field by field, the artwork must already be stored, and a
 * second popup cannot be switched on while another is live (popups_one_live raises a unique
 * violation, which the API reports as a conflict).
 */
create function public.admin_save_popup(p_popup_id uuid, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_id uuid := p_popup_id;
  v_name text := btrim(coalesce(p_payload ->> 'internalName', ''));
  v_mode text := coalesce(p_payload ->> 'displayMode', 'template');
  v_title text := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
  v_subtitle text := nullif(btrim(coalesce(p_payload ->> 'subtitle', '')), '');
  v_description text := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
  v_button_label text := nullif(btrim(coalesce(p_payload ->> 'buttonLabel', '')), '');
  v_button_href text := nullif(btrim(coalesce(p_payload ->> 'buttonHref', '')), '');
  v_alt text := nullif(btrim(coalesce(p_payload ->> 'imageAlt', '')), '');
  v_delay integer := coalesce((p_payload ->> 'delaySeconds')::integer, 10);
  v_frequency text := coalesce(p_payload ->> 'frequency', 'once_per_session');
  v_active boolean := coalesce((p_payload ->> 'isActive')::boolean, false);
  v_starts timestamptz := nullif(p_payload ->> 'startsAt', '')::timestamptz;
  v_ends timestamptz := nullif(p_payload ->> 'endsAt', '')::timestamptz;
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'a popup needs a name of at most 80 characters' using errcode = 'NZ498';
  end if;
  if v_mode not in ('template', 'artwork') then
    raise exception 'unknown display mode' using errcode = 'NZ498';
  end if;
  if v_delay not in (10, 15) then
    raise exception 'a popup waits 10 or 15 seconds' using errcode = 'NZ498';
  end if;
  if v_frequency not in ('once_per_session', 'once_per_day', 'every_visit') then
    raise exception 'unknown frequency' using errcode = 'NZ498';
  end if;
  if v_button_label is not null and v_button_href is null then
    raise exception 'a button needs a place to go' using errcode = 'NZ498';
  end if;
  if (v_button_label is null) <> (v_button_href is null) and v_mode = 'template' then
    raise exception 'a designed template needs both the button label and its link'
      using errcode = 'NZ498';
  end if;
  if v_mode = 'artwork'
     and (v_title is not null or v_subtitle is not null
          or v_description is not null or v_button_label is not null) then
    raise exception 'complete artwork carries its own words'
      using errcode = 'NZ498';
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'a popup ends after it starts' using errcode = 'NZ498';
  end if;

  if v_id is null then
    insert into public.popups (
      internal_name, display_mode, title, subtitle, description,
      button_label, button_href, image_alt,
      delay_seconds, frequency, is_active, starts_at, ends_at, created_by
    ) values (
      v_name, v_mode, v_title, v_subtitle, v_description,
      v_button_label, v_button_href, v_alt,
      v_delay, v_frequency, false, v_starts, v_ends, v_actor
    )
    returning id into v_id;
  else
    update public.popups
       set internal_name = v_name,
           display_mode = v_mode,
           title = v_title,
           subtitle = v_subtitle,
           description = v_description,
           button_label = v_button_label,
           button_href = v_button_href,
           image_alt = v_alt,
           delay_seconds = v_delay,
           frequency = v_frequency,
           starts_at = v_starts,
           ends_at = v_ends
     where id = v_id;
    if not found then
      raise exception 'popup not found' using errcode = 'NZ497';
    end if;
  end if;

  -- Switching it on or off is a separate decision, applied last and audited on its own, so a
  -- save can never leave the live slot ambiguous.
  perform public.admin_set_popup_active(v_id, v_active);

  perform private.audit(
    v_actor,
    case when p_popup_id is null then 'popup.create' else 'popup.update' end,
    'popup',
    v_id::text,
    jsonb_build_object('name', v_name, 'displayMode', v_mode, 'delaySeconds', v_delay,
                       'frequency', v_frequency, 'active', v_active)
  );
  return v_id;
end;
$$;

/**
 * Switches one popup on or off. Turning one on while another is live is refused (NZ499) rather
 * than silently switching the other off: the Admin sees which popup holds the slot and decides.
 */
create function public.admin_set_popup_active(p_popup_id uuid, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_has_artwork boolean;
begin
  if p_active and exists (
    select 1 from public.popups where is_active and id <> p_popup_id
  ) then
    raise exception 'another popup is already live' using errcode = 'NZ499';
  end if;
  select image_key is not null into v_has_artwork from public.popups where id = p_popup_id;
  if not found then
    raise exception 'popup not found' using errcode = 'NZ497';
  end if;
  -- A popup is its artwork: without one there is nothing to show, so it cannot go live.
  if p_active and not v_has_artwork then
    raise exception 'a popup needs artwork before it can be shown'
      using errcode = 'NZ498';
  end if;
  update public.popups set is_active = p_active where id = p_popup_id;
  perform private.audit(
    v_actor,
    case when p_active then 'popup.activate' else 'popup.deactivate' end,
    'popup',
    p_popup_id::text,
    '{}'::jsonb
  );
end;
$$;

/**
 * Stores (p_image_key null clears) the artwork reference of one popup and returns the key it
 * replaced, so the API can delete those objects afterwards. The dimensions and kind come from
 * the bytes the API already validated; nothing here trusts a client.
 */
create function public.admin_set_popup_image(
  p_popup_id uuid,
  p_image_key text,
  p_image_kind text,
  p_image_width integer,
  p_image_height integer,
  p_image_bytes integer,
  p_image_format text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_previous text;
begin
  if p_image_key is not null then
    if p_image_kind not in ('still', 'animated') then
      raise exception 'unknown artwork kind' using errcode = 'NZ498';
    end if;
    if p_image_format not in ('jpeg', 'png', 'webp', 'gif') then
      raise exception 'unknown artwork format' using errcode = 'NZ498';
    end if;
    if p_image_width not between 1 and 8000 or p_image_height not between 1 and 8000 then
      raise exception 'unusable artwork dimensions' using errcode = 'NZ498';
    end if;
    if p_image_key !~ '^popups/[0-9a-f-]{36}/[0-9a-f-]{36}(\.(gif|png|webp|jpg))?$' then
      raise exception 'unusable artwork key' using errcode = 'NZ498';
    end if;
  end if;

  select image_key into v_previous from public.popups where id = p_popup_id for update;
  if not found then
    raise exception 'popup not found' using errcode = 'NZ497';
  end if;
  -- A live popup is on screen: its artwork cannot be taken away from under it.
  if p_image_key is null and exists (select 1 from public.popups where id = p_popup_id and is_active)
  then
    raise exception 'switch the popup off before removing its artwork'
      using errcode = 'NZ498';
  end if;

  update public.popups
     set image_key = p_image_key,
         image_kind = case when p_image_key is null then null else p_image_kind end,
         image_width = case when p_image_key is null then null else p_image_width end,
         image_height = case when p_image_key is null then null else p_image_height end,
         image_bytes = case when p_image_key is null then null else p_image_bytes end,
         image_format = case when p_image_key is null then null else p_image_format end
   where id = p_popup_id;

  perform private.audit(
    v_actor,
    case when p_image_key is null then 'popup.image.remove' else 'popup.image.set' end,
    'popup',
    p_popup_id::text,
    jsonb_build_object('kind', p_image_kind, 'width', p_image_width, 'height', p_image_height,
                       'bytes', p_image_bytes)
  );
  return v_previous;
end;
$$;

/**
 * Removes one popup and returns its artwork key so the API can delete the objects. The row goes
 * even while it is live: deleting is an explicit, confirmed action, and the unique index frees
 * the slot for the next popup.
 */
create function public.admin_delete_popup(p_popup_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_key text;
begin
  delete from public.popups where id = p_popup_id returning image_key into v_key;
  if not found then
    raise exception 'popup not found' using errcode = 'NZ497';
  end if;
  perform private.audit(v_actor, 'popup.delete', 'popup', p_popup_id::text, '{}'::jsonb);
  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- The customer read runs as the server's own identity: no client ever calls this function, and
-- the table it reads has no end-user policy at all.
revoke execute on function public.public_popup() from public, anon, authenticated;
grant execute on function public.public_popup() to service_role;

-- The management functions are granted to `authenticated` like every other Admin function in
-- this database: each one checks `settings.manage` inside (`private.require_permission`), and the
-- API calls them as the signed-in administrator. Granting them only to the server would make
-- every save fail with "permission denied for function", whatever the account held.
revoke execute on function public.admin_list_popups() from public, anon, authenticated;
revoke execute on function public.admin_get_popup(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_popup(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_set_popup_active(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_set_popup_image(uuid, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
revoke execute on function public.admin_delete_popup(uuid) from public, anon, authenticated;

grant execute on function public.admin_list_popups() to authenticated;
grant execute on function public.admin_get_popup(uuid) to authenticated;
grant execute on function public.admin_save_popup(uuid, jsonb) to authenticated;
grant execute on function public.admin_set_popup_active(uuid, boolean) to authenticated;
grant execute on function public.admin_set_popup_image(uuid, text, text, integer, integer, integer, text)
  to authenticated;
grant execute on function public.admin_delete_popup(uuid) to authenticated;
