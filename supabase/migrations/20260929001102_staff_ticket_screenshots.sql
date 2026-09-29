alter table public.staff_support_tickets
  add column screenshot_path text
  constraint staff_ticket_screenshot_own_path check (
    screenshot_path is null or screenshot_path like created_by::text || '/' || id::text || '/%'
  );

grant update (screenshot_path) on public.staff_support_tickets to authenticated;

create policy "staff attach screenshot to own ticket" on public.staff_support_tickets
for update to authenticated
using (created_by = (select auth.uid()) and (select public.is_staff()))
with check (created_by = (select auth.uid()) and (select public.is_staff()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-ticket-screenshots', 'staff-ticket-screenshots', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff upload ticket screenshots" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'staff-ticket-screenshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.staff_support_tickets ticket
    where ticket.id::text = (storage.foldername(name))[2]
      and ticket.created_by = (select auth.uid())
  )
);

create policy "staff and admins read ticket screenshots" on storage.objects
for select to authenticated
using (
  bucket_id = 'staff-ticket-screenshots'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.is_admin())
  )
);
