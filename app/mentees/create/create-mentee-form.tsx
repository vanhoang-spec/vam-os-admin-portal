"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useMemo, useState } from "react";
import { createMenteeAction, type PeopleActionState } from "@/app/actions/people";
import type { Person } from "@/lib/types";

const initialState: PeopleActionState = { ok: false, message: null };

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function CreateMenteeForm({ people }: { people: Person[] }) {
  const [state, formAction] = useFormState(createMenteeAction, initialState);

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
              placeholder="vd: mentee@example.com"
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
        <h3 className={sectionTitle}>2. Hồ sơ mentee</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã mentee</span>
            <input name="mentee_code" className={inputClass} placeholder="vd: ME-S11-001" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã trường (school_code)</span>
            <input name="school_code" className={inputClass} placeholder="vd: UEH" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase text-slate-500">Tên trường (school_raw)</span>
            <input name="school_raw" className={inputClass} placeholder="vd: Đại học Kinh tế TPHCM" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Ngành (major)</span>
            <input name="major" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Khoá (class_cohort)</span>
            <input name="class_cohort" className={inputClass} placeholder="vd: K48" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">MSSV</span>
            <input name="mssv" className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Năm học (year of study)</span>
            <input name="year_of_study" className={inputClass} placeholder="vd: 2024-2025" />
            <span className="mt-1 block text-[11px] text-amber-700">
              Schema chưa có cột riêng cho year_of_study; nếu để trống thì class_cohort sẽ được dùng. Giá trị này được ghi vào audit.
            </span>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-medium uppercase text-slate-500">Career interests</span>
          <textarea name="career_interests" rows={2} className={inputClass} placeholder="Liệt kê (phân tách dấu phẩy): Marketing, Product, Finance, ..." />
          <span className="mt-1 block text-[11px] text-amber-700">
            Schema chưa có cột career_interests trong mentee_profiles. Giá trị nhập được ghi vào audit log, chưa lưu vào hồ sơ chính.
          </span>
        </label>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={state.ok} className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50">
          Tạo hồ sơ mentee
        </button>
        {state.ok && state.createdPersonId ? (
          <Link href={`/people/${state.createdPersonId}`} className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Mở hồ sơ vừa tạo
          </Link>
        ) : null}
        <Link href="/mentees" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Quay lại danh sách mentee
        </Link>
      </div>
    </form>
  );
}
