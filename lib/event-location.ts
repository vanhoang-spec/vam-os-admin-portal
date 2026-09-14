/**
 * lib/event-location.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sự kiện diễn ra ở đâu, và làm sao người được mời tới được đó.
 *
 * Module thuần, không I/O. Được dùng ở cả ba phía: form của BTC, trang đăng ký
 * công khai, và thân thư mời — nên nếu đường dẫn bản đồ đúng ở một chỗ thì nó
 * đúng ở cả ba.
 */

export const EVENT_FORMATS = ["offline", "online", "hybrid"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const EVENT_FORMAT_LABELS: Record<EventFormat, string> = {
  offline: "Tại địa điểm",
  online: "Trực tuyến",
  hybrid: "Cả hai (tại địa điểm và trực tuyến)"
};

export function isEventFormat(value: unknown): value is EventFormat {
  return typeof value === "string" && (EVENT_FORMATS as readonly string[]).includes(value);
}

/** Sự kiện có mặt tại chỗ thì mới cần địa chỉ. */
export function needsVenue(format: EventFormat): boolean {
  return format === "offline" || format === "hybrid";
}

/** Sự kiện có phần trực tuyến thì mới cần đường dẫn phòng họp. */
export function needsJoinUrl(format: EventFormat): boolean {
  return format === "online" || format === "hybrid";
}

/**
 * Các miền được chấp nhận cho một đường dẫn bản đồ dán tay.
 *
 * Đường dẫn này đi vào thư mời gửi hàng loạt, nên nó là một đường dẫn chúng ta
 * đặt trước mặt hàng trăm người kèm uy tín của chương trình. Nhận bất kỳ URL
 * nào là biến ô "địa điểm" thành một chỗ để đặt đường dẫn bất kỳ vào thư của
 * chương trình. Danh sách đóng, và mở rộng nó là một quyết định có người ký.
 */
const MAP_HOSTS = [
  "google.com",
  "www.google.com",
  "maps.google.com",
  "goo.gl",
  "maps.app.goo.gl"
] as const;

export type MapUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; message: string };

/**
 * Kiểm một đường dẫn bản đồ do người dùng dán vào.
 *
 * Rỗng là hợp lệ và trả về null: đường dẫn dán tay chỉ cần khi địa chỉ tự do
 * không trỏ đúng chỗ.
 */
