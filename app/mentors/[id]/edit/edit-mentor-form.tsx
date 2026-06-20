"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import { updateMentorAction, type PeopleActionState } from "@/app/actions/people";
import type { FunctionArea, Industry, MentorProfile, Person, Program } from "@/lib/types";
import { CatalogMultiSelect } from "../../_components/catalog-multi-select";

const initialState: PeopleActionState = { ok: false, message: null };

const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const sectionTitle = "mb-3 text-base font-semibold text-vam-ink";

export function EditMentorForm({
  mentor,
  person,
  programs,
  industries,
  functionAreas,
  selectedProgramIds,
  selectedIndustryIds,
  selectedFunctionAreaIds
}: {
  mentor: MentorProfile;
  person: Person;
  programs: Program[];
  industries: Industry[];
  functionAreas: FunctionArea[];
  selectedProgramIds: string[];
  selectedIndustryIds: string[];
  selectedFunctionAreaIds: string[];
}) {
  const [state, formAction] = useFormState(updateMentorAction, initialState);
  const timing = useActionTiming("people.mentor.update", state);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-6">
      <input type="hidden" name="mentor_profile_id" value={mentor.id} />

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
        <h3 className={sectionTitle}>2. Hồ sơ mentor</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mã mentor</span>
            <input name="mentor_code" defaultValue={mentor.mentor_code ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Bio URL</span>
            <input name="bio_url" type="url" defaultValue={mentor.bio_url ?? ""} className={inputClass} placeholder="https://..." />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Công ty hiện tại</span>
            <input name="company_current" defaultValue={mentor.company_current ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Chức danh hiện tại</span>
            <input name="title_current" defaultValue={mentor.title_current ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số năm kinh nghiệm (số)</span>
            <input
              name="years_experience_min"
              type="number"
              min={0}
              defaultValue={mentor.years_experience_min ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mô tả kinh nghiệm</span>
            <input name="years_experience_text" defaultValue={mentor.years_experience_text ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mùa VAM đầu tiên</span>
            <input name="first_vam_season" defaultValue={mentor.first_vam_season ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Số mùa đã tham gia</span>
            <input
              name="years_in_vam"
              type="number"
              min={0}
              defaultValue={mentor.years_in_vam ?? ""}
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4">
          <CatalogMultiSelect
            name="program_ids"
            label="Chương trình mentoring"
            options={programs}
            initialSelectedIds={selectedProgramIds}
            emptyMessage="Chưa có chương trình nào trong danh mục."
            helperText="Mentor có thể tham gia nhiều chương trình. Lựa chọn đầu tiên là giá trị chính."
          />
          <CatalogMultiSelect
            name="industry_ids"
            label="Ngành nghề"
            options={industries}
            initialSelectedIds={selectedIndustryIds}
            emptyMessage="Chưa có ngành trong danh mục."
            helperText="Lựa chọn đầu tiên ghi vào mentor_profiles.industry để tương thích dashboard cũ."
          />
          <CatalogMultiSelect
            name="function_area_ids"
            label="Chức năng chuyên môn"
            options={functionAreas}
            initialSelectedIds={selectedFunctionAreaIds}
            emptyMessage="Chưa có chức năng trong danh mục."
            helperText="Lựa chọn đầu tiên ghi vào mentor_profiles.function_area để tương thích dashboard cũ."
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <LoadingButton pendingLabel="Đang lưu..." className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          Lưu thay đổi
        </LoadingButton>
        <Link href={`/people/${person.id}`} className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Hủy
        </Link>
        <Link href="/mentors" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Quay lại danh sách mentor
        </Link>
      </div>
    </form>
  );
}
