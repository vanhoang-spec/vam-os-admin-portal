import {
  EVENT_FORMAT_LABELS,
  isEventFormat,
  needsJoinUrl,
  needsVenue,
  resolveMapUrl,
  type EventFormat
} from "@/lib/event-location";
import type { Event } from "@/lib/types";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

/**
 * Nơi và lúc một sự kiện diễn ra.
 *
 * Một thành phần dùng cho cả ba màn hình — trang quản trị, trang đăng ký công
 * khai, trang check-in — vì ba câu trả lời khác nhau cho cùng một câu hỏi
 * "ở đâu, mấy giờ" là ba cơ hội để một trong ba nói sai.
 *
 * Component máy chủ: nó chỉ đọc và hiển thị, không cần trạng thái nào.
 */

function eventFormat(event: Event): EventFormat {
  return isEventFormat(event.event_format) ? event.event_format : "offline";
}

/**
 * Khoảng thời gian, gộp lại khi cùng ngày.
 *
 * `08/09/2026 14:00 – 17:00` thay vì lặp lại ngày hai lần. Sự kiện vắt qua nửa
 * đêm thì hiện đủ cả hai ngày, vì lúc đó ngày mới là phần người đọc cần.
 */
export function formatEventWhen(event: Event): string {
  const start = formatDateTime(event.starts_at);
  if (!event.ends_at) return start;

  const sameDay = formatDate(event.starts_at) === formatDate(event.ends_at);
  return sameDay ? `${start} – ${formatTime(event.ends_at)}` : `${start} – ${formatDateTime(event.ends_at)}`;
}

/** Dòng một hàng cho danh sách: hình thức và nơi chốn, không có đường dẫn. */
export function EventPlaceSummary({ event }: { event: Event }) {
  const format = eventFormat(event);
  const venue = [event.location_name, event.location_address]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" — ");

  if (format === "online") {
    return <span className="text-xs text-slate-500">Trực tuyến</span>;
  }
  if (!venue) {
    return (
      <span className="text-xs text-slate-400">
        {format === "hybrid" ? "Cả hai · chưa có địa điểm" : "Chưa có địa điểm"}
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-500">
      {format === "hybrid" ? "Cả hai · " : ""}
      {venue}
    </span>
  );
}

/**
 * Khối đầy đủ cho trang chi tiết và hai trang công khai.
 *
 * Đường dẫn bản đồ mở ở tab mới kèm `rel="noreferrer"`: nó là đường dẫn ra
 * ngoài, và trang đích không cần biết người dùng đến từ đâu.
 */
export function EventPlaceBlock({
  event,
  tone = "light"
}: {
  event: Event;
  /** `dark` cho phần đầu trang công khai, nơi nền là màu đậm. */
  tone?: "light" | "dark";
}) {
  const format = eventFormat(event);
  const mapUrl = needsVenue(format)
    ? resolveMapUrl({ mapUrl: event.location_map_url, address: event.location_address })
    : null;
  const joinUrl = needsJoinUrl(format) ? String(event.online_join_url ?? "").trim() : "";

  const muted = tone === "dark" ? "text-slate-300" : "text-slate-500";
  const body = tone === "dark" ? "text-slate-100" : "text-vam-ink";
  const link = tone === "dark" ? "text-vam-mint underline" : "text-vam-green underline";

  const venueName = String(event.location_name ?? "").trim();
  const venueAddress = String(event.location_address ?? "").trim();
  const hasVenue = Boolean(venueName || venueAddress);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className={body}>
        <span className={`mr-2 text-xs uppercase ${muted}`}>Thời gian</span>
        {formatEventWhen(event)}
      </p>

      <p className={body}>
        <span className={`mr-2 text-xs uppercase ${muted}`}>Hình thức</span>
        {EVENT_FORMAT_LABELS[format]}
      </p>

      {needsVenue(format) ? (
        <div className={body}>
          <span className={`mr-2 text-xs uppercase ${muted}`}>Địa điểm</span>
          {hasVenue ? (
            <>
              {venueName ? <span className="font-medium">{venueName}</span> : null}
              {venueName && venueAddress ? <span className={muted}> — </span> : null}
              {venueAddress ? <span>{venueAddress}</span> : null}
              {mapUrl ? (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`ml-2 whitespace-nowrap ${link}`}
                >
                  Xem trên bản đồ
                </a>
              ) : null}
            </>
          ) : (
            <span className={muted}>Ban tổ chức sẽ thông báo sau</span>
          )}
        </div>
      ) : null}

      {needsJoinUrl(format) ? (
        <p className={body}>
          <span className={`mr-2 text-xs uppercase ${muted}`}>Tham gia</span>
          {joinUrl ? (
            <a href={joinUrl} target="_blank" rel="noreferrer" className={link}>
              Mở phòng họp trực tuyến
            </a>
          ) : (
            <span className={muted}>Ban tổ chức sẽ gửi đường dẫn sau</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
