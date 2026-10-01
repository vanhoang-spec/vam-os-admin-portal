"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInterviewRubricAction } from "@/app/actions/mentee-interview-rubric";
import {
  DESCRIPTOR_LEVELS,
  MAX_CRITERIA,
  MAX_INTERVIEW_QUESTIONS,
  cleanRubricDraft,
  rubricDraftError,
  slugifyCriterionKey,
  type RubricCriterion,
  type RubricGuidance
} from "@/lib/mentee-interview-rubric-core";

const field = "w-full rounded-md border border-slate-300 bg-white p-2 text-sm";

type Draft = RubricCriterion & { questionsText: string };

function toDraft(c: RubricCriterion): Draft {
  return { ...c, descriptors: { ...c.descriptors }, questionsText: (c.interview_questions ?? []).join("\n") };
}
function fromDraft(d: Draft): RubricCriterion {
  const { questionsText, ...rest } = d;
  return { ...rest, interview_questions: questionsText.split("\n") };
}

/**
 * Sửa phiếu chấm của MỘT mùa. Mùa chưa có phiếu riêng thì bắt đầu từ phiếu đang
 * dùng (lưu gần nhất) — lần lưu đầu tạo phiếu riêng. Kiểm ở đây chỉ để báo lỗi dễ
 * hiểu; vam106_save_interview_rubric kiểm lại toàn bộ.
 */
export function RubricEditor({ seasonId, seasonCode, expectedVersion, initialCriteria, initialGuidance }: {
  seasonId: string;
  seasonCode: string;
  expectedVersion: number;
  initialCriteria: RubricCriterion[];
  initialGuidance: RubricGuidance;
}) {
  const router = useRouter();
  const [criteria, setCriteria] = useState<Draft[]>(() =>
    initialCriteria.length ? initialCriteria.map(toDraft)
      : [{ key: "tieu_chi_1", label: "", weight: 100, descriptors: {}, questionsText: "" }]
  );
  const [guidance, setGuidance] = useState<RubricGuidance>(initialGuidance);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const total = criteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);

  const update = (index: number, patch: Partial<Draft>) =>
    setCriteria((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const move = (index: number, delta: number) =>
    setCriteria((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border border-slate-200 p-3">
        <h3 className="font-semibold">Dòng hướng dẫn trên phiếu</h3>
        <label className="text-sm">Kim chỉ nam
          <input className={field} value={guidance.motto ?? ""} onChange={(e) => setGuidance({ ...guidance, motto: e.target.value })} />
        </label>
        <label className="text-sm">Lưu ý về điểm số
          <textarea className={field} rows={2} value={guidance.note ?? ""} onChange={(e) => setGuidance({ ...guidance, note: e.target.value })} />
        </label>
        <label className="text-sm">Nhắc Mentor (cuối phiếu)
          <textarea className={field} rows={2} value={guidance.reminder ?? ""} onChange={(e) => setGuidance({ ...guidance, reminder: e.target.value })} />
        </label>
      </div>

      {criteria.map((c, index) => (
        <fieldset key={c.key} className="grid gap-2 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">Tiêu chí {index + 1} <span className="font-normal text-slate-500">· mã {c.key}</span></legend>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem]">
            <label className="text-sm">Tên tiêu chí {index + 1}
              <input className={field} value={c.label} onChange={(e) => update(index, { label: e.target.value })} />
            </label>
            <label className="text-sm">Tên tiếng Anh (không bắt buộc)
              <input className={field} value={c.label_en ?? ""} onChange={(e) => update(index, { label_en: e.target.value })} />
            </label>
            <label className="text-sm">Trọng số % tiêu chí {index + 1}
              <input className={field} type="number" min={1} max={100} step={1} value={Number.isFinite(c.weight) ? c.weight : ""}
                onChange={(e) => update(index, { weight: e.target.value === "" ? Number.NaN : Number(e.target.value) })} />
            </label>
          </div>
          <label className="text-sm">Câu hỏi cốt lõi (mentor tự trả lời khi chấm)
            <input className={field} value={c.question ?? ""} onChange={(e) => update(index, { question: e.target.value })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            {DESCRIPTOR_LEVELS.map((level) => (
              <label key={level} className="text-sm">Mô tả mức {level} điểm
                <textarea className={field} rows={3} value={c.descriptors?.[level] ?? ""}
                  onChange={(e) => update(index, { descriptors: { ...c.descriptors, [level]: e.target.value } })} />
              </label>
            ))}
          </div>
          <label className="text-sm">Câu hỏi gợi ý — mỗi dòng một câu, tối đa {MAX_INTERVIEW_QUESTIONS}
            <textarea className={field} rows={4} value={c.questionsText} onChange={(e) => update(index, { questionsText: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-1 text-sm" disabled={index === 0} onClick={() => move(index, -1)}>Lên</button>
            <button type="button" className="rounded border px-3 py-1 text-sm" disabled={index === criteria.length - 1} onClick={() => move(index, 1)}>Xuống</button>
            <button type="button" className="rounded border border-red-700 px-3 py-1 text-sm text-red-700" disabled={criteria.length === 1}
              onClick={() => { if (window.confirm(`Xoá tiêu chí "${c.label || c.key}" khỏi phiếu?`)) setCriteria((list) => list.filter((_, i) => i !== index)); }}>
              Xoá tiêu chí
            </button>
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded border px-3 py-2 text-sm" disabled={criteria.length >= MAX_CRITERIA}
          onClick={() => setCriteria((list) => [...list, { key: slugifyCriterionKey("Tiêu chí mới", list.map((c) => c.key)), label: "", weight: 0, descriptors: {}, questionsText: "" }])}>
          Thêm tiêu chí
        </button>
        <span role="status" className={total === 100 ? "text-sm text-vam-green" : "text-sm font-semibold text-red-700"}>
          Tổng trọng số: {Number.isFinite(total) ? total : "—"}%{total === 100 ? "" : " — phải đúng 100%"}
        </span>
      </div>

      {message ? <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-vam-green" : "text-red-700"}>{message.text}</p> : null}
      <button
        type="button"
        className="w-fit rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          const draft = cleanRubricDraft(criteria.map(fromDraft), guidance);
          const problem = rubricDraftError(draft.criteria, draft.guidance);
          if (problem) { setMessage({ ok: false, text: problem }); return; }
          if (!window.confirm(`Lưu phiếu chấm cho mùa ${seasonCode}? Form chấm mentor đang mở sẽ phải tải lại.`)) return;
          startTransition(async () => {
            try {
              const result = await saveInterviewRubricAction({ seasonId, expectedVersion, criteria: draft.criteria, guidance: draft.guidance });
              setMessage({ ok: result.ok, text: result.message });
              if (result.ok) router.refresh();
            } catch {
              setMessage({ ok: false, text: "Mất kết nối. Tải lại trang để kiểm tra trước khi lưu lại." });
            }
          });
        }}
      >
        {pending ? "Đang lưu…" : `Lưu phiếu chấm mùa ${seasonCode}`}
      </button>
    </div>
  );
}
