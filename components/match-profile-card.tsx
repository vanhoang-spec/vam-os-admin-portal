import type { ProfileCard } from "@/lib/match-profile-core";

/**
 * Thẻ hồ sơ tóm tắt — dùng chung cho trang công khai /ho-so/<token> và trang xem trước của BTC, để
 * BTC xem đúng thứ người đồng hành sẽ thấy.
 *
 * Chữ tự do của người khác được React escape; xuống dòng được giữ (whitespace-pre-line). Đường dẫn
 * chỉ thành link khi là http(s) (linkify), mở tab mới và không gửi kèm địa chỉ trang này.
 */
export function MatchProfileCard({ card }: { card: ProfileCard }) {
  return (
    <dl className="divide-y divide-vam-line rounded-lg border border-vam-line bg-white" data-testid="match-profile-card">
      {card.fields.map((f) => (
        <div key={f.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4" data-field={f.key}>
          <dt className="text-sm font-medium text-slate-500">{f.label}</dt>
          <dd className="whitespace-pre-line break-words text-sm leading-6 text-vam-ink">
            {f.links
              ? f.links.map((part, i) =>
                  part.kind === "link" ? (
                    <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-vam-green underline">
                      {part.value}
                    </a>
                  ) : (
                    <span key={i}>{part.value} </span>
                  )
                )
              : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
