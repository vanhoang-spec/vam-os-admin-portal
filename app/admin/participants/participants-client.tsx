"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  inviteParticipantsAction,
  setAccountStatusAction,
  setCurrentSeasonAction,
  setProgramMembershipAction
} from "@/app/actions/participants";
import {
  initialParticipantActionState,
  type ParticipantActionState
} from "@/lib/participant-action-types";
import type { ParticipantRow } from "@/lib/participant-admin";
import type { ProgramWithSeason } from "@/lib/current-season";

/**
 * Two jobs on one screen, kept visually apart.
 *
 * The seasons table is short and always shown; it is the thing that changes a
 * few times a year and affects everybody. The people half stays empty until
 * somebody searches, because eleven hundred rows of names and email addresses
 * is not a page, it is a disclosure.
 */

function Feedback({ state }: { state: ParticipantActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>
      {state.message}
    </p>
  );
}

const selectClass =
  "h-10 rounded-md border border-vam-line bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vam-green";

export function ParticipantsClient({
  programs,
  seasonsByProgram,
  query,
  results,
  searched
}: {
  programs: ProgramWithSeason[];
  seasonsByProgram: Record<string, Array<{ id: string; code: string; name: string }>>;
  query: string;
  results: ParticipantRow[];
  searched: boolean;
}) {
  const router = useRouter();

  const [seasonState, seasonAction] = useFormState(
    setCurrentSeasonAction,
    initialParticipantActionState
  );
  const [membershipState, membershipAction] = useFormState(
    setProgramMembershipAction,
    initialParticipantActionState
  );
  const [accountState, accountAction] = useFormState(
    setAccountStatusAction,
    initialParticipantActionState
  );
  const [inviteState, inviteAction] = useFormState(
    inviteParticipantsAction,
    initialParticipantActionState
  );

  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (personId: string) =>
    setSelected((current) =>
      current.includes(personId)
        ? current.filter((value) => value !== personId)
        : [...current, personId]
    );

  return (
    <div className="grid gap-6">
      {/* ── Seasons ────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Mùa đang chạy của từng chương trình</h2>
        <p className="mt-1 text-sm text-slate-600">
          Người tham gia vào chương trình nào sẽ thấy mùa đặt ở đây. Đổi mùa là đổi ngay, không cần
          deploy lại.
        </p>

        <div className="mt-4 grid gap-3">
          {programs.map((program) => (
            <form
              key={program.id}
              action={seasonAction}
              className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-vam-line p-3"
            >
              <input type="hidden" name="program_id" value={program.id} />

              <div className="min-w-0">
                <div className="text-sm font-medium text-vam-ink">
                  {program.name}
                  {!program.isActive ? (
                    <span className="ml-2 text-xs text-slate-500">(đang tắt)</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {program.currentSeason
                    ? `${program.currentSeason.name || program.currentSeason.code}${
                        program.currentSeason.explicit ? "" : " — suy ra tự động"
                      }`
                    : "chưa có mùa nào"}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <select
                  name="season_id"
                  defaultValue={program.currentSeason?.explicit ? program.currentSeason.id : ""}
                  className={selectClass}
                  aria-label={`Mùa hiện tại của ${program.name}`}
                >
                  <option value="">— để hệ thống tự chọn —</option>
                  {(seasonsByProgram[program.id] ?? []).map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name || season.code}
                    </option>
                  ))}
                </select>
                <SubmitButton variant="outline" pendingText="Đang lưu...">
                  Lưu
                </SubmitButton>
              </div>
            </form>
          ))}
        </div>

        <div className="mt-3">
          <Feedback state={seasonState} />
        </div>
      </Card>

      {/* ── People ─────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Tìm người</h2>
        <p className="mt-1 text-sm text-slate-600">
          Gõ tên hoặc email. Danh sách không hiện sẵn — hơn một nghìn người, và mỗi dòng có địa chỉ
          email.
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`/admin/participants?q=${encodeURIComponent(search.trim())}`);
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nguyễn Văn A hoặc a@gmail.com"
            className="h-10 min-w-[18rem] flex-1 rounded-md border border-vam-line px-3 text-sm"
            aria-label="Tìm người"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Tìm
          </button>
        </form>

        {searched && results.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Không tìm thấy ai khớp với “{query}”.</p>
        ) : null}

        {results.length > 0 ? (
          <div className="mt-5 grid gap-4">
            {results.map((person) => (
              <PersonCard
                key={person.personId}
                person={person}
                programs={programs}
                membershipAction={membershipAction}
                accountAction={accountAction}
                selected={selected.includes(person.personId)}
                onToggle={() => toggle(person.personId)}
              />
            ))}

            <form action={inviteAction} className="flex flex-wrap items-center gap-3">
              {selected.map((personId) => (
                <input key={personId} type="hidden" name="person_ids" value={personId} />
              ))}
              <SubmitButton disabled={selected.length === 0} pendingText="Đang gửi thư mời...">
                Gửi thư mời cho {selected.length} người
              </SubmitButton>
              <span className="text-xs text-slate-500">
                Ai đã có tài khoản sẽ được bỏ qua, không gửi trùng.
              </span>
            </form>

            <div className="grid gap-1">
              <Feedback state={membershipState} />
              <Feedback state={accountState} />
              <Feedback state={inviteState} />
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function PersonCard({
  person,
  programs,
  membershipAction,
  accountAction,
  selected,
  onToggle
}: {
  person: ParticipantRow;
  programs: ProgramWithSeason[];
  membershipAction: (formData: FormData) => void;
  accountAction: (formData: FormData) => void;
  selected: boolean;
  onToggle: () => void;
}) {
  const active = person.memberships.filter((row) => row.status === "active");

  return (
    <div className="rounded-md border border-vam-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium text-vam-ink">
              {person.fullName ?? "(chưa có tên)"}
            </span>
            <span className="block text-xs text-slate-500">{person.email ?? "chưa có email"}</span>
          </span>
        </label>

        <div className="text-xs">
          {person.accountStatus === "active" ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">
              Đã có tài khoản
            </span>
          ) : person.accountStatus === "disabled" ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
              Tài khoản đang khoá
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              Chưa có tài khoản
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        {active.length ? (
          <>Đang thuộc: {active.map((row) => `${row.programName} (${row.role})`).join(", ")}</>
        ) : (
          <>Chưa thuộc chương trình nào</>
        )}
      </div>

      <form action={membershipAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="person_id" value={person.personId} />

        <select name="program_id" className={selectClass} aria-label="Chương trình" defaultValue="">
          <option value="">— chọn chương trình —</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>

        <select name="role" className={selectClass} aria-label="Vai trò" defaultValue="mentor">
          <option value="mentor">mentor</option>
          <option value="mentee">mentee</option>
        </select>

        <select name="status" className={selectClass} aria-label="Trạng thái" defaultValue="active">
          <option value="active">Cho vào</option>
          <option value="inactive">Tắt</option>
        </select>

        <SubmitButton variant="outline" pendingText="Đang lưu...">
          Áp dụng
        </SubmitButton>
      </form>

      {person.accountId ? (
        <form action={accountAction} className="mt-2">
          <input type="hidden" name="account_id" value={person.accountId} />
          <input
            type="hidden"
            name="status"
            value={person.accountStatus === "active" ? "disabled" : "active"}
          />
          <SubmitButton variant="secondary" pendingText="Đang lưu...">
            {person.accountStatus === "active" ? "Khoá tài khoản" : "Mở lại tài khoản"}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
