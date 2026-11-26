-- Onboarding slides: heading and description become optional.
--
-- Additive and non-destructive. The columns stay NOT NULL, and "no words" is stored as an empty
-- string, so every reader that already expects text keeps working and no existing slide changes.
-- Only the lower bound of the two length checks is relaxed (1 -> 0); the upper bounds stay. A
-- slide still cannot be blank: the save function requires a heading, a description or a picture.

alter table public.onboarding_slides drop constraint onboarding_slides_heading_check;
alter table public.onboarding_slides add constraint onboarding_slides_heading_check
  check (char_length(btrim(heading)) <= 80);
alter table public.onboarding_slides drop constraint onboarding_slides_description_check;
alter table public.onboarding_slides add constraint onboarding_slides_description_check
  check (char_length(btrim(description)) <= 240);

create or replace function public.admin_save_onboarding_slide(
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

  -- Words are optional (an empty string means none), but a slide cannot be blank: it needs a
  -- heading, a description or a picture.
  if coalesce(coalesce(btrim(p_payload ->> 'heading'), ''), '') = ''
     and coalesce(coalesce(btrim(p_payload ->> 'description'), ''), '') = ''
     and coalesce(p_payload ->> 'imageKey', '') = '' then
    raise exception 'a slide needs a heading, a description or a picture' using errcode = 'NZ498';
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
      coalesce(btrim(p_payload ->> 'heading'), ''),
      coalesce(btrim(p_payload ->> 'description'), ''),
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
        heading = coalesce(btrim(p_payload ->> 'heading'), ''),
        description = coalesce(btrim(p_payload ->> 'description'), ''),
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
