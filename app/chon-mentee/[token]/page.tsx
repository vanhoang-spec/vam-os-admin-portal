import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { getRound2PickPageData, type Round2PickPage } from "@/lib/matching-round2-link";
import { formatDateTime } from "@/lib/utils";
import { MenteeList } from "./mentee-list";
import { UnpickButton } from "./pick-forms";

/**
 * Trang mentor chọn mentee ở Vòng 2 — công khai, không cần đăng nhập (BTC 07/10/2026).
 *
 * Mentor vào bằng đường dẫn riêng trong thư mời. Trang hiện mentee chưa có mentor trong danh
 * sách chọn của mentor (một nhóm ngành, hoặc các nhóm BTC gộp chung — BTC 14/10/2026); chọn
 * xong là bạn ấy biến khỏi danh sách của mọi mentor khác. Ai bấm trước được — database phân
 * xử dưới khoá, trang không tự quyết.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chọn mentee · UEH Mentoring", robots: { index: false, follow: false } };

const SUPPORT = "Cần hỗ trợ, anh/chị nhắn Zalo ban tổ chức 0919144638 hoặc trả lời thư mời.";

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
              <UnpickButton token={token} matchId={p.matchId} minutesLeft={p.undoMinutesLeft} deadline={p.undoDeadline} />
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
          <p className="text-sm text-vam-ink">Vòng 2 đã đóng. Cảm ơn Anh/Chị đã tham gia. Ban tổ chức sẽ liên hệ Anh/Chị cho các bước tiếp theo.</p>
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
  // Bạn bù sang từ nhóm nhận bù (BTC 15/10/2026): thẻ không thuộc nhóm nào trong cụm của mentor.
  const fillCount = data.mentees.filter((m) => !data.poolGroups.some((g) => g.code === m.groupCode)).length;
  return (
    <>
      {picks}
      <Card>
        <p className="text-sm text-vam-ink" data-testid="list-summary">
          Anh/chị còn chọn được <strong>{data.slots}</strong> mentee (tối đa {data.limit} ở vòng này).{" "}
          {fillCount > 0 ? (
            <>
              Danh sách của anh/chị gồm <strong>{data.mentees.length}</strong> bạn: <strong>{data.mentees.length - fillCount}</strong> bạn
              thuộc <strong>{data.groupLabel}</strong> (cả nhóm chỉ còn {data.poolOpen} bạn chưa có mentor) và{" "}
              <strong>{fillCount}</strong> bạn bổ sung từ nhóm <strong>{data.fillGroups.map((g) => g.label).join(", ")}</strong> — thẻ
              ghi rõ nhóm của từng bạn. Bạn nào vừa được mentor khác chọn sẽ tự được thay bằng hồ sơ khác trong khoảng 20 giây.
            </>
          ) : data.poolOpen > data.mentees.length ? (
            <>
              Danh sách của anh/chị gồm <strong>{data.mentees.length}</strong> bạn, trong tổng số{" "}
              <strong>{data.poolOpen}</strong> bạn chưa có mentor thuộc <strong>{data.groupLabel}</strong> — mỗi mentor
              nhận một danh sách riêng, chia đều để bạn nào cũng có cơ hội như nhau. Bạn nào vừa được mentor khác chọn sẽ
              tự được thay bằng hồ sơ khác trong khoảng 20 giây.
            </>
          ) : (
            <>
              Danh sách gồm <strong>{data.mentees.length}</strong> bạn chưa có mentor thuộc <strong>{data.groupLabel}</strong>.
              Bạn nào vừa được mentor khác chọn sẽ tự ẩn khỏi danh sách trong khoảng 20 giây.
            </>
          )}
          {data.closesAt ? ` Vòng 2 đóng lúc ${formatDateTime(data.closesAt)} (giờ Việt Nam).` : ""}
        </p>
        {data.canSwap ? (
          <p className="mt-2 text-sm text-vam-ink" data-testid="swap-hint">
            Xem chi tiết hết các hồ sơ trong danh sách mà chưa thấy bạn phù hợp thì Anh/Chị đổi được sang {data.windowSize} hồ sơ khác
            (nút ở cuối danh sách).
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">
          Chọn nhầm thì bỏ chọn được trong 30 phút. Hồ sơ dưới đây chỉ dùng để chọn mentee — vui lòng không chia sẻ ra ngoài.
        </p>
      </Card>
      <MenteeList
        token={token}
        cards={data.mentees}
        groups={data.poolGroups}
        closesAt={data.closesAt}
        windowSize={data.windowSize}
        viewedIds={data.viewedIds}
        canSwap={data.canSwap}
      />
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
