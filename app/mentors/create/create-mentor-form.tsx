"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useMemo, useState } from "react";
import { createMentorAction, type PeopleActionState } from "@/app/actions/people";
import type { FunctionArea, Industry, Person, Program } from "@/lib/types";
import { CatalogMultiSelect } from "../_components/catalog-multi-select";

const initialState: PeopleActionState = { ok: false, message: null };

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function CreateMentorForm({
  people,
  programs,
  industries,
  functionAreas
}: {
  people: Person[];
  programs: Program[];
  industries: Industry[];
  functionAreas: FunctionArea[];
}) {
  const [state, formAction] = useFormState(createMentorAction, initialState);

  const peopleByEmail = useMemo(() => {
    const map = new Map<string, Person>();
    for (const person of people) {
      const email = normalize(person.email_primary);
      if (email) map.set(email, person);
    }
    return map;
  }, [people]);

  const [email, setEmail] = useState("");
  const [linkPersonId, setLinkPersonId] = useState("");

  const matchedExisting = useMemo(() => {
    const key = normalize(email);
    if (!key) return null;
    return peopleByEmail.get(key) ?? null;
  }, [email, peopleByEmail]);

  const linkedPerson = useMemo(() => {
    if (!linkPersonId) return null;
    return people.find((p) => p.id === linkPersonId) ?? null;
  }, [linkPersonId, people]);

  const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
  const sectionTitle = "mb-3 text-base font-semibold text-vam-ink";

  return (
    <form action={formAction} className="grid gap-6">
      <input type="hidden" name="link_to_person_id" value={linkPersonId} />

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <section className="rounded-md border border-vam-line bg-slate-50 px-4 py-3">
        <h3 className={sectionTitle}>1. Người (person)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase text-slate-500">Họ tên (*)</span>
            <input name="full_name" required={!linkPersonId} disabled={Boolean(linkPersonId)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Email</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={Boolean(linkPersonId)}
              className={inputClass}
              placeholder="vd: mentor@example.com"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số điện thoại</span>
            <input name="phone" disabled={Boolean(linkPersonId)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Giới tính</span>
            <select name="gender" disabled={Boolean(linkPersonId)} defaultValue="" className={inputClass}>
              <option value="">-- Chưa rõ --</option>
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
              <option value="other">Khác</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase text-slate-500">Ghi chú</span>
            <textarea name="person_notes" rows={2} disabled={Boolean(linkPersonId)} className={inputClass} />
          </label>
        </div>

        {matchedExisting && !linkPersonId ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Đã có người với email này: <strong>{matchedExisting.full_name ?? matchedExisting.email_primary}</strong>.
            <button
              type="button"
              onClick={() => setLinkPersonId(matchedExisting.id)}
              className="ml-2 inline-flex rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Liên kết với người này
            </button>
          </div>
        ) : null}

        {linkedPerson ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Đang liên kết với: <strong>{linkedPerson.full_name ?? linkedPerson.email_primary ?? linkedPerson.id}</strong>.
            <button
              type="button"
              onClick={() => setLinkPersonId("")}
              className="ml-2 inline-flex rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Huỷ liên kết
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-vam-line bg-white px-4 py-3">
        <h3 className={sectionTitle}>2. Hồ sơ mentor</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã mentor</span>
            <input name="mentor_code" className={inputClass} placeholder="vd: M-S11-001" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Bio URL</span>
            <input name="bio_url" type="url" className={inputClass} placeholder="https://..." />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Công ty hiện tại</span>
            <input name="company_current" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Chức danh hiện tại</span>
            <input name="title_current" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số năm kinh nghiệm (số)</span>
            <input name="years_experience_min" type="number" min={0} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mô tả kinh nghiệm</span>
            <input name="years_experience_text" className={inputClass} placeholder="vd: 8-10 năm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mùa VAM đầu tiên</span>
            <input name="first_vam_season" className={inputClass} placeholder="vd: UEHM-S09" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số mùa đã tham gia</span>
            <input name="years_in_vam" type="number" min={0} className={inputClass} />
          </label>
        </div>

        <div className="mt-4 grid gap-4">
          <CatalogMultiSelect
            name="program_ids"
            label="Chương trình mentoring (multi-select)"
            options={programs}
            emptyMessage="Chưa có chương trình nào trong danh mục."
            helperText="Mentor có thể tham gia nhiều chương trình. Lựa chọn đầu tiên là giá trị chính."
          />
          <CatalogMultiSelect
            name="industry_ids"
            label="Ngành nghề (multi-select)"
            options={industries}
            emptyMessage="Chưa có ngành trong danh mục."
            helperText="Lựa chọn đầu tiên sẽ được ghi vào mentor_profiles.industry để tương thích với dashboard cũ."
          />
          <CatalogMultiSelect
            name="function_area_ids"
            label="Chức năng chuyên môn (multi-select)"
            options={functionAreas}
            emptyMessage="Chưa có chức năng trong danh mục."
            helperText="Lựa chọn đầu tiên sẽ được ghi vào mentor_profiles.function_area để tương thích với dashboard cũ."
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={state.ok} className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50">
          Tạo hồ sơ mentor
        </button>
        {state.ok && state.createdPersonId ? (
          <Link href={`/people/${state.createdPersonId}`} className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Mở hồ sơ vừa tạo
          </Link>
        ) : null}
        <Link href="/mentors" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Quay lại danh sách mentor
        </Link>
      </div>
    </form>
  );
}
