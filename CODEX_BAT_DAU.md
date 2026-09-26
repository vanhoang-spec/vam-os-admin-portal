# Phiên mới của Codex trên VAM OS (UEH Mentoring)

Chủ dự án gõ: `doc file CODEX_BAT_DAU.md va lam theo`

**Chưa sửa, chưa tạo, chưa xoá file nào; chưa chạy lệnh ghi gì (kể cả `git push`,
`gh pr merge`, hay bất cứ SQL nào không phải `select`).**

## 1. Đọc lần lượt

- `CLAUDE.md` — luật làm việc của repo này. Đọc HẾT, đặc biệt hai mục:
  - **"Migration phải dán tay TRƯỚC khi merge"** — merge vào `main` tự động test,
    build, deploy production qua GitHub Actions, nhưng **KHÔNG** tự chạy migration.
    Có migration trong PR mà chưa dán tay vào Supabase SQL Editor (Production) thì
    đừng merge.
  - **"Bốn cổng"** và **"Nếp viết test của dự án này"** — mọi PR phải qua đủ
    `typecheck` · `lint` · `npx vitest run` · `npm run build`, và ca test mới phải
    được chứng minh bắt được đúng lỗi nó viết ra để bắt (sửa hỏng mã theo đúng cách
    lỗi xảy ra, xác nhận test đỏ, rồi hoàn lại).
- `BAN_GIAO_AI.md` (cùng thư mục) — việc đang dở, PR nào đang chờ gì. File này
  **có ngày cập nhật** ở đầu; càng xa ngày hôm nay càng nên tự kiểm lại bằng bước 2
  dưới đây thay vì tin nguyên văn.
- `C:\Users\DELL\.claude\projects\D--AI-App-Embassy-VAM-Platform-vam-os-admin-portal\memory\MEMORY.md`
  — mục lục kinh nghiệm của các phiên Claude Code trước, **CHỈ ĐỌC**. Mở file chi
  tiết khi việc đang làm liên quan trực tiếp tới dòng mục lục đó.
- `README.md` — **CŨ, đừng tin**: viết từ giai đoạn MVP "chỉ đọc, chưa đăng nhập".
  Sản phẩm thật hiện đã có đăng nhập, RLS, và hàng chục tính năng cho cả admin lẫn
  mentor/mentee. `CLAUDE.md` và `BAN_GIAO_AI.md` thắng khi hai bên mâu thuẫn.

## 2. Tự kiểm trạng thái sống — CHỈ ĐỌC

```bash
git branch --show-current
git status
git log --oneline -5
gh pr list --state open --json number,title,headRefName,createdAt
```

Trong danh sách PR trả về: những PR số nhỏ (khoảng dưới 110) là tồn đọng cũ từ một
nhánh S12 đã bỏ dở trước khi dựng lại trên `main` — không phải việc đang dở, đừng
động vào trừ khi chủ dự án nói rõ. PR mới thường mang tên nhánh bắt đầu bằng
`feat/`, `fix/`, hoặc `docs/huong-dan-…`.

## 3. Supabase MCP — CHỈ DÙNG KHI ĐÃ XÁC NHẬN ĐÚNG PROJECT

MCP Supabase cấu hình toàn cục của Codex trên máy này (`~/.codex/config.toml`,
mục `mcp_servers.supabase`) đang trỏ vào project khác (CRM Kids Embassy), **không
phải** production của VAM OS (project ref `qkkroesfiazsejkzflcd`). Trước khi chạy
bất kỳ câu `select` nào qua MCP đó cho việc của repo này: kiểm project ref đang trỏ
tới, và nếu không phải `qkkroesfiazsejkzflcd` thì **dừng lại, hỏi chủ dự án** thay
vì tự đoán hay tự sửa cấu hình toàn cục (sửa nhầm sẽ ảnh hưởng luôn cả các dự án
khác đang dùng Codex trên máy này).

## 4. Trả lời bằng tiếng Việt

1. Đang ở nhánh nào, đã đồng bộ với `origin/main` chưa.
2. 5 luật quan trọng nhất tuyệt đối không được vi phạm ở repo này, và vì sao (rút
   từ `CLAUDE.md`).
3. Từng PR đang mở tìm được ở bước 2 (loại bỏ nhóm tồn đọng cũ) — đang chờ gì,
   migration nào (nếu có) phải dán tay trước khi merge.
4. Những loại việc sẽ hỏi chủ dự án trước khi làm: dán/chạy migration, xoá dữ
   liệu, đổi nameserver/DNS, chạm khoá `service_role`/`sb_secret_`, merge một PR,
   bật RLS sai cách trên bảng công khai.
