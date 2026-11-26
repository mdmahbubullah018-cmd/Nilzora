-- Popup targeting: platform, audience, priority, a free delay and a "once ever" frequency.
--
-- Additive and non-destructive: every existing row keeps working with the defaults below
-- (platform 'both', audience 'all', priority 0), and the two relaxed checks only widen what is
-- allowed. What changes in behaviour is deliberate: several popups may now be live at once, and
-- the one a customer sees is chosen by priority, platform and audience. The old "only one live
-- popup" index is therefore dropped.
--
-- Audience is applied by the client (a public, cached endpoint cannot know who is signed in);
-- a promotional popup is not a security boundary.

alter table public.popups
  add column platform text not null default 'both' check (platform in ('website', 'app', 'both')),
  add column audience text not null default 'all' check (audience in ('all', 'logged_in', 'guests')),
  add column priority integer not null default 0 check (priority between 0 and 1000);

alter table public.popups drop constraint popups_delay_seconds_check;
alter table public.popups add constraint popups_delay_seconds_check
  check (delay_seconds between 0 and 120);

alter table public.popups drop constraint popups_frequency_check;
alter table public.popups add constraint popups_frequency_check
  check (frequency in ('once_ever', 'once_per_session', 'once_per_day', 'every_visit'));

drop index public.popups_one_live;
create index popups_live_idx on public.popups (priority desc, updated_at desc) where is_active;

/**
 * The popups a customer may see right now on one platform, best first (priority, then most
 * recently prepared). The client picks the first whose audience fits and whose frequency allows.
 */
create function public.public_popups(p_platform text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(entry order by (entry ->> 'priority')::integer desc), '[]'::jsonb)
  from (
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
      'audience', p.audience,
      'priority', p.priority,
      'endsAt', p.ends_at
    ) as entry
    from public.popups p
    where p.is_active
      and p.platform in ('both', case when p_platform = 'app' then 'app' else 'website' end)
      and (p.starts_at is null or p.starts_at <= now())
      and (p.ends_at is null or p.ends_at > now())
    order by p.priority desc, p.updated_at desc
    limit 10
  ) rows;
$$;

revoke execute on function public.public_popups(text) from public, anon, authenticated;
grant execute on function public.public_popups(text) to service_role;

create or replace function public.admin_list_popups()
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
      'platform', p.platform,
      'audience', p.audience,
      'priority', p.priority,
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

create or replace function public.admin_get_popup(p_popup_id uuid)
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
    'platform', p.platform,
    'audience', p.audience,
    'priority', p.priority,
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

create or replace function public.admin_save_popup(p_popup_id uuid, p_payload jsonb)
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
  v_platform text := coalesce(p_payload ->> 'platform', 'both');
  v_audience text := coalesce(p_payload ->> 'audience', 'all');
  v_priority integer := coalesce((p_payload ->> 'priority')::integer, 0);
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
  if v_delay not between 0 and 120 then
    raise exception 'a popup waits between 0 and 120 seconds' using errcode = 'NZ498';
  end if;
  if v_platform not in ('website', 'app', 'both') then
    raise exception 'unknown platform' using errcode = 'NZ498';
  end if;
  if v_audience not in ('all', 'logged_in', 'guests') then
    raise exception 'unknown audience' using errcode = 'NZ498';
  end if;
  if v_priority not between 0 and 1000 then
    raise exception 'priority is between 0 and 1000' using errcode = 'NZ498';
  end if;
  if v_frequency not in ('once_ever', 'once_per_session', 'once_per_day', 'every_visit') then
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
      delay_seconds, frequency, platform, audience, priority, is_active, starts_at, ends_at,
      created_by
    ) values (
      v_name, v_mode, v_title, v_subtitle, v_description,
      v_button_label, v_button_href, v_alt,
      v_delay, v_frequency, v_platform, v_audience, v_priority, false, v_starts, v_ends,
      v_actor
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
           platform = v_platform,
           audience = v_audience,
           priority = v_priority,
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
                       'frequency', v_frequency, 'platform', v_platform,
                       'audience', v_audience, 'priority', v_priority, 'active', v_active)
  );
  return v_id;
end;
$$;

create or replace function public.admin_set_popup_active(p_popup_id uuid, p_active boolean)
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
