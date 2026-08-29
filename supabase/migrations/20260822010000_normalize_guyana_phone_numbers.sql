create or replace function public.normalized_phone(value text)
returns text
language sql
immutable
set search_path = public
as $$
  with cleaned as (
    select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when char_length(digits) = 7 then '592' || digits
    when char_length(digits) = 8 and left(digits, 1) = '0' then '592' || substring(digits from 2)
    else digits
  end
  from cleaned;
$$;

revoke execute on function public.normalized_phone(text) from public, anon, authenticated;
