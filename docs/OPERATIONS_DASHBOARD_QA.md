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
| Current-month activity | Dem distinct `mentee_person_id` va `mentor_person_id` trong recap hop le cua selected month. | `count(distinct mentee_person_id)`, `count(distinct mentor_person_id)` voi filter recap hop le trong `selectedMonth`. | Day la activity KPI cua thang dang xem, khong phai follow-up trigger. |
| Ty le mentee active | Tu so: mentee co recap trong thang va nam trong tap active matched mentees. Mau so: distinct mentees trong active matches cua season `UEHM-S11`. | `count(distinct recap.mentee_person_id join active matches) / count(distinct active_matches.mentee_person_id)` | Dat ve mat operational health. Luu y tu so khac voi card "Mentee active" neu co recap ngoai active match. |
| Mentor chua co recap | Distinct active matched mentors cua season `UEHM-S11` khong xuat hien trong selected recap mentor set. | `active_matched_mentors except distinct recap.mentor_person_id` | Dat. Mau/tap nen dung active matched mentors, app dang lam dung. |
| Event/training trong thang | Dem `events` co `starts_at` roi map ve `YYYY-MM = selectedMonth`. | `count(*) from events where starts_at >= month_start and starts_at < next_month` | Tam dat. Event data chua seed/import day du; app khong con dung `event_code`/`event_date`. |
| Luot tham du event | Dem `event_participations` co `event_id` nam trong event cua thang va `attendance_status = 'attended'`. | join `event_participations.event_id = events.id`, filter `events.starts_at` theo thang va `attendance_status='attended'` | Tam dat. Chua co import event participation nen co the la 0. |
| Ty le attendance | `attended / (attended + registered_absent)` tren participation cua event trong thang. Neu mau so 0 thi hien "Chua co du lieu". | `attended_count / (attended_count + registered_absent_count)` | Tam dat. Dinh nghia phu hop voi status MVP. |
| Feedback count | Hien "Chua trien khai". | Chua co bang/module feedback. | Dung voi scope hien tai. |
| Closed-month missing recap | Active matched mentees khong co recap trong thang da dong gan nhat. Neu selected month la thang hien tai hoac tuong lai, dung thang truoc hien tai lam closed month. | `active_matched_mentees where not exists recap(month=:closed_month)` | Day la warning KPI, chua tao action item. |
| 2-month consecutive silent warning | Active matched mentees khong co recap trong closed month va cung khong co recap trong closed previous month. | `active_matched_mentees where not exists recap(month=:closed_month) and not exists recap(month=:closed_previous_month)` | Day la danh sach can follow-up chinh thuc trong dashboard, khong phai workflow/action state. |

## Official KPI Logic After Phase 2 Stabilization

1. Current-month activity
   - Uses selected month.
   - Counts valid recaps in that month.
   - Valid recap statuses are `submitted`, `needs_review`, or blank legacy status.
   - This supports activity reporting while the month is still open.

2. Closed-month missing recap
   - Uses the latest closed month.
   - If selected month is the current calendar month or later, closed month is previous calendar month.
   - If selected month is already in the past, closed month is selected month.
   - Counts active matched mentees with no valid recap in that closed month.

3. 2-month consecutive silent warning
   - Uses closed month plus the month before it.
   - Counts active matched mentees with no valid recap in both months.
   - This is the official follow-up warning list for the dashboard.
   - A warning row does not mutate data and does not create an action item by itself.

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
- Follow-up candidate hien co nghia la thieu recap hai thang lien tiep: closed month va closed previous month. Day la candidate list, khong phai action workflow.

## Gioi han da biet

- Event participation chua import, nen event attendance KPI co the hien 0 hoac "Chua co du lieu".
- Feedback module chua trien khai.
- Dashboard follow-up warning khong tu dong tao `action_items`, owner, status, due date, hay lich su xu ly.
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

---

## Addendum 2026-08-12 — "Active mentee" semantics, ruled

Ban review doc lap cua ban vá `hotfix-operations-scoped-aggregate-truncation`
neu ra rang `/operations` hien thi hai so deu doc la "mentee active", va hoi day
la (A) business semantics co chu dich hay (B) mot su khong nhat quan trong dinh
nghia cua ung dung.

**Ket luan: (A) — co chu dich.** Tai lieu nay la authority va da ghi ro su khac
biet do tu dau, tai dong "Ty le mentee active": *"Luu y tu so khac voi card
'Mentee active' neu co recap ngoai active match"*. View trong database
(`v_monthly_activity_summary`) cung dinh nghia khai niem thu nhat theo dung cach
do — `count(distinct mentee_person_id)` tren recap hop le, khong join `matches`.
Hai so tra loi hai cau hoi khac nhau va ca hai deu can co tren dashboard.

Ten chinh thuc cua hai khai niem:

| Ten | Dinh nghia | Xuat hien tai |
| --- | --- | --- |
| **Recap-activity mentee** (khai niem A) | Distinct `mentee_person_id` co recap hop le trong thang. **Khong** yeu cau match active. | Card "Mentee active"; `ProgramOperationsKpis.activeMenteeCount` |
| **Active-matched mentee with recap** (khai niem B) | Distinct mentee vua co match `active` vua co recap hop le trong thang. | **Tu so** cua card "Tỷ lệ mentee active"; bien `activeMatchedMenteeWithRecapCount` trong `app/operations/page.tsx` |

Luon co `B <= A`. Hieu `A - B` la so mentee co recap nhung khong nam trong mot
match active.

Thay doi da thuc hien de dong ambiguity nay (khong doi gia tri KPI nao):

- `lib/operations-kpis.ts` ghi ro hai khai niem va ly do chung khac nhau.
- Bien trong `app/operations/page.tsx` doi ten thanh
  `activeMatchedMenteeWithRecapCount` (truoc do ten `activeMenteeCount`, trung
  ten voi khai niem A).
- Moi the KPI lien quan tren `/operations` co them dong `helper` neu ro dinh
  nghia, tu so va mau so ngay tren giao dien.
- Probe `docs/audits/sql/VAM_OS_PROD_OPERATIONS_ROLE_DATA_DIVERGENCE_READONLY_PROBE.sql`
  tinh **rieng** ca hai, cong them truong `concept_a_minus_concept_b`.

De xuat cu o muc "De xuat future fixes" (doi label "Mentee active" thanh "Mentee
co recap" tren toan bo san pham) **van con mo**: no cham `/`, `/operations` va
`/operations/intelligence` nen la mot quyet dinh san pham rieng, khong nam trong
pham vi ban vá data-correctness nay.

### Drift da phat hien, chua sua

Dong "Ty le attendance" trong bang tren ghi `attended / (attended +
registered_absent)`. Code dang chay dung `attended / tong so participation cua
thang`, ke ca cac luot chua cap nhat trang thai, va **da cong bo dieu do ngay
tren giao dien** ("Bao gồm cả các lượt chưa cập nhật trạng thái trong mẫu số")
cung nhan "Tỷ lệ tham dự / tổng đăng ký". Day la mot thay doi co chu dich xay ra
sau ban audit nay va tai lieu chua duoc cap nhat. Probe tra ve **ca hai** mau so
(`card_8_rate_over_total_pct` va
`card_8_rate_over_attended_plus_absent_pct_doc_definition`) de owner chon dinh
nghia canonical. Khong doi code trong ban vá nay.
