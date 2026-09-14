"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  initialScanActionState,
  type ScanActionState
} from "@/lib/event-scan-action-types";
import { recordEventScanAction } from "@/app/actions/event-scan";

/** Bao lâu thì cho phép quét lại CÙNG một mã, tính bằng mili giây. */
const SAME_CODE_COOLDOWN_MS = 3000;

/** Một lần quét, đúng những gì máy quét cần: khoá gửi lên và chữ hiện ra. */
export type ScannerStep = { station: string; label: string };

function rememberKey(eventId: string) {
  return `vam-os:scan-step:${eventId}`;
}

/**
 * Máy quét của event supporter.
 *
 * ---------------------------------------------------------------------------
 * LUỒNG THẬT TẠI SỰ KIỆN
 * ---------------------------------------------------------------------------
 * Người tham dự mở email hoặc ảnh đã lưu, giơ mã QR trên màn hình điện thoại.
 * Supporter chĩa camera vào, nghe một tiếng bíp, liếc màn hình thấy tên, cho qua.
 * Cả thao tác dưới hai giây và không ai gõ gì.
 *
 * Vì thế màn hình này ưu tiên đúng ba thứ: khung hình lớn, kết quả to và rõ
 * màu, và không có bước xác nhận nào chen vào giữa.
 *
 * ---------------------------------------------------------------------------
 * LẦN QUÉT
 * ---------------------------------------------------------------------------
 * Danh sách lần quét là của RIÊNG sự kiện này. Người sửa được sự kiện và support
 * team được ghép vào buổi đặt nó — support team ở khung "Thiết lập các lần quét"
 * cuối trang này. Máy quét chỉ đọc danh sách đó; chọn lần quét ở đây không đổi
 * danh sách.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ CẢ HAI ĐƯỜNG GIẢI MÃ
 * ---------------------------------------------------------------------------
 * `BarcodeDetector` là API sẵn trong trình duyệt, nhanh hơn và không tốn pin —
 * nhưng Safari trên iPhone chưa có nó, mà một nửa số điện thoại ở cửa là
 * iPhone. `jsQR` chạy mọi nơi và là đường lùi.
 *
 * ---------------------------------------------------------------------------
 * VÀ VÌ SAO CÓ Ô GÕ TAY
 * ---------------------------------------------------------------------------
 * Màn hình vỡ, độ sáng thấp, camera hỏng, người tham dự chỉ có mã in trên
 * giấy. Mã được thiết kế để gõ được: mười ký tự, không có `0`/`O`/`1`/`I`/`L`.
 * Một máy quét không có đường lùi là một máy quét sẽ chặn cửa vào.
 */
