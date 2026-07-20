"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { createMentoringRecapAction, type CorrectionActionState } from "@/app/actions/activity-corrections";
import type { Match, MenteeProfile, MentorProfile, Person, Season } from "@/lib/types";

const initialState: CorrectionActionState = {
  ok: false,
  message: null
};

type PersonOption = {
  id: string;
  primary: string;
  secondary: string | null;
  hint: string | null;
  searchKey: string;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function buildMentorOptions(people: Person[], mentorProfiles: MentorProfile[]): PersonOption[] {
  const profileByPersonId = new Map<string, MentorProfile>();
  for (const profile of mentorProfiles) {
    if (profile.person_id) profileByPersonId.set(profile.person_id, profile);
  }
  const peopleByMentorPersonId = new Set(profileByPersonId.keys());
  return people
    .filter((person) => peopleByMentorPersonId.has(person.id))
    .map((person) => {
      const profile = profileByPersonId.get(person.id);
      const primary = normalize(person.full_name) || normalize(person.email_primary) || person.id;
      const secondary = normalize(person.email_primary) || null;
      const company = normalize(profile?.company_current);
      const title = normalize(profile?.title_current);
      const code = normalize(profile?.mentor_code);
      const hintParts = [code, [title, company].filter(Boolean).join(" @ ")].filter(Boolean);
      return {
        id: person.id,
        primary,
        secondary,
        hint: hintParts.join(" · ") || null,
        searchKey: [primary, secondary, code, company, title].filter(Boolean).join(" ").toLowerCase()
      };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary, "vi"));
}

function buildMenteeOptions(people: Person[], menteeProfiles: MenteeProfile[]): PersonOption[] {
  const profileByPersonId = new Map<string, MenteeProfile>();
  for (const profile of menteeProfiles) {
    if (profile.person_id) profileByPersonId.set(profile.person_id, profile);
  }
  const peopleByMenteePersonId = new Set(profileByPersonId.keys());
  return people
    .filter((person) => peopleByMenteePersonId.has(person.id))
    .map((person) => {
      const profile = profileByPersonId.get(person.id);
      const primary = normalize(person.full_name) || normalize(person.email_primary) || person.id;
      const secondary = normalize(person.email_primary) || null;
      const code = normalize(profile?.mentee_code);
      const school = normalize(profile?.school_code) || normalize(profile?.school_raw);
      const major = normalize(profile?.major);
      const hintParts = [code, [major, school].filter(Boolean).join(" · ")].filter(Boolean);
      return {
        id: person.id,
        primary,
        secondary,
        hint: hintParts.join(" · ") || null,
        searchKey: [primary, secondary, code, school, major].filter(Boolean).join(" ").toLowerCase()
      };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary, "vi"));
}

function PersonCombobox({
  label,
  placeholder,
  options,
  value,
  onChange,
  emptyMessage
}: {
  label: string;
  placeholder: string;
  options: PersonOption[];
  value: string;
  onChange: (next: string) => void;
  emptyMessage: string;
}) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);
  const [query, setQuery] = useState(selected?.primary ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected?.primary ?? "");
  }, [selected?.id, selected?.primary]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selected?.primary ?? "");
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [selected?.primary]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selected?.primary.toLowerCase()) return options.slice(0, 50);
    return options.filter((option) => option.searchKey.includes(q)).slice(0, 50);
  }, [options, query, selected?.primary]);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected && event.target.value !== selected.primary) onChange("");
          }}
          onFocus={() => setOpen(true)}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>
      {selected ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            Đã chọn: <span className="font-medium text-vam-ink">{selected.primary}</span>
            {selected.secondary ? ` <${selected.secondary}>` : ""}
            {selected.hint ? ` — ${selected.hint}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
            className="rounded border border-vam-line px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Xoá
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-vam-line bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">{emptyMessage}</div>
          ) : (
            <ul className="divide-y divide-vam-line">
              {filtered.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.id);
                      setQuery(option.primary);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-vam-mint"
                  >
                    <span className="font-medium text-vam-ink">{option.primary}</span>
                    {option.secondary ? <span className="text-xs text-slate-500">{option.secondary}</span> : null}
                    {option.hint ? <span className="text-xs text-slate-500">{option.hint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function detectActiveMatchId(matches: Match[], mentorId: string, menteeId: string): { matchId: string; isActive: boolean } | null {
  if (!mentorId || !menteeId) return null;
  const candidates = matches.filter(
    (match) => match.mentor_person_id === mentorId && match.mentee_person_id === menteeId
  );
  if (!candidates.length) return null;
  const active = candidates.find((match) => normalize(match.status).toLowerCase() === "active");
  if (active) return { matchId: active.id, isActive: true };
  return { matchId: candidates[0].id, isActive: false };
}

export function RecapCreateForm({
  seasons,
  matches,
  people,
  mentorProfiles,
  menteeProfiles
}: {
  seasons: Season[];
  matches: Match[];
  people: Person[];
  mentorProfiles: MentorProfile[];
  menteeProfiles: MenteeProfile[];
}) {
  const [state, formAction] = useFormState(createMentoringRecapAction, initialState);

  const mentorOptions = useMemo(() => buildMentorOptions(people, mentorProfiles), [people, mentorProfiles]);
  const menteeOptions = useMemo(() => buildMenteeOptions(people, menteeProfiles), [people, menteeProfiles]);
  const matchOptions = useMemo(() => matches.slice().sort((a, b) => a.id.localeCompare(b.id)), [matches]);

  const [mentorId, setMentorId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [manualMatch, setManualMatch] = useState(false);
  const [manualMatchId, setManualMatchId] = useState("");

  const detected = useMemo(() => detectActiveMatchId(matches, mentorId, menteeId), [matches, mentorId, menteeId]);
  const effectiveMatchId = manualMatch ? manualMatchId : detected?.matchId ?? "";

  return (
    <form action={formAction} className="grid gap-4">
      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Mùa (season_code) (*)</span>
          <select
            name="season_code"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            required
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.code || ""}>{s.code}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Ngày họp (meeting_date) (*)</span>
          <input
            name="meeting_date"
            type="date"
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PersonCombobox
          label="Mentor (tìm theo tên / email / công ty)"
          placeholder="Gõ tên, email hoặc tên công ty mentor..."
          options={mentorOptions}
          value={mentorId}
          onChange={setMentorId}
          emptyMessage="Không tìm thấy mentor phù hợp."
        />
        <PersonCombobox
          label="Mentee (tìm theo tên / email / trường)"
          placeholder="Gõ tên, email hoặc tên trường mentee..."
          options={menteeOptions}
          value={menteeId}
          onChange={setMenteeId}
          emptyMessage="Không tìm thấy mentee phù hợp."
        />
      </div>

      <input type="hidden" name="mentor_person_id" value={mentorId} />
      <input type="hidden" name="mentee_person_id" value={menteeId} />
      <input type="hidden" name="match_id" value={effectiveMatchId} />

      <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">match_id (tự động phát hiện)</div>
            <div className="mt-1">
              {mentorId && menteeId ? (
                detected ? (
                  <span className="font-mono text-xs text-vam-ink">
                    {detected.matchId}
                    <span className={detected.isActive ? "ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700" : "ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"}>
                      {detected.isActive ? "active" : `status: ${normalize(matches.find((m) => m.id === detected.matchId)?.status) || "unknown"}`}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">Không tìm thấy match giữa cặp này. Recap sẽ được lưu không kèm match_id (hoặc dùng chế độ Nâng cao để chọn thủ công).</span>
                )
              ) : (
                <span className="text-xs text-slate-500">Chọn cả mentor và mentee để hệ thống tự dò match_id.</span>
              )}
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={manualMatch}
              onChange={(event) => {
                setManualMatch(event.target.checked);
                if (!event.target.checked) setManualMatchId("");
              }}
              className="h-4 w-4 rounded border-vam-line"
            />
            Nâng cao: chọn match_id thủ công
          </label>
        </div>
        {manualMatch ? (
          <div className="mt-3">
            <select
              value={manualMatchId}
              onChange={(event) => setManualMatchId(event.target.value)}
              className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Không gắn match_id --</option>
              {matchOptions.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.id.slice(0, 8)} · {normalize(match.status) || "?"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">Chế độ override này không thay đổi auto-detect — chỉ áp dụng cho lần submit này.</p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Loại hình</span>
          <select
            name="meeting_type"
            defaultValue="1on1_primary"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="1on1_primary">Mentoring 1–1</option>
            <option value="1on1_cross">Cross-mentoring</option>
            <option value="group">Mentoring theo nhóm</option>
            <option value="unknown">Khác / chưa xác định</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
          <select
            name="status"
            defaultValue="submitted"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="submitted">Đã ghi nhận</option>
            <option value="needs_review">Cần kiểm tra</option>
            <option value="invalid">Không hợp lệ</option>
            <option value="duplicate">Trùng dữ liệu</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">recap_url</span>
        <input
          name="recap_url"
          type="url"
          placeholder="https://..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">recap_note / summary</span>
        <textarea
          name="recap_note"
          rows={3}
          placeholder="Tóm tắt nội dung recap..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">issue_flag</span>
        <select
          name="issue_flag"
          defaultValue="false"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">admin_notes</span>
        <textarea
          name="admin_notes"
          rows={3}
          placeholder="Ghi chú nội bộ cho admin..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={state.ok} className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50">
          Tạo recap
        </button>
        {state.ok && (
          <a href="/data-issues" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Quay lại Rà soát dữ liệu
          </a>
        )}
      </div>
    </form>
  );
}
