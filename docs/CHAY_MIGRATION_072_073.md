# Chạy migration 072 và 073

*Hướng dẫn cho người giữ tài khoản Supabase. Không cần biết SQL — chỉ cần dán và bấm.*

Hai file này thuộc giai đoạn 8 (cross-mentoring), PR #41. Chưa chạy ở đâu cả:
không staging, không production.

---

## Tóm tắt: hai file này làm gì

| | |
|---|---|
| **072_cross_mentoring.sql** | Tạo **6 bảng mới** cho quy trình cross-mentoring, gieo 28 lĩnh vực vào danh mục, và nới ô `kind` của bảng `outbound_emails` để nhận thêm 4 loại thư. |
| **073_cross_mentoring_event_type.sql** | Cho phép sự kiện mang loại `cross_mentoring`. Rất ngắn. **Có thể không đổi gì cả** — xem bước 6. |

**Không đụng vào:** `mentoring_recaps`, `matches`, `people`, `events`,
`mentor_season_confirmations`, `industries`, `function_areas`. Không tạo đề
xuất nào, không gửi thư cho ai.

---

## Trước khi bắt đầu

### Thứ tự

Chạy theo đúng thứ tự số: **064 → 066 → 067 → 068 → 069 → 070 → 071 → 072 →
073**. Chạy 072 trước 071 vẫn được về mặt kỹ thuật, nhưng đừng — thứ tự số là
thứ tự an toàn.

### Staging trước, production sau

Chạy trọn bộ trên **staging** (`ljfneyuvpxrmejpxsmpz`), kiểm tra xong xuôi, rồi
mới sang **production** (`qkkroesfiazsejkzflcd`).

### Rủi ro thật sự nằm ở đâu

072 **chỉ tạo cái mới**. Câu lệnh duy nhất đụng vào cái đang có là nới ô `kind`
của `outbound_emails` — nới rộng ra, không thu hẹp lại.

Và cả file 072 nằm trong **một giao dịch**: nếu bất kỳ câu nào lỗi, toàn bộ tự
huỷ, database về đúng như trước khi bấm. Không có trạng thái nửa vời.

### Sao lưu

Vào **Database → Backups** trong Supabase và xem có bản gần nhất chưa. Nếu gói
hiện tại không có backup tự động, vẫn nên chụp lại màn hình kết quả **Bước 0**
trước khi chạy, để biết trước khi chạy database đang ở đâu.

---

## Bước 0 — Xem database đang ở đâu

Vào **SQL Editor** → **New query**, dán câu này, bấm **Run**:

```sql
select table_name as bang_da_co
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'outbound_emails',
    'participant_accounts',
    'cross_mentoring_fields',
    'cross_requests'
  )
order by table_name;
```

**Đọc kết quả:**

| Thấy gì | Nghĩa là |
|---|---|
| Không có `outbound_emails` | **Dừng lại.** Migration 064 chưa chạy. Chạy 064 trước. |
| Có `outbound_emails`, không có `participant_accounts` | 071 chưa chạy. Chạy 071 trước rồi quay lại đây. |
| Có `cross_mentoring_fields` hoặc `cross_requests` | 072 **đã chạy rồi**. Nhảy thẳng xuống Bước 3 để kiểm tra. |
| Có `outbound_emails` và `participant_accounts`, không có hai bảng cross | Đúng chỗ rồi. Sang Bước 1. |

---

## Bước 1 — Chạy 072

1. Mở file `supabase_migrations/072_cross_mentoring.sql` trong repo.
2. **Chọn toàn bộ nội dung file** (Ctrl+A) và sao chép. Không cắt bớt phần chú
   thích ở đầu — file phải chạy nguyên vẹn từ `begin;` tới `commit;`.
3. Trong SQL Editor, mở **New query**, dán vào, bấm **Run**.

**Kết quả đúng trông như thế nào:** `Success. No rows returned.`

File này tự kiểm tra chính nó trước khi `commit`. Chạy xong mà thấy dòng
"Success" nghĩa là **mọi thứ đã được kiểm tra và đạt** — không cần tin lời tôi,
chính file đã kiểm.

**Nếu thấy màu đỏ:** đừng chạy lại ngay. Tra bảng lỗi ở cuối tài liệu này trước.

---

## Bước 2 — Kiểm tra 072 đã tạo đủ

Chạy ba câu sau, mỗi câu một lần.

### 2a. Sáu bảng mới

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'cross_mentoring_fields',
    'mentor_cross_fields',
    'cross_requests',
    'cross_invitations',
    'cross_invitation_slots',
    'cross_request_log'
  )
