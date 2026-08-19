"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import {
  draftMentorBiosAction,
  ensureDossierLinksAction,
  sendKickoffInviteAction,
  sendMenteeMentorIntroAction,
  sendMenteeSelectedAction,
  sendMentorPackageAction
} from "@/app/actions/post-match-emails";
import {
  initialPostMatchEmailActionState,
  MAX_PER_BATCH,
  type CommunicationReadiness,
  type PostMatchEmailActionState,
  type ReadinessKindState
} from "@/lib/post-match-email-action-types";
import { formatInterviewTimeVi } from "@/lib/interview-scheduling-core";

/**
 * The send centre.
 *
 * Every stage shows its own blockers rather than a disabled button with no
 * explanation, because "why can't I send" is the question this screen exists to
 * answer. Nothing here can send twice: the server skips anybody who already has
 * a sent record for that kind.
 */

type EventOption = { id: string; name: string; startsAt: string | null };

type SendAction = (
  prev: PostMatchEmailActionState,
  formData: FormData
) => Promise<PostMatchEmailActionState>;

function Feedback({ state }: { state: PostMatchEmailActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function useRefreshOnSuccess(state: PostMatchEmailActionState, refresh: () => void) {
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    refresh();
  }, [state.ok, state.message, refresh]);
}

function StageCard({
  step,
  stage,
  action,
  seasonId,
  canOperate,
  refresh,
  children,
  extraFields
}: {
  step: number;
  stage: ReadinessKindState;
  action: SendAction;
  seasonId: string;
  canOperate: boolean;
  refresh: () => void;
  children?: React.ReactNode;
  extraFields?: React.ReactNode;
}) {
  const [state, formAction] = useFormState<PostMatchEmailActionState, FormData>(
    action,
    initialPostMatchEmailActionState
  );
  useRefreshOnSuccess(state, refresh);

  const blocked = stage.blockers.length > 0;
  const done = stage.recipients > 0 && stage.pending === 0;

  return (
    <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              done ? "bg-green-100 text-green-800" : blocked ? "bg-slate-100 text-slate-500" : "bg-vam-green text-white"
            }`}
          >
            {step}
          </span>
          <div>
            <h3 className="text-base font-semibold text-vam-ink">{stage.label}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {stage.recipients} người nhận · đã gửi {stage.alreadySent} · còn {stage.pending}
              {stage.templateApproved ? " · mẫu thư đã duyệt" : " · mẫu thư chưa duyệt"}
            </p>
          </div>
        </div>
        {done ? (
          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            Đã gửi xong
          </span>
        ) : null}
      </div>

      {children}

      {blocked ? (
        <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {stage.blockers.map((blocker) => (
            <li key={blocker}>• {blocker}</li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="season_id" value={seasonId} />
        {extraFields}
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Số thư mỗi lượt
          <input
            type="number"
            name="limit"
            min={1}
            max={MAX_PER_BATCH}
            defaultValue={MAX_PER_BATCH}
            className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
          />
        </label>
        <SubmitButton
          pendingText="Đang gửi..."
          disabled={!canOperate || blocked || stage.pending === 0}
        >
          Gửi {Math.min(stage.pending, MAX_PER_BATCH)} thư
        </SubmitButton>
      </form>

      <div className="mt-2">
        <Feedback state={state} />
      </div>
    </div>
  );
}

export function CommunicationsClient({
  seasonId,
  readiness,
  events,
  canOperate,
  canDraftWithAi
}: {
  seasonId: string;
  readiness: CommunicationReadiness;
  events: EventOption[];
  canOperate: boolean;
  canDraftWithAi: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [eventId, setEventId] = useState(events[0]?.id ?? "");

  const [bioState, bioAction] = useFormState<PostMatchEmailActionState, FormData>(
    draftMentorBiosAction,
    initialPostMatchEmailActionState
  );
  const [dossierState, dossierAction] = useFormState<PostMatchEmailActionState, FormData>(
    ensureDossierLinksAction,
    initialPostMatchEmailActionState
  );
  useRefreshOnSuccess(bioState, refresh);
  useRefreshOnSuccess(dossierState, refresh);

  const stageByKind = new Map(readiness.kinds.map((stage) => [stage.kind, stage]));
  const selected = stageByKind.get("mentee_selected");
  const intro = stageByKind.get("mentee_mentor_intro");
  const mentorPackage = stageByKind.get("mentor_mentee_package");
  const kickoff = stageByKind.get("kickoff_invite");

  return (
    <div className="grid gap-4">
      {!readiness.documentsReady.mentee || !readiness.documentsReady.mentor ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tài liệu chưa phát hành đủ:{" "}
          {!readiness.documentsReady.mentee ? "bản mentee" : ""}
          {!readiness.documentsReady.mentee && !readiness.documentsReady.mentor ? " và " : ""}
          {!readiness.documentsReady.mentor ? "bản mentor" : ""}.{" "}
          <Link href="/operations/documents" className="font-medium underline">
            Mở trang tài liệu
          </Link>
          .
        </div>
      ) : null}

      {/* Stage 1 */}
      {selected ? (
        <StageCard
          step={1}
          stage={selected}
          action={sendMenteeSelectedAction}
          seasonId={seasonId}
          canOperate={canOperate}
          refresh={refresh}
        >
          <p className="mt-2 text-xs text-slate-600">
            Báo cho bạn mentee rằng đã được chọn, kèm đường dẫn quy tắc ứng xử và cẩm nang bản mentee.
            Gửi được ngay, không cần đợi ghép cặp xong.
          </p>
        </StageCard>
      ) : null}

      {/* Mentor introductions, needed by stage 2 */}
      <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h3 className="text-base font-semibold text-vam-ink">Giới thiệu ngắn về mentor</h3>
        <p className="mt-1 text-xs text-slate-600">
          Đoạn 2–3 câu mentee sẽ đọc về mentor của mình. AI soạn nháp từ chức danh, công ty, ngành và số
          năm kinh nghiệm — không gửi tên, email hay số điện thoại của ai. Sửa lại tại trang xác nhận
          mentor trước khi gửi.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Còn {readiness.mentorsMissingBio} mentor chưa có giới thiệu.
        </p>
        <form action={bioAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Số mentor mỗi lượt
            <input
              type="number"
              name="limit"
              min={1}
              max={20}
              defaultValue={10}
              className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
            />
          </label>
          <SubmitButton
            variant="outline"
            pendingText="Đang soạn..."
            disabled={!canOperate || !canDraftWithAi || readiness.mentorsMissingBio === 0}
          >
            AI soạn giới thiệu
          </SubmitButton>
          {!canDraftWithAi ? (
            <span className="text-xs text-slate-500">Chưa bật soạn thảo bằng AI.</span>
          ) : null}
        </form>
        <div className="mt-2">
          <Feedback state={bioState} />
        </div>
      </div>

      {/* Stage 2a */}
      {intro ? (
        <StageCard
          step={2}
          stage={intro}
          action={sendMenteeMentorIntroAction}
          seasonId={seasonId}
          canOperate={canOperate}
          refresh={refresh}
        >
          <p className="mt-2 text-xs text-slate-600">
            Giới thiệu mentor cho mentee và báo sắp có kick-off.{" "}
            {readiness.everybodyMatched
              ? "Đủ điều kiện: mọi mentee đã có mentor."
              : "Bị khoá cho tới khi mọi mentee đã có mentor."}
          </p>
        </StageCard>
      ) : null}

      {/* Dossier links, needed by stage 2b */}
      <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h3 className="text-base font-semibold text-vam-ink">Đường dẫn hồ sơ mentee cho mentor</h3>
        <p className="mt-1 text-xs text-slate-600">
          Mỗi cặp một đường dẫn riêng, có hạn dùng và thu hồi được, thay vì đặt hồ sơ sinh viên vào thân
          email. Hệ thống tự tạo khi gửi thư cho mentor; bấm đây nếu muốn tạo trước.
        </p>
        <form action={dossierAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Hiệu lực (ngày)
            <input
              type="number"
              name="ttl_days"
              min={1}
              max={365}
              defaultValue={120}
              className="h-9 w-24 rounded-md border border-vam-line px-2 text-sm"
            />
          </label>
          <SubmitButton variant="outline" pendingText="Đang tạo..." disabled={!canOperate}>
            Tạo đường dẫn hồ sơ
          </SubmitButton>
        </form>
        <div className="mt-2">
          <Feedback state={dossierState} />
        </div>
      </div>

      {/* Stage 2b */}
      {mentorPackage ? (
        <StageCard
          step={3}
          stage={mentorPackage}
          action={sendMentorPackageAction}
          seasonId={seasonId}
          canOperate={canOperate}
          refresh={refresh}
        >
          <p className="mt-2 text-xs text-slate-600">
            Gửi mentor danh sách mentee được ghép, đường dẫn xem hồ sơ chi tiết, quy tắc ứng xử và cẩm
            nang bản mentor.
          </p>
        </StageCard>
      ) : null}

      {/* Stage 3 */}
      {kickoff ? (
        <StageCard
          step={4}
          stage={kickoff}
          action={sendKickoffInviteAction}
          seasonId={seasonId}
          canOperate={canOperate}
          refresh={refresh}
          extraFields={
            <>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Sự kiện kick-off
                <select
                  name="event_id"
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                  className="h-9 rounded-md border border-vam-line px-2 text-sm"
                >
                  <option value="">-- Chọn sự kiện --</option>
                  {events.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                      {option.startsAt ? ` · ${formatInterviewTimeVi(option.startsAt) ?? ""}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Gửi cho
                <select
                  name="audience"
                  defaultValue="both"
                  className="h-9 rounded-md border border-vam-line px-2 text-sm"
                >
                  <option value="both">Cả mentee và mentor</option>
                  <option value="mentee">Chỉ mentee</option>
                  <option value="mentor">Chỉ mentor</option>
                </select>
              </label>
            </>
          }
        >
          <p className="mt-2 text-xs text-slate-600">
            Thư mời kèm đường dẫn đăng ký của sự kiện — dùng lại module Sự kiện, nên điểm danh bằng QR
            tại buổi kick-off vẫn hoạt động như bình thường.
          </p>
          {events.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              Mùa này chưa có sự kiện nào.{" "}
              <Link href="/events/create" className="font-medium underline">
                Tạo sự kiện kick-off
              </Link>{" "}
              rồi tạo đường dẫn đăng ký ở trang sự kiện.
            </p>
          ) : null}
        </StageCard>
      ) : null}
    </div>
  );
}