export function normalizeMapUrl(value: unknown): MapUrlResult {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, url: null };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "Đường dẫn bản đồ không hợp lệ. Hãy dán đường dẫn đầy đủ." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Đường dẫn bản đồ phải bắt đầu bằng https://" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!(MAP_HOSTS as readonly string[]).includes(host)) {
    return {
      ok: false,
      message:
        "Chỉ nhận đường dẫn Google Maps (google.com/maps, maps.app.goo.gl). Đường dẫn này sẽ được gửi cho người tham dự."
    };
  }

  // `google.com` không kèm đường dẫn bản đồ thì chỉ là trang tìm kiếm.
  if ((host === "google.com" || host === "www.google.com") && !parsed.pathname.startsWith("/maps")) {
    return { ok: false, message: "Đường dẫn google.com này không phải đường dẫn bản đồ." };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Dựng đường dẫn bản đồ từ một địa chỉ.
 *
 * Để BTC chỉ phải gõ địa chỉ — thứ họ vốn phải gõ — mà người nhận thư vẫn bấm
 * được một phát ra chỉ đường. Dùng đúng dạng liên kết chính thức của Google
 * (`/maps/search/?api=1&query=`), dạng ổn định qua các lần Google đổi giao diện.
 */
export function deriveMapUrl(address: unknown): string | null {
  const raw = String(address ?? "").trim();
  if (!raw) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}`;
}

/**
 * Đường dẫn bản đồ cuối cùng để hiển thị và để gửi đi.
 *
 * Đường dẫn dán tay thắng đường dẫn suy ra: BTC dán nó chính vì địa chỉ tự do
 * trỏ sai chỗ, nên để chuỗi địa chỉ đè lên nó là làm hỏng đúng việc sửa đó.
 */
export function resolveMapUrl(input: {
  mapUrl?: unknown;
  address?: unknown;
}): string | null {
  const pasted = normalizeMapUrl(input.mapUrl);
  if (pasted.ok && pasted.url) return pasted.url;
  return deriveMapUrl(input.address);
}

export type JoinUrlResult = { ok: true; url: string | null } | { ok: false; message: string };

/**
 * Kiểm đường dẫn phòng họp trực tuyến.
 *
 * Không giới hạn miền như đường dẫn bản đồ: chương trình dùng Zoom, Meet,
 * Teams và cả đường dẫn nội bộ của doanh nghiệp đối tác, và một danh sách đóng
 * ở đây sẽ chặn đúng những buổi hợp lệ. Chỉ ràng buộc điều thật sự cần: là một
 * đường dẫn https đọc được.
 */
export function normalizeJoinUrl(value: unknown): JoinUrlResult {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, url: null };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "Đường dẫn tham gia không hợp lệ. Hãy dán đường dẫn đầy đủ." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Đường dẫn tham gia phải bắt đầu bằng https://" };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * Buổi có phần trực tuyến thì đường dẫn phòng họp là BẮT BUỘC.
 *
 * Trước luật này, `normalizeJoinUrl("")` trả về hợp lệ với `url: null`, nên một
 * buổi trực tuyến lưu được mà không có chỗ để vào. Hỏng ở chỗ không ai thấy:
 * form lưu êm, danh sách hiện bình thường, và người đăng ký nhận một lá thư xác
 * nhận không nói được vào bằng cách nào — họ chỉ phát hiện ra đúng lúc buổi bắt
 * đầu, khi không còn ai kịp sửa.
 *
 * Đặt ở module thuần để form của BTC và hàm ghi dùng chung một câu trả lời: ô
 * đánh dấu bắt buộc trên màn hình không phải một phép kiểm, và hàm ghi phải tự
 * kiểm lại thứ người gửi tự đặt được.
 */
export function validateJoinUrlForFormat(
  format: EventFormat,
  joinUrl: string | null
): { ok: true } | { ok: false; message: string } {
  if (needsJoinUrl(format) && !joinUrl) {
    return {
      ok: false,
      message: "Buổi có phần trực tuyến phải có đường dẫn phòng họp — thư xác nhận gửi cho người đăng ký lấy đường dẫn từ đây."
    };
  }
  return { ok: true };
}

/**
 * Nơi diễn ra, dạng mà thân thư cần: một dòng địa điểm, link bản đồ, link họp.
 *
 * Một cửa cho ba lá thư — xác nhận đăng ký, báo đổi lịch, nhắc lịch. Trước đây
 * mỗi lá tự dựng ba giá trị này, và ba bản chép là ba cơ hội để một lá gửi link
 * bản đồ cho buổi thuần trực tuyến, hay quên link họp của buổi vừa tại chỗ vừa
 * trực tuyến.
 */
export function eventEmailPlace(event: {
  event_format?: unknown;
  location_name?: unknown;
  location_address?: unknown;
  location_map_url?: unknown;
  online_join_url?: unknown;
}): { format: EventFormat; placeLabel: string | null; mapUrl: string | null; joinUrl: string | null } {
  const format = isEventFormat(event.event_format) ? event.event_format : "offline";
  const placeLabel = needsVenue(format)
    ? [event.location_name, event.location_address]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" — ") || null
    : null;
  const mapUrl = needsVenue(format)
    ? resolveMapUrl({ mapUrl: event.location_map_url, address: event.location_address })
    : null;
  const joinUrl = needsJoinUrl(format) ? String(event.online_join_url ?? "").trim() || null : null;
  return { format, placeLabel, mapUrl, joinUrl };
}

export type EventPlace = {
  format: EventFormat;
  locationName: string | null;
  locationAddress: string | null;
  mapUrl: string | null;
  joinUrl: string | null;
};

/**
 * Một dòng mô tả nơi diễn ra, cho danh sách và cho thân thư.
 *
 * Trả về chuỗi rỗng khi chưa có gì để nói, thay vì một chỗ giữ chỗ trông như
 * dữ liệu thật.
 */
export function describePlace(place: EventPlace): string {
  const parts: string[] = [];

  if (needsVenue(place.format)) {
    const venue = [place.locationName, place.locationAddress]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (venue.length) parts.push(venue.join(" — "));
  }

  if (needsJoinUrl(place.format) && place.joinUrl) {
    parts.push(place.format === "online" ? "Trực tuyến" : "và trực tuyến");
  }

  return parts.join(" · ");
}
