# QA Operations Dashboard KPI

## Pham vi audit

- Trang: `/operations`
- File code da review:
  - `app/operations/page.tsx`
  - `app/operations/month-selector.tsx`
  - `lib/data.ts`
  - `lib/types.ts`
- Khong doi schema, khong import data, khong fetch `application_answers`.

## Bang dinh nghia KPI

| KPI | Dinh nghia hien tai trong app | Logic SQL tuong duong | Trang thai QA |
| --- | --- | --- | --- |
| So recap trong thang | Dem `mentoring_recaps` co `meeting_month = selectedMonth` va `status` trong `submitted`, `needs_review`, hoac rong. | `count(*) from mentoring_recaps where meeting_month = :month and status in ('submitted','needs_review')` | Dat cho du lieu import hien tai. App cho phep status rong de chong du lieu cu, nhung schema Phase 2 mac dinh `submitted`. |
| Mentee active | Dem distinct `mentee_person_id` trong recap hop le cua thang. | `count(distinct mentee_person_id)` voi cung filter recap hop le. | Dat. Kien nghi doi label thanh "Mentee co recap" neu can phan biet voi active match. |
| Mentor active | Dem distinct `mentor_person_id` trong recap hop le cua thang. | `count(distinct mentor_person_id)` voi cung filter recap hop le. | Dat. Kien nghi doi label thanh "Mentor co recap" neu can phan biet voi active match. |
| Ty le mentee active | Tu so: mentee co recap trong thang va nam trong tap active matched mentees. Mau so: distinct mentees trong active matches cua season `UEHM-S11`. | `count(distinct recap.mentee_person_id join active matches) / count(distinct active_matches.mentee_person_id)` | Dat ve mat operational health. Luu y tu so khac voi card "Mentee active" neu co recap ngoai active match. |
| Mentor chua co recap | Distinct active matched mentors cua season `UEHM-S11` khong xuat hien trong selected recap mentor set. | `active_matched_mentors except distinct recap.mentor_person_id` | Dat. Mau/tap nen dung active matched mentors, app dang lam dung. |
| Event/training trong thang | Dem `events` co `starts_at` roi map ve `YYYY-MM = selectedMonth`. | `count(*) from events where starts_at >= month_start and starts_at < next_month` | Tam dat. Event data chua seed/import day du; app khong con dung `event_code`/`event_date`. |
| Luot tham du event | Dem `event_participations` co `event_id` nam trong event cua thang va `attendance_status = 'attended'`. | join `event_participations.event_id = events.id`, filter `events.starts_at` theo thang va `attendance_status='attended'` | Tam dat. Chua co import event participation nen co the la 0. |
| Ty le attendance | `attended / (attended + registered_absent)` tren participation cua event trong thang. Neu mau so 0 thi hien "Chua co du lieu". | `attended_count / (attended_count + registered_absent_count)` | Tam dat. Dinh nghia phu hop voi status MVP. |
| Feedback count | Hien "Chua trien khai". | Chua co bang/module feedback. | Dung voi scope hien tai. |
| Mentee can follow-up | Active matched mentees khong co recap trong selected month va cung khong co recap trong previous month. | `active_matched_mentees where not exists recap(month=:selected) and not exists recap(month=:previous)` | Dat theo dinh nghia candidate list. Chua phai workflow/action state. |

## Doi chieu voi logic Supabase

View `v_monthly_activity_summary` trong migration Phase 2 tinh:

```sql
select
  season_id,
  meeting_month,
  count(*) as recap_count,
  count(distinct mentee_person_id) as active_mentee_count,
  count(distinct mentor_person_id) as active_mentor_count
from mentoring_recaps
where status in ('submitted', 'needs_review')
group by season_id, meeting_month;
```

Trang `/operations` dang tuong thich voi logic nay cho 3 KPI recap chinh, voi mot khac biet nho: app cung chap nhan status rong. Khac biet nay khong anh huong neu du lieu Phase 2 tuan thu constraint/status import hien tai.

Gia tri mong doi de test:

| URL | Recap | Active mentees | Active mentors |
| --- | ---: | ---: | ---: |
| `/operations?month=2025-11` | 508 | 462 | 349 |
| `/operations?month=2025-12` | 278 | 267 | 216 |
| `/operations?month=2026-01` | 38 | 38 | 36 |
| `/operations?month=2026-02` | 64 | 64 | 56 |

## Ket luan audit

- Khong phat hien bug can sua ngay trong KPI definitions.
- Invalid va duplicate recaps bi loai neu `status` la `invalid` hoac `duplicate`.
- `needs_review` recaps duoc tinh vao KPI, dung voi view monthly summary va scope Phase 2.
- Mau so ty le mentee active dung active matched mentees trong season `UEHM-S11`.
- Mentor without recap dung active matched mentors trong season `UEHM-S11`.
- Follow-up candidate hien co nghia la thieu recap hai thang lien tiep: thang dang xem va thang lien truoc. Day la candidate list, khong phai action workflow.

## Gioi han da biet

- Event participation chua import, nen event attendance KPI co the hien 0 hoac "Chua co du lieu".
- Feedback module chua trien khai.
- Follow-up chua co bang `action_items`, owner, status, due date, hay lich su xu ly.
- Mot so date outliers trong recap history co the can review thu cong.
- Auth/RLS chua trien khai; hien moi co temporary password gate.
- App tinh KPI o server component bang du lieu da fetch ve, chua dung SQL aggregate truc tiep. Cach nay on cho MVP, nhung nen can nhac aggregate/view khi du lieu lon hon.

## De xuat future fixes

- Lam ro label: neu can chinh xac hon, doi "Mentee active" thanh "Mentee co recap" va "Mentor active" thanh "Mentor co recap".
- Neu khong can ho tro du lieu cu, bo status rong khoi `VALID_ACTIVITY_STATUSES` de khop 100% voi schema/view.
- Them QA query/view rieng cho Operations Dashboard de so sanh tu dong cac KPI chinh theo thang.
- Seed cac event Phase 2 va chi import attendance tu nguon sign-in/registration dang tin cay.
- Xay dung follow-up workflow/action_items rieng thay vi chi tinh candidate list tren dashboard.
- Trien khai Auth/RLS truoc khi chia se rong hon.

## Code changes

- Khong co thay doi app code trong audit nay.
- Da tao tai lieu QA: `docs/OPERATIONS_DASHBOARD_QA.md`.