order by table_name;
```

**Kỳ vọng: đúng 6 dòng.**

### 2b. Danh mục lĩnh vực

```sql
select kind as loai,
       count(*) as tong_so,
       count(*) filter (where is_requestable) as mentee_chon_duoc
from public.cross_mentoring_fields
group by kind
order by kind;
```

**Kỳ vọng: đúng 2 dòng.**

| loai | tong_so | mentee_chon_duoc |
|---|---|---|
| function | 14 | 12 |
| industry | 14 | 12 |

Chênh 2 ở mỗi loại là hai mục "Khác" và "Chưa xác định" — có trong danh sách để
mentor khai cho thật, nhưng mentee không đề xuất được, vì không có nhóm mentor
nào tương ứng.

### 2c. Khoá an toàn

```sql
select c.relname as bang,
       c.relrowsecurity as rls_da_bat,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as so_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'cross_mentoring_fields', 'mentor_cross_fields', 'cross_requests',
    'cross_invitations', 'cross_invitation_slots', 'cross_request_log'
  )
order by c.relname;
```

**Kỳ vọng: 6 dòng, cột `rls_da_bat` đều là `true`, cột `so_policy` đều là `0`.**

Đây là điều đúng chứ không phải thiếu sót: sáu bảng này chỉ máy chủ đọc được,
không có đường nào từ trình duyệt vào thẳng. Giống hệt các migration 064–071.

---

## Bước 3 — Xem cột `event_type` ở database này thuộc dạng nào

Trước khi chạy 073, chạy câu này để biết trước sẽ thấy gì:

```sql
select
  case
    when to_regtype('public.event_type') is not null
      then 'DẠNG A — enum'
    when exists (
      select 1 from pg_constraint
      where conrelid = 'public.events'::regclass
        and conname = 'events_event_type_check'
    ) then 'DẠNG B — text kèm CHECK'
    else 'DẠNG C — text tự do, không ràng buộc'
  end as dang_cot;
```

Ba dạng này khác nhau ở chỗ nào:

| Dạng | 073 sẽ làm gì | Ghi lại kết quả |
|---|---|---|
| **A — enum** | Thêm giá trị `cross_mentoring` vào enum | Có thay đổi |
| **B — text + CHECK** | Thay CHECK cũ bằng CHECK có thêm `cross_mentoring` | Có thay đổi |
| **C — text tự do** | **Không làm gì cả** | Không thay đổi — và đó là đúng |

> **Dạng C là bình thường, không phải lỗi.** Lần kiểm tra staging ngày
> 07/05/2026 (ghi trong migration 048) cho thấy `events.event_type` là text
> không có ràng buộc nào. Nếu database vẫn vậy thì 073 chạy xong không đổi gì,
> vì không có gì cần nới — cột đã nhận mọi giá trị rồi.

---

## Bước 4 — Chạy 073

1. Mở `supabase_migrations/073_cross_mentoring_event_type.sql`.
2. Chọn toàn bộ, sao chép, dán vào **New query**, bấm **Run**.

**Kết quả đúng:** `Success. No rows returned.`

File này **không** nằm trong giao dịch, và đó là cố ý — Postgres không cho phép
thêm giá trị vào enum bên trong giao dịch. Migration 048 (thêm loại `kickoff`)
cũng viết hệt như vậy vì cùng lý do.

### Nếu Bước 3 ra DẠNG A và 073 báo lỗi có chữ "transaction" hoặc "function"

Đây là trường hợp duy nhất cần can thiệp tay. Mở **New query** mới, dán **đúng
một dòng này**, không kèm gì khác, bấm Run:

```sql
alter type public.event_type add value if not exists 'cross_mentoring';
```

Rồi chạy lại toàn bộ file 073 một lần nữa — phần còn lại của file sẽ tự bỏ qua
bước đã làm.

---

## Bước 5 — Kiểm tra 073

```sql
select
  case
    when to_regtype('public.event_type') is not null then
      case when exists (
        select 1 from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
          and t.typname = 'event_type'
          and e.enumlabel = 'cross_mentoring'
      ) then 'ĐẠT — enum đã có cross_mentoring'
      else 'CHƯA ĐẠT — enum còn thiếu cross_mentoring' end
    when exists (
      select 1 from pg_constraint
      where conrelid = 'public.events'::regclass
        and conname = 'events_event_type_check'
    ) then
      case when exists (
        select 1 from pg_constraint
        where conrelid = 'public.events'::regclass
          and conname = 'events_event_type_check'
          and pg_get_constraintdef(oid) like '%cross_mentoring%'
      ) then 'ĐẠT — CHECK đã có cross_mentoring'
      else 'CHƯA ĐẠT — CHECK còn thiếu cross_mentoring' end
    else 'ĐẠT — cột là text tự do, không cần sửa gì'
  end as ket_qua;
