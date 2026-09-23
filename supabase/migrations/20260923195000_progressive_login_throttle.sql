-- Replace hard staff-account lockout with progressive delay.
-- This slows repeated password guessing without allowing an attacker to
-- intentionally lock a known staff account out of the POS.

create or replace function public.staff_login_guard(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_login_failures;
  v_delay integer := 0;
begin
  select * into v_row from public.staff_login_failures where user_id = p_user_id;

  if v_row.user_id is null then
    return jsonb_build_object('allowed', true, 'delay_ms', 0);
  end if;

  if v_row.window_started_at < now() - interval '15 minutes' then
    delete from public.staff_login_failures where user_id = p_user_id;
    return jsonb_build_object('allowed', true, 'delay_ms', 0);
  end if;

  v_delay := case
    when v_row.failed_attempts >= 10 then 5000
    when v_row.failed_attempts >= 7 then 3000
    when v_row.failed_attempts >= 5 then 1500
    when v_row.failed_attempts >= 3 then 750
    else 0
  end;

  return jsonb_build_object('allowed', true, 'delay_ms', v_delay);
end;
$$;

create or replace function public.staff_login_record_failure(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_login_failures(user_id, window_started_at, failed_attempts, blocked_until, updated_at)
  values (p_user_id, now(), 1, null, now())
  on conflict (user_id) do update
  set window_started_at = case
        when public.staff_login_failures.window_started_at < now() - interval '15 minutes' then now()
        else public.staff_login_failures.window_started_at
      end,
      failed_attempts = case
        when public.staff_login_failures.window_started_at < now() - interval '15 minutes' then 1
        else least(public.staff_login_failures.failed_attempts + 1, 1000)
      end,
      blocked_until = null,
      updated_at = now();
end;
$$;

revoke all on function public.staff_login_guard(uuid) from public, anon, authenticated;
revoke all on function public.staff_login_record_failure(uuid) from public, anon, authenticated;
grant execute on function public.staff_login_guard(uuid) to service_role;
grant execute on function public.staff_login_record_failure(uuid) to service_role;
