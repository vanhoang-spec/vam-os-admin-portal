# Hướng Dẫn Import Activity Tracking Phase 2

Thư mục này chứa script import CSV cho Phase 2 Activity & Event Tracking. Script chỉ dùng nội bộ, chạy local, kết nối trực tiếp Postgres qua `DATABASE_URL`.

## 1. Chuẩn Bị

Cài thư viện Python:

```bash
pip install -r activity_import_runner/requirements.txt
```

Tạo file môi trường:

```bash
copy activity_import_runner\.env.example activity_import_runner\.env
```

Điền `DATABASE_URL` trong `activity_import_runner/.env`.

Không commit file `.env`. File này có thể chứa mật khẩu database.

## 2. File CSV

Template hiện có:

- `templates/mentoring_recaps_import_template.csv`
- `templates/event_participations_import_template.csv`

Bạn có thể copy template ra file mới rồi điền dữ liệu thật.

## 3. Quy Tắc Mentoring Recap

- Một dòng = một recap cho đúng một buổi gặp mentor-mentee.
- Một recap không đại diện cho nhiều buổi gặp.
- Mỗi mentee được kỳ vọng có ít nhất một recap mỗi tháng.
- Follow-up thiếu recap chỉ tạo sau hai tháng liên tiếp không có recap.
- Không cần copy toàn bộ nội dung bài Facebook; chỉ cần `recap_url`.

Giá trị cho phép:

- `recap_source`: `facebook_group`, `google_sheet`, `admin_input`
- `issue_flag`: `true`, `false`

Chạy dry-run:

```bash
python activity_import_runner/import_activity_records.py --type mentoring_recaps --file templates/mentoring_recaps_import_template.csv --dry-run
```

Chạy import thật:

```bash
python activity_import_runner/import_activity_records.py --type mentoring_recaps --file path/to/filled_recaps.csv --import
```

Script sẽ yêu cầu gõ `IMPORT` để xác nhận trước khi ghi dữ liệu. Có thể dùng `--yes` để bỏ qua xác nhận nếu đang chạy trong quy trình đã kiểm soát.

## 4. Quy Tắc Event Participation

Phase 2 chỉ theo dõi:

- `Mentee Orientation`
- `Kickoff`
- `Tổng kết`

Giá trị cho phép:

- `registration_status`: `registered`, `unknown`
- `attendance_status`: `attended`, `registered_absent`
- `role_at_event`: `mentor`, `mentee`, `core_team`, `speaker`, `trainer`, `guest`, `unknown`

Chạy dry-run:

```bash
python activity_import_runner/import_activity_records.py --type event_participations --file path/to/filled_events.csv --dry-run
```

Chạy import thật:

```bash
python activity_import_runner/import_activity_records.py --type event_participations --file path/to/filled_events.csv --import
```

## 5. Script Resolve Dữ Liệu Như Thế Nào

Mentoring recaps:

- `season_id`: tìm theo `seasons.season_code`.
- `mentee_person_id`: ưu tiên `mentee_profiles.mentee_code`, sau đó `people.email_primary`.
- `mentor_person_id`: ưu tiên `mentor_profiles.mentor_code`, sau đó `people.email_primary`.
- `match_id`: dùng `match_id` nếu tồn tại; nếu không thì tìm active match theo mentor và mentee.

Event participations:

- `season_id`: tìm theo `seasons.season_code`.
- `event_id`: ưu tiên `events.event_code`, sau đó `events.event_name + event_date`.
- `person_id`: tìm `person_code` trong mentor/mentee profile, sau đó tìm `people.email_primary`.

## 6. Báo Cáo Sau Mỗi Lần Chạy

Mỗi lần dry-run/import sẽ tạo report trong:

```text
activity_import_runner/reports/
```

File report:

- `activity_import_report_YYYYMMDD_HHMMSS.md`

Nếu có dòng chưa resolve được, script tạo thêm:

- `unresolved_activity_rows_YYYYMMDD_HHMMSS.csv`

Hãy review file unresolved, sửa CSV nguồn, rồi chạy dry-run lại trước khi import.

## 7. Duplicate Warnings

Script chỉ cảnh báo, không tự chặn import, nếu thấy dữ liệu giống đã tồn tại:

- Mentoring recap: cùng `mentee_person_id + meeting_date + recap_url`.
- Event participation: cùng `event_id + person_id`.

Nếu warning là đúng duplicate, hãy xóa dòng đó khỏi CSV trước khi import.
