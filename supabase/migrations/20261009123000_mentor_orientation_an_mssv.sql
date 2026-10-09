-- BTC: Mentor Orientation tối 09/10 chỉ có mentor, không hỏi mã số sinh viên.
begin;
update public.events
set show_student_id_field = false, student_id_required = false
where id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
  and event_name = 'Mentor Orientation';
do $$
begin
  if not exists (
    select 1 from public.events
    where id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid
      and event_name = 'Mentor Orientation'
      and show_student_id_field = false and student_id_required = false
  ) then
    raise exception 'SELF_CHECK: chưa tắt MSSV cho đúng Mentor Orientation';
  end if;
end $$;
commit;
select event_name, show_student_id_field, student_id_required
from public.events where id = 'b42c52e6-8db0-422f-9616-0bd1998bc975'::uuid;
