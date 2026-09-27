"use client";
import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {type MentorResultsData,RESULT_SCORE_FIELDS,decisionText} from "@/lib/mentor-interview-results-core";
import {applicationStatusLabel} from "@/lib/ui-labels";
import {recommendationLabel,reviewStatusLabel} from "@/lib/screening-decision";
import {formatDateTime} from "@/lib/utils";
export function MentorResultsClient({data}:{data:MentorResultsData}) {
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("");
  const router=useRouter();
  const q=search.trim().toLocaleLowerCase("vi");
  const rows=data.rows.filter(r=>(!status||r.application.status===status)&&(!q||[r.application.full_name,r.application.email_primary,r.application.phone_primary,r.reviewer?.full_name].some(v=>v?.toLocaleLowerCase("vi").includes(q))));
  const total=new Set(data.rows.map(r=>r.application_id)).size;
  return <div className="grid gap-4">
    <p>{data.isReviewer?"Các phiếu phỏng vấn bạn đã lưu":"Tất cả phiếu phỏng vấn mentor đã lưu trong mùa 12"}: <strong>{total} mentor · {data.rows.length} phiếu</strong>. Bao gồm phiếu đang lưu nháp; không gồm phân công chưa bắt đầu hoặc đã hủy.</p>
    <div className="flex flex-wrap gap-3">
      <label>Tìm mentor hoặc interviewer<input className="block rounded border p-2" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên, email, SĐT"/></label>
      <label>Trạng thái hồ sơ<select className="block rounded border p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tất cả trạng thái</option>{Array.from(new Set(data.rows.map(r=>r.application.status))).map(s=><option key={s} value={s}>{applicationStatusLabel(s)}</option>)}</select></label>
      <button className="self-end rounded border px-3 py-2" onClick={()=>router.refresh()}>Làm mới kết quả</button>
    </div>
    <p className="text-sm text-slate-500">Đang hiển thị {rows.length} phiếu. Đề xuất của interviewer và quyết định BTC được ghi riêng để tránh nhầm khi soạn thư.</p>
    {!rows.length&&<p className="rounded border p-5">Chưa có phiếu phù hợp. Nếu mới lưu, bấm Làm mới kết quả.</p>}
    {rows.map(r=><article key={r.id} className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">{r.application.full_name||"Mentor"}</h2><p>{r.application.email_primary} · {r.application.phone_primary}</p><p className="font-medium">{applicationStatusLabel(r.application.status)}</p></div>
        <Link className="self-start rounded border px-3 py-2 text-vam-green" href={data.isReviewer?`/reviews/${r.id}`:`/applications/${r.application_id}`}>Xem application</Link>
      </div>
      <p className="mt-3">Interviewer: <strong>{r.reviewer?.full_name||r.reviewer?.email||"Chưa xác định"}</strong> · {reviewStatusLabel(r.status)} · {r.submitted_at?`Nộp: ${formatDateTime(r.submitted_at)}`:`Lưu: ${r.updated_at?formatDateTime(r.updated_at):"—"}`}</p>
      <details open className="mt-3 rounded border p-3"><summary className="cursor-pointer font-semibold">Kết quả và ghi chú phỏng vấn</summary>
        <p className="mt-2">{RESULT_SCORE_FIELDS.map(([key,label])=>`${label}: ${r[key]??"—"}`).join(" · ")}</p>
        <p><strong>Tổng: {r.total_score??"—"}/25</strong> · Đề xuất: {recommendationLabel(r.recommendation)}</p>
        <h3 className="mt-2 font-semibold">Nhận xét của interviewer</h3><p className="whitespace-pre-wrap break-words">{r.reviewer_note||"Chưa có nhận xét."}</p>
      </details>
      {!data.isReviewer&&<details className="mt-3 rounded border p-3"><summary className="cursor-pointer font-semibold">Quyết định và ghi chú BTC</summary><p className="mt-2 whitespace-pre-wrap break-words">{decisionText(data,r.application_id)||"Chưa có quyết định được ghi nhận."}</p></details>}
      {!data.isReviewer&&<div className="mt-3 flex flex-wrap gap-4 text-sm text-vam-green"><Link href={`/applications/${r.application_id}/export/pdf`}>Tải application PDF</Link><Link href={`/applications/${r.application_id}/export/csv`}>Tải application CSV</Link></div>}
    </article>)}
    {data.canExport&&<section className="mt-4 rounded-lg border bg-vam-mint/30 p-4">
      <h2 className="font-semibold">Xuất toàn bộ kết quả phỏng vấn mentor mùa 12</h2>
      <p className="my-2 text-sm">Xuất tất cả {total} mentor / {data.rows.length} phiếu đã lưu, gồm điểm, nhận xét đầy đủ và ghi chú quyết định BTC. Bộ lọc tìm kiếm phía trên không thu hẹp file xuất. Một mentor có nhiều interviewer sẽ có nhiều phiếu.</p>
      <div className="flex flex-wrap gap-3"><a className="rounded bg-vam-green px-4 py-2 text-white" href="/api/exports/mentor-interviews?format=pdf">Xuất PDF toàn bộ S12</a><a className="rounded border border-vam-green px-4 py-2 text-vam-green" href="/api/exports/mentor-interviews?format=xlsx">Xuất Excel toàn bộ S12</a></div>
    </section>}
  </div>;
}