```

**Kỳ vọng: một dòng bắt đầu bằng `ĐẠT`.** Cả ba câu trả lời `ĐẠT` đều đúng — cái
nào hiện ra tuỳ dạng cột ở Bước 3.

---

## Bước 6 — Kiểm tra bốn loại thư mới

```sql
select pg_get_constraintdef(oid) like '%cross_scheduled%' as du_bon_loai_thu
from pg_constraint
where conname = 'outbound_emails_kind_check'
  and conrelid = 'public.outbound_emails'::regclass;
```

**Kỳ vọng: một dòng, giá trị `true`.**

Bốn loại thư mới: mời mentor, báo được chọn, báo lần này chưa xếp được, và báo
cho mentee là buổi đã có lịch.

---

## Bước 7 — Lặp lại trên production

Khi staging đã qua trọn bộ Bước 0 → 6, làm lại **đúng thứ tự đó** trên
production (`qkkroesfiazsejkzflcd`). Không bỏ bước kiểm tra: hai database này
đã lệch nhau ở chỗ khác trước đây, nên cái đúng trên staging chưa chắc đúng
ngay ở production.

---

## Bảng lỗi

Migration 072 dừng lại bằng những thông báo có tên riêng. Đây là ý nghĩa từng cái.

| Thông báo bắt đầu bằng | Nghĩa là | Làm gì |
|---|---|---|
| `PREREQ_MISSING` | Thiếu một bảng hoặc hàm mà 072 cần. Thông báo nói rõ thiếu cái nào. | Chạy migration tạo ra thứ đó trước. Nếu là `outbound_emails` thì đó là 064. |
| `SEED_INCOMPLETE` | Danh mục lĩnh vực không đủ 14+14. | Nhiều khả năng đã chạy một bản 072 cũ hơn. Gửi lại thông báo cho tôi. |
| `CONSTRAINT_CONTRACT_VIOLATION` | Một ràng buộc bắt buộc không được tạo ra. | Đừng chạy lại. Gửi thông báo cho tôi. |
| `RLS_CONTRACT_VIOLATION` | Bảng mới không được khoá đúng cách. | Như trên. Đây là lỗi an toàn, không tự sửa. |
| `GRANT_CONTRACT_VIOLATION` | Ai đó có quyền không nên có, hoặc bảng nhật ký sửa/xoá được. | Như trên. |

**Trường hợp riêng — lỗi ở câu nới `outbound_emails_kind_check`:**
nếu production có sẵn một giá trị `kind` mà danh sách trong 072 không liệt kê,
câu thêm lại sẽ báo lỗi và **toàn bộ 072 tự huỷ**, không để lại gì. Chạy câu này
để biết giá trị lạ đó là gì:

```sql
select distinct kind from public.outbound_emails order by kind;
```

Gửi danh sách đó cho tôi, tôi bổ sung vào file rồi chạy lại.

---

## Nếu cần quay lui

**072** — sáu bảng đều mới và chưa có dữ liệu thật ngay sau khi chạy, nên xoá
được sạch:

```sql
begin;
drop table if exists public.cross_request_log;
drop table if exists public.cross_invitation_slots;
drop table if exists public.cross_invitations;
drop table if exists public.cross_requests;
drop table if exists public.mentor_cross_fields;
drop table if exists public.cross_mentoring_fields;
commit;
```

> Thứ tự trên là cố ý — bảng con trước, bảng cha sau. **Chỉ dùng khi vừa chạy
> xong và chưa ai dùng tính năng.** Khi đã có đề xuất thật thì đây là xoá dữ liệu
> thật, không phải quay lui.

Ô `kind` của `outbound_emails` cứ để nguyên: nó chỉ rộng ra, không cản gì.

**073** — nếu là dạng B hoặc C thì không cần quay lui. Nếu là **dạng A (enum)**
thì **không quay lui được**: Postgres không cho xoá giá trị khỏi enum. Muốn bỏ
phải dựng một enum mới rồi đổi cột — việc lớn, và cũng là lý do file 073 chỉ
thêm đúng một giá trị mà ứng dụng thật sự dùng, không thêm gì dự phòng.

---

## Sau khi chạy xong

1. Merge chuỗi PR theo thứ tự **#35 → #36 → #37 → #38 → #39 → #40 → #41**.
2. Nhắc mentor vào cổng khai lĩnh vực (`Trang chương trình → Cross-mentoring`).
   Mentor nộp đơn qua form thì đã có sẵn, không cần làm gì.
3. Cấp quyền `operations` mùa hiện tại cho support team, nếu chưa.
4. Xem `docs/CROSS_MENTORING_HUONG_DAN_BTC.md` để biết ban tổ chức thao tác thế nào.
