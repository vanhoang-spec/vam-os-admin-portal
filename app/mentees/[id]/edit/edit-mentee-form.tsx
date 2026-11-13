"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import { updateMenteeAction, type PeopleActionState } from "@/app/actions/people";
import { yearOfStudyFormOptions } from "@/lib/mentee-year-of-study-core";
import type { MenteeProfile, Person } from "@/lib/types";

const initialState: PeopleActionState = { ok: false, message: null };

const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const sectionTitle = "mb-3 text-base font-semibold text-vam-ink";

export function EditMenteeForm({
  mentee,
  person
}: {
  mentee: MenteeProfile;
  person: Person;
}) {
  const [state, formAction] = useFormState(updateMenteeAction, initialState);
  const timing = useActionTiming("people.mentee.update", state);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-6">
      <input type="hidden" name="mentee_profile_id" defaultValue={mentee.id} />
      <input type="hidden" name="person_id" defaultValue={person.id} />

      <InlineActionMessage
        state={state}
        errorFallback="Không thể lưu hồ sơ. Vui lòng thử lại."
        showSavedAt={state.ok}
      />

      <section className="rounded-md border border-vam-line bg-slate-50 px-4 py-3">
        <h3 className={sectionTitle}>1. Người (person)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase text-slate-500">Họ tên (*)</span>
            <input name="full_name" required defaultValue={person.full_name ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Email</span>
            <input name="email" type="email" defaultValue={person.email_primary ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số điện thoại</span>
            <input name="phone" defaultValue={person.phone_primary ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Giới tính</span>
            <select name="gender" defaultValue={person.gender ?? ""} className={inputClass}>
              <option value="">-- Chưa rõ --</option>
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
              <option value="other">Khác</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-md border border-vam-line bg-white px-4 py-3">
        <h3 className={sectionTitle}>2. Hồ sơ mentee</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã cũ (không sửa)</span>
            <input value={mentee.mentee_code ?? ""} disabled readOnly className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã trường (school_code)</span>
            <input name="school_code" defaultValue={mentee.school_code ?? ""} className={inputClass} placeholder="vd: UEH" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase text-slate-500">Tên trường (school_raw)</span>
            <input name="school_raw" defaultValue={mentee.school_raw ?? ""} className={inputClass} placeholder="vd: Đại học Kinh tế TPHCM" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Ngành (major)</span>
            <input name="major" defaultValue={mentee.major ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Khoá (class_cohort)</span>
            <input name="class_cohort" defaultValue={mentee.class_cohort ?? ""} className={inputClass} placeholder="vd: K48" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">MSSV</span>
            <input name="mssv" defaultValue={mentee.mssv ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Năm học</span>
            {/* VAM00030: mở form phải thấy đúng giá trị đang lưu; ô trống mặc định sẽ xoá năm học khi bấm Lưu. */}
            <select name="year_of_study" defaultValue={mentee.year_of_study ?? ""} className={inputClass}>
              <option value="">-- Chưa rõ --</option>
              {yearOfStudyFormOptions(mentee.year_of_study).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-500">Sinh viên đang học năm thứ mấy, như câu &quot;Năm học hiện tại&quot; của đơn ứng tuyển.</span>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-medium uppercase text-slate-500">Career interests</span>
          <textarea name="career_interests" rows={2} defaultValue="" className={inputClass} placeholder="Liệt kê (phân tách dấu phẩy): Marketing, Product, Finance, ..." />
          <span className="mt-1 block text-[11px] text-amber-700">
            Schema chưa có cột career_interests trong mentee_profiles. Giá trị nhập được ghi vào audit log.
          </span>
        </label>
      </section>

      <div className="flex flex-wrap gap-3">
        <LoadingButton pendingLabel="Đang lưu..." className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          Lưu thay đổi
        </LoadingButton>
        <Link href={`/people/${person.id}`} className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Hủy
        </Link>
        <Link href="/mentees" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Quay lại danh sách mentee
        </Link>
      </div>
    </form>
  );
}
