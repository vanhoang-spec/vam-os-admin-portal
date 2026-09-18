import Link from "next/link";

/**
 * Dải tab của module Mail.
 *
 * Hai trang, một module. Sổ thư đã gửi vẫn là route riêng
 * (`/operations/emails`) — nó có bộ lọc, phân trang và các đường dẫn sâu mà
 * người ta đã bookmark — nhưng dải tab này nằm trên cả hai, nên soạn thư và tra
 * thư đã gửi cảm giác như một chỗ chứ không phải hai mục nav rời nhau.
 *
 * Là component máy chủ, nhận `active` chứ không tự đọc đường dẫn: mỗi trang tự
 * biết mình là tab nào, và không cần đẩy một client component vào chỉ để tô đậm
 * một chữ.
 */
export type MailTab = "templates" | "samples" | "log";

const TABS: Array<{ key: MailTab; href: string; label: string; helper: string }> = [
  {
    key: "templates",
    href: "/operations/mail",
    label: "Mẫu thư",
    helper: "Soạn và duyệt nội dung"
  },
  {
    key: "samples",
    href: "/operations/mail/samples",
    label: "Thư tự động",
    helper: "Nội dung hệ thống tự gửi"
  },
  {
    key: "log",
    href: "/operations/emails",
    label: "Nhật ký gửi",
    helper: "Mọi lá thư đã đi"
  }
];

export function MailTabs({
  active,
  canSeeLog,
  canSeeSamples = true
}: {
  active: MailTab;
  canSeeLog: boolean;
  canSeeSamples?: boolean;
}) {
  // Tab dẫn tới một trang người dùng không vào được thì tệ hơn là không có tab:
  // nó hứa một chỗ rồi trả về màn hình từ chối.
  const visible = TABS.filter(
    (tab) => (tab.key !== "log" || canSeeLog) && (tab.key !== "samples" || canSeeSamples)
  );
  if (visible.length < 2) return null;

  return (
    <nav aria-label="Module Mail" className="mb-6 flex flex-wrap gap-2 border-b border-vam-line">
      {visible.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm transition-colors ${
              isActive
                ? "border-vam-green bg-vam-mint font-semibold text-vam-ink"
                : "border-transparent text-slate-600 hover:border-slate-300 hover:text-vam-ink"
            }`}
          >
            {tab.label}
            <span className="ml-2 hidden text-xs font-normal text-slate-500 sm:inline">
              {tab.helper}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
