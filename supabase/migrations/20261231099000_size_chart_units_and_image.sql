-- Size charts with a measurement unit, or with a picture of the chart instead of a table.
--
-- products.size_chart stays one jsonb value and every chart already saved stays valid exactly as it
-- is ({"columns": [...], "rows": [[...]]}). Three optional keys are added:
--   unit      'cm' | 'in' | 'mm'   what the measurement columns are in, shown beside the table
--   mode      'table' | 'image'    a chart is a table (the default) or one uploaded picture
--   imageKey  a media library key  the picture, for mode 'image'
-- A picture chart carries no table (empty columns and rows) and must name its picture; a table chart
-- keeps the old limits (1-8 columns, 1-30 rows, entries up to 40 characters).

create or replace function private.size_chart_valid(p_chart jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_width integer;
  v_row jsonb;
  v_cell jsonb;
  v_mode text;
begin
  if p_chart is null then
    return true;
  end if;
  if jsonb_typeof(p_chart) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_chart) as k (name)
       where k.name not in ('columns', 'rows', 'unit', 'mode', 'imageKey')
     )
     or jsonb_typeof(p_chart -> 'columns') is distinct from 'array'
     or jsonb_typeof(p_chart -> 'rows') is distinct from 'array' then
    return false;
  end if;

  if p_chart ? 'unit' and (jsonb_typeof(p_chart -> 'unit') <> 'string'
                           or (p_chart ->> 'unit') not in ('cm', 'in', 'mm')) then
    return false;
  end if;
  v_mode := coalesce(p_chart ->> 'mode', 'table');
  if p_chart ? 'mode' and (jsonb_typeof(p_chart -> 'mode') <> 'string' or v_mode not in ('table', 'image')) then
    return false;
  end if;
  if p_chart ? 'imageKey' and (jsonb_typeof(p_chart -> 'imageKey') <> 'string'
                               or (p_chart ->> 'imageKey') !~ '^(products|library|seo|brand|categories)/[A-Za-z0-9/_-]{1,172}$') then
    return false;
  end if;

  if v_mode = 'image' then
    -- A picture chart is the picture alone.
    return (p_chart ? 'imageKey')
       and jsonb_array_length(p_chart -> 'columns') = 0
       and jsonb_array_length(p_chart -> 'rows') = 0;
  end if;
  if p_chart ? 'imageKey' then
    return false;
  end if;

  v_width := jsonb_array_length(p_chart -> 'columns');
  if v_width not between 1 and 8 or jsonb_array_length(p_chart -> 'rows') not between 1 and 30 then
    return false;
  end if;

  for v_cell in select c.value from jsonb_array_elements(p_chart -> 'columns') as c loop
    if jsonb_typeof(v_cell) <> 'string'
       or btrim(v_cell #>> '{}') = ''
       or char_length(v_cell #>> '{}') > 40 then
      return false;
    end if;
  end loop;

  for v_row in select r.value from jsonb_array_elements(p_chart -> 'rows') as r loop
    if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> v_width then
      return false;
    end if;
    for v_cell in select c.value from jsonb_array_elements(v_row) as c loop
      if jsonb_typeof(v_cell) <> 'string' or char_length(v_cell #>> '{}') > 40 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;
