import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getRound2PickPageData, type Round2PickPage } from "@/lib/matching-round2-link";
import type { MenteeCard } from "@/lib/matching-round2-link-core";
import { formatDateTime } from "@/lib/utils";
import { PickButton, UnpickButton } from "./pick-forms";

/**
 * Trang mentor chọn mentee ở Vòng 2 — công khai, không cần đăng nhập (BTC 07/10/2026).
 *
 * Mentor vào bằng đường dẫn riêng trong thư mời. Trang chỉ hiện mentee cùng nhóm ngành,
 * chưa có mentor; chọn xong là bạn ấy biến khỏi danh sách của mọi mentor khác. Ai bấm
 * trước được — database phân xử dưới khoá, trang không tự quyết.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chọn mentee · UEH Mentoring", robots: { index: false, follow: false } };

const SUPPORT = "Cần hỗ trợ, anh/chị nhắn Zalo ban tổ chức 0919144638 hoặc trả lời thư mời.";

function MenteeCardView({ card, token, canPick }: { card: MenteeCard; token: string; canPick: boolean }) {
  return (
    <Card>
      <article data-testid="mentee-card" data-application={card.applicationId} className="grid gap-3">
        <h2 className="text-lg font-semibold text-vam-ink">{card.name}</h2>
        {card.facts.length ? (
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            {card.facts.map(([label, value]) => (
              <div key={label}>
                <dt className="inline text-slate-500">{label}: </dt>
                <dd className="inline text-vam-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {card.cv ? (
          <p className="break-words text-sm">
            <span className="text-slate-500">CV / hồ sơ: </span>
            {card.cv.map((part, index) =>
              part.kind === "link" ? (
                <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all text-vam-green underline">
                  {part.value}{" "}
                </a>
              ) : (
                <span key={index}>{part.value} </span>
              )
            )}
          </p>
        ) : null}
        {card.texts.map(([label, value]) => (
          <div key={label} className="text-sm">
            <div className="font-medium text-slate-600">{label}</div>
            <p className="whitespace-pre-line text-vam-ink">{value}</p>
          </div>
        ))}
        {canPick ? <PickButton token={token} applicationId={card.applicationId} menteeName={card.name} /> : null}
      </article>
    </Card>
  );
}

function Body({ data, token }: { data: Round2PickPage; token: string }) {
  if (data.state !== "ready") {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <h2 className="text-base font-semibold text-amber-900">Không mở được trang chọn mentee</h2>
        <p className="mt-2 text-sm text-amber-900">{data.message}</p>
        <p className="mt-2 text-sm text-amber-900">{SUPPORT}</p>
      </Card>
    );
  }
  const picks = data.picks.length ? (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-vam-ink">Mentee anh/chị đã chọn ở vòng này</h2>
      <ul className="grid gap-2" data-testid="my-picks">
        {data.picks.map((p) => (
          <li key={p.matchId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-vam-ink">{p.menteeName}</span>
            {p.undoMinutesLeft > 0 ? (
              <UnpickButton token={token} matchId={p.matchId} minutesLeft={p.undoMinutesLeft} />
            ) : (
              <span className="text-xs text-slate-500">Quá 30 phút — muốn đổi, liên hệ ban tổ chức.</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  ) : null;

  if (data.blocked) {
    return (
      <>
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">{data.blocked}</p>
          <p className="mt-2 text-sm text-amber-900">{SUPPORT}</p>
        </Card>
        {picks}
      </>
    );
  }
  if (data.window === "not_open") {
    return (
      <Card>
        <p className="text-sm text-vam-ink">
          Vòng 2 chưa mở{data.opensAt ? `. Mở lúc ${formatDateTime(data.opensAt)} (giờ Việt Nam)` : ""}. Anh/chị mở lại đúng đường dẫn này khi tới giờ.
        </p>
      </Card>
    );
  }
  if (data.window === "closed") {
    return (
      <>
        <Card>
          <p className="text-sm text-vam-ink">Vòng 2 đã đóng. Cảm ơn anh/chị đã tham gia; ban tổ chức sẽ liên hệ về bước tiếp theo.</p>
        </Card>
        {picks}
      </>
    );
  }
  if (data.slots <= 0) {
    return (
      <>
        <Card>
          <p className="text-sm text-vam-ink">
            Anh/chị đã nhận đủ {data.limit} mentee của vòng này. Ban tổ chức sẽ giới thiệu hai bên với nhau.
          </p>
        </Card>
        {picks}
      </>
    );
  }
  return (
    <>
      {picks}
      <Card>
        <p className="text-sm text-vam-ink">
          Anh/chị còn chọn được <strong>{data.slots}</strong> mentee (tối đa {data.limit} ở vòng này). Danh sách gồm{" "}
          <strong>{data.mentees.length}</strong> bạn thuộc nhóm <strong>{data.groupLabel}</strong> chưa có mentor. Bạn nào vừa được
          mentor khác chọn sẽ biến khỏi danh sách khi anh/chị tải lại trang.
          {data.closesAt ? ` Vòng 2 đóng lúc ${formatDateTime(data.closesAt)} (giờ Việt Nam).` : ""}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Chọn nhầm thì bỏ chọn được trong 30 phút. Hồ sơ dưới đây chỉ dùng để chọn mentee — vui lòng không chia sẻ ra ngoài.
        </p>
      </Card>
      {data.mentees.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">Hiện chưa còn mentee nào trong nhóm của anh/chị. Ban tổ chức sẽ báo khi có thêm hồ sơ.</p>
        </Card>
      ) : (
        data.mentees.map((card) => <MenteeCardView key={card.applicationId} card={card} token={token} canPick />)
      )}
    </>
  );
}

export default async function MentorPickPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const data = await getRound2PickPageData(token);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <div className="rounded-lg bg-vam-ink px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-vam-mint">Ghép cặp Vòng 2 · UEH Mentoring Mùa 12</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {data.state === "ready" ? `Chào ${data.mentorName}` : "Chọn mentee"}
          </h1>
          {data.state === "ready" && data.groupLabel ? (
            <p className="mt-2 text-sm text-slate-200">Nhóm ngành của anh/chị: {data.groupLabel}</p>
          ) : null}
        </div>
        <Body data={data} token={token} />
      </div>
    </main>
  );
}
