-- HAM Season 6 staging seed: program, season, and intake batch.
--
-- STAGING ONLY. Do not run on production without a separate approval.
-- Idempotent and data-preserving.
--
-- Canonical DB naming:
--   program.code = HAM
--   seasons.code = HAM-S6
--   intake_batches.code = HAM-S6-B1
--
-- Source CSVs use HAM_S6. The import scripts preserve that source value in
-- notes, but use HAM-S6 in the database to match the VAM OS convention
-- <program_code>-S<n>.

begin;

insert into public.programs (code, name)
values ('HAM', 'Hanoi Alumni Mentoring')
on conflict (code) do nothing;

insert into public.seasons (program_id, code, name)
select p.id, 'HAM-S6', 'HAM Season 6'
from public.programs p
where p.code = 'HAM'
on conflict (code) do nothing;

insert into public.intake_batches (season_id, code, name, is_active)
select s.id, 'HAM-S6-B1', 'HAM Season 6 - Main intake', true
from public.seasons s
where s.code = 'HAM-S6'
on conflict (season_id, code) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.programs p
    join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
    join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
    where p.code = 'HAM'
  ) then
    raise exception 'HAM-S6 seed context was not created. Check programs/seasons/intake_batches constraints and existing rows.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