export function EventScanner({
  eventId,
  steps,
  settingsHref = null
}: {
  eventId: string;
  steps: ScannerStep[];
  /** Đường tới khung thiết lập các lần quét — chỉ truyền cho người được thiết lập. */
  settingsHref?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [station, setStation] = useState(steps[0]?.station ?? "");
  const [state, setState] = useState<ScanActionState>(initialScanActionState);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");

  const stepsKey = steps.map((step) => step.station).join("|");

  // Nhớ lần quét đã chọn của sự kiện này, trên chính máy này.
  //
  // Tải lại trang giữa buổi — mạng chập, lỡ tay vuốt — mà lần quét quay về Quét
  // lần 1 thì người đứng ở quầy Check out quét cả hàng người thành Check in, và máy
  // vẫn kêu bíp bình thường. Lần quét đã nhớ không còn trong thiết lập thì về lần
  // quét đầu tiên.
  useEffect(() => {
    const stations = stepsKey ? stepsKey.split("|") : [];
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(rememberKey(eventId));
    } catch {
      remembered = null;
    }
    setStation((current) => {
      if (remembered && stations.includes(remembered)) return remembered;
      return stations.includes(current) ? current : stations[0] ?? "";
    });
  }, [eventId, stepsKey]);

  const chooseStation = useCallback(
    (value: string) => {
      setStation(value);
      try {
        window.localStorage.setItem(rememberKey(eventId), value);
      } catch {
        // Trình duyệt chặn bộ nhớ (chế độ riêng tư): vẫn quét được, chỉ không nhớ.
      }
    },
    [eventId]
  );

  // Camera đọc được cùng một mã hàng chục lần mỗi giây khi nó nằm yên trong
  // khung. Không chặn lại thì mỗi lần giơ vé là hàng chục lượt gọi máy chủ.
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busyRef = useRef(false);
  const stationRef = useRef(station);
  useEffect(() => {
    stationRef.current = station;
    // Đổi lần quét thì cùng một mã quét ngay được ở lần quét mới.
    lastRef.current = { code: "", at: 0 };
  }, [station]);

  const submit = useCallback(
    async (scanned: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (scanned === lastRef.current.code && now - lastRef.current.at < SAME_CODE_COOLDOWN_MS) {
        return;
      }
      lastRef.current = { code: scanned, at: now };

      busyRef.current = true;
      setBusy(true);
      try {
        const formData = new FormData();
        formData.set("event_id", eventId);
        formData.set("scanned", scanned);
        formData.set("station", stationRef.current);
        setState(await recordEventScanAction(initialScanActionState, formData));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [eventId]
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const start = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // `environment` = camera sau. Camera trước quét vé của người đối diện
        // thì phải giơ điện thoại ngược, và không ai làm thế được cả buổi.
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setCameraError(
        "Không mở được camera. Kiểm quyền camera của trình duyệt, hoặc gõ mã bằng tay ở dưới."
      );
    }
  }, []);

  // Dừng camera khi rời trang: một stream còn sống là một đèn camera còn sáng
  // và một viên pin đang cạn.
  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;

    // `any` vì BarcodeDetector chưa có trong lib DOM của TypeScript.
    const Detector = (globalThis as { BarcodeDetector?: new (init: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    } }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            try {
              if (detector) {
                const found = await detector.detect(canvas);
                if (found[0]?.rawValue) await submit(found[0].rawValue);
              } else {
                const image = context.getImageData(0, 0, width, height);
                const found = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
                if (found?.data) await submit(found.data);
              }
            } catch {
              // Một khung hình không giải mã được là chuyện bình thường; khung
              // tiếp theo tới sau vài chục mili giây.
            }
          }
        }
      }

      if (!stopped) requestAnimationFrame(() => void tick());
    }

    void tick();
    return () => {
      stopped = true;
    };
  }, [scanning, submit]);

  const tone =
    state.tone === "success"
      ? "border-vam-green bg-vam-mint text-vam-ink"
      : state.tone === "warning"
        ? "border-amber-500 bg-amber-50 text-amber-900"
        : state.tone === "repeat"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-red-300 bg-red-50 text-red-800";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
          {steps.length > 1 ? (
            <label className="block min-w-0 max-w-full">
              <span className="text-xs font-medium uppercase text-slate-500">Lần quét</span>
              <select
                value={station}
                onChange={(event) => chooseStation(event.target.value)}
                className="mt-1 block max-w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm"
              >
                {steps.map((step) => (
                  <option key={step.station} value={step.station}>
                    {step.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="min-w-0 max-w-full">
              <span className="text-xs font-medium uppercase text-slate-500">Lần quét</span>
              <p className="mt-1 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-vam-ink">
                {steps[0]?.label ?? "—"}
              </p>
            </div>
          )}

          {scanning ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-semibold text-vam-ink hover:bg-slate-50"
            >
              Tắt camera
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
            >
              Bật camera quét
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {steps.length > 1
            ? "Chọn đúng lần quét của điểm bạn đứng trước khi quét người đầu tiên."
            : "Sự kiện này chỉ có một lần quét."}{" "}
          {/* Thẻ <a> thường, không phải Link: link trỏ tới khung trên CÙNG trang, và
              khung đó tự mở khi nghe `hashchange`. Link của Next đổi địa chỉ bằng
              pushState, không phát `hashchange`, nên bấm vào chỉ nhảy tới một khung
              vẫn đang gập. */}
          {settingsHref ? (
            <a href={settingsHref} className="font-medium text-vam-green hover:underline">
              Thiết lập các lần quét
            </a>
          ) : null}
        </p>
      </div>

      {cameraError ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {cameraError}
        </p>
      ) : null}

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover sm:aspect-video"
        />
        <canvas ref={canvasRef} className="hidden" />
        {!scanning ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-300">
            Bật camera rồi chĩa vào mã QR trên điện thoại người tham dự.
          </p>
        ) : null}
      </div>

      {state.message ? (
        <div role="status" aria-live="polite" className={`rounded-lg border-2 px-4 py-4 ${tone}`}>
          {state.fullName ? (
            <p className="text-xl font-semibold">{state.fullName}</p>
          ) : null}
          <p className="mt-1 text-sm">{state.message}</p>
          {state.badges.length ? (
            <p className="mt-2 flex flex-wrap gap-1">
              {state.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-current/30 px-2 py-0.5 text-[11px]"
                >
                  {badge}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const code = manual.trim();
          if (!code) return;
          // Xoá dấu vết lần quét trước để cùng một mã gõ lại vẫn được nhận:
          // người gõ tay đang cố tình làm lại, khác với camera đọc lặp.
          lastRef.current = { code: "", at: 0 };
          void submit(code);
          setManual("");
        }}
        className="flex flex-wrap items-end gap-2 border-t border-vam-line pt-4"
      >
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Hoặc gõ mã trên vé</span>
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value.toUpperCase())}
            placeholder="VD: A7K2 hoặc A7K2M9PQRS"
            autoComplete="off"
            autoCapitalize="characters"
            className="mt-1 w-48 rounded-md border border-vam-line bg-white px-3 py-2 font-mono text-sm tracking-widest"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Mã 4 ký tự trong email của người tham dự, hoặc mã 10 ký tự đầy đủ.
          </span>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-semibold text-vam-ink hover:bg-slate-50 disabled:opacity-60"
        >
          Điểm danh
        </button>
      </form>
    </div>
  );
}
