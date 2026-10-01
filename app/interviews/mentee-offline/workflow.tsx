"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { saveOfflineInterviewAction, lookupOfflineTicketAction } from "@/app/actions/mentee-offline";
import { normalizedPhone, OFFLINE_OUTCOMES, OFFLINE_SCORES, type OfflineDashboard, type OfflineCandidate, type OfflineOutcome, type OfflineActionResult } from "@/lib/mentee-offline-core";
import { formatDateTime, formatTime, vietnamDateKey } from "@/lib/utils";
import { recommendationLabel } from "@/lib/screening-decision";
import { InterviewQrCamera } from "./qr-camera";

const field="w-full rounded-md border border-slate-300 bg-white p-2";
const button="rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50";

/**
 * Thứ Bảy 03/10 chỉ có 3 phòng (6 bàn/phòng); Chủ nhật 04/10 đủ 6 phòng (5
 * bàn/phòng) — chốt 29/09/2026. Danh sách dropdown chỉ là tiện dụng; cận thật
 * được database cưỡng chế lại trong trigger vam104_room_desk_bounds_guard,
 * vì ô chọn đã lọc trên màn hình không phải một phép kiểm.
 */
const ROOM_DESK_BY_DAY: Record<string, { rooms: number[]; desks: number[] }> = {
  "2026-10-03": { rooms: [1, 2, 3], desks: [1, 2, 3, 4, 5, 6] },
  "2026-10-04": { rooms: [1, 2, 3, 4, 5, 6], desks: [1, 2, 3, 4, 5] }
};
const DEFAULT_ROOM_DESK = { rooms: [1, 2, 3, 4, 5, 6], desks: [1, 2, 3, 4, 5, 6] };
function roomDeskOptions(sessionStartsAtIso: string | undefined) {
  const dayKey = sessionStartsAtIso ? vietnamDateKey(sessionStartsAtIso) : null;
  return (dayKey && ROOM_DESK_BY_DAY[dayKey]) || DEFAULT_ROOM_DESK;
}

export function OfflineDashboardClient({ data, initialApplication }: { data: OfflineDashboard; initialApplication?:string }) {
  const router=useRouter();
  const [session,setSession]=useState("");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<string | null>(initialApplication??null);
  const [message,setMessage]=useState("");
  const [mine,setMine]=useState(false);
  const chooseCode=useCallback(async (code:string)=>{
    try {
      const result=await lookupOfflineTicketAction(code);
      if (!result.ok || !result.applicationId) {setMessage(result.message);return;}
      setSelected(result.applicationId);setSession("");setQuery("");
      const found=data.candidates.find(c=>c.id===result.applicationId);
      if (!found) {setMessage(result.message);return;}
      if (found.status==="withdrawn") {setMessage(`Đã tìm thấy vé — hồ sơ ${found.name} đã rút, không check-in được.`);return;}
      if (found.operation?.checked_in_at) {setMessage(`Đã tìm thấy vé — ${found.name} đã check-in trước đó lúc ${formatDateTime(found.operation.checked_in_at)}.`);return;}
      try {
        const checkin=await saveOfflineInterviewAction({applicationId:found.id,action:"checkin",revision:found.operation?.revision??0,values:{}});
        setMessage(checkin.ok ? `Đã tự động check-in ${found.name}.` : checkin.message);
        if (checkin.ok) router.refresh();
      } catch {setMessage(`Đã tìm thấy vé ${found.name} nhưng check-in tự động thất bại — bấm "Xác nhận check-in" thủ công bên dưới.`);}
    } catch {setMessage("Không tra được vé, kiểm tra kết nối rồi thử lại.");}
  },[data.candidates,router]);
  const visible=data.candidates.filter(c=>(!session || c.sessionId===session) && (!mine || c.operation?.interviewer_id===data.actorId) &&
    (!query || c.name.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")) ||
      (normalizedPhone(query).length>=3 && normalizedPhone(c.phone??"").includes(normalizedPhone(query)))));
  const candidate=data.candidates.find(c=>c.id===selected);
  const currentMentor=data.participants.find(p=>p.id===data.actorId);
  const count=(predicate:(c:OfflineCandidate)=>boolean)=>visible.filter(predicate).length;
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
      <button className="rounded border px-3 py-2" onClick={()=>router.refresh()}>Làm mới danh sách</button>
      <span>{data.candidates.length} đã đặt · {count(c=>!!c.operation?.checked_in_at)} đã đến trong bộ lọc · {count(c=>!!c.operation?.outcome)} đã có kết quả</span>
      {currentMentor?.capacity!=null && <strong>Chỗ mentee của tôi: {currentMentor.activeMatches}/{currentMentor.capacity}</strong>}
    </div>
    {data.canOperate && <InterviewQrCamera onCode={chooseCode} />}
    {message && <p role="status" className="rounded border bg-amber-50 p-3">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Ca phỏng vấn<select className={field} value={session} onChange={e=>setSession(e.target.value)}>
        <option value="">Tất cả ca</option>{data.sessions.map(s=><option key={s.id} value={s.id}>{formatDateTime(s.starts_at)} – {formatTime(s.ends_at)} ({data.candidates.filter(c=>c.sessionId===s.id).length}/{s.seat_limit??"—"})</option>)}
      </select></label>
      <label>Tìm tên hoặc số điện thoại<input className={field} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nhập tên hoặc SĐT" /></label>
    </div>
    <label className="flex items-center gap-2"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)} />Chỉ ứng viên được phân cho tôi</label>
    <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm">
      <thead><tr className="bg-slate-100"><th className="p-3">Mentee / SĐT</th><th>Ca</th><th>Check-in / Bàn</th><th>Người phỏng vấn</th><th>Kết quả</th></tr></thead>
      <tbody>{visible.map(c=><tr key={c.id} className="border-t align-top">
        <td className="p-3"><button onClick={()=>setSelected(c.id)} className="text-left font-semibold text-vam-green underline">{c.name}</button><div>{c.phone}</div></td>
        <td className="p-3">{formatDateTime(data.sessions.find(s=>s.id===c.sessionId)?.starts_at??"")}</td>
        <td className="p-3">{c.operation?.checked_in_at ? "Đã đến" : "Chưa đến"}{c.operation?.room && <div>Phòng {c.operation.room} · Bàn {c.operation.desk}</div>}</td>
        <td className="p-3">{data.participants.find(p=>p.id===c.operation?.interviewer_id)?.full_name??"Chưa phân"}</td>
        <td className="p-3">{c.operation?.outcome ? OFFLINE_OUTCOMES[c.operation.outcome] : "Chưa chấm"}{c.operation?.match_id && <div className="text-vam-green">Đã ghép mentor</div>}</td>
      </tr>)}</tbody>
    </table>{!visible.length && <p className="p-4">Không có ứng viên phù hợp.</p>}</div>
    {candidate && <CandidatePanel key={`${candidate.id}:${candidate.operation?.revision??0}`} candidate={candidate} data={data} close={()=>setSelected(null)} />}
    <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-semibold">Lịch sử thao tác — 200 lần gần nhất</summary>
      <div className="mt-3 grid gap-3">{data.logs.map(log=><details key={log.id} className="border-t pt-2">
        <summary>{formatDateTime(log.created_at)} · {log.actor_name} · {log.candidate_name} · {({checkin:"Check-in",assign:"Phân bàn",result:"Lưu/sửa kết quả"} as Record<string,string>)[log.action]??log.action}</summary>
        <p>Lý do: {log.reason??"—"}</p><AuditChange before={log.before_data} after={log.after_data} />
      </details>)}</div>
    </details>
  </div>;
}

function AuditChange({before,after}:{before:unknown;after:unknown}) {
  const old=before as {operation?: {outcome?:OfflineOutcome;room?:number;desk?:number;match_id?:string};review?:{total_score?:number;reviewer_note?:string}} | null;
  const next=after as {operation?: {outcome?:OfflineOutcome;room?:number;desk?:number;match_id?:string};values?:{scores?:number[];note?:string}} | null;
  return <dl className="grid gap-1 text-sm text-slate-600">
    <div>Kết quả: {old?.operation?.outcome ? OFFLINE_OUTCOMES[old.operation.outcome] : "Chưa có"} → {next?.operation?.outcome ? OFFLINE_OUTCOMES[next.operation.outcome] : "Chưa có"}</div>
    <div>Điểm: {old?.review?.total_score??"—"} → {next?.values?.scores?.reduce((sum,n)=>sum+n,0)??"—"}</div>
    <div>Nhận xét trước: {old?.review?.reviewer_note??"—"}</div><div>Nhận xét sau: {next?.values?.note??"—"}</div>
    <div>Phòng/bàn: {old?.operation?.room??"—"}/{old?.operation?.desk??"—"} → {next?.operation?.room??"—"}/{next?.operation?.desk??"—"}</div>
    <div>Ghép cặp: {old?.operation?.match_id ? "Có" : "Không"} → {next?.operation?.match_id ? "Có" : "Không"}</div>
  </dl>;
}

function CandidatePanel({candidate:c,data,close}:{candidate:OfflineCandidate;data:OfflineDashboard;close:()=>void}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [state,setState]=useState<OfflineActionResult | null>(null);
  const op=c.operation;
  const session=data.sessions.find(s=>s.id===c.sessionId);
  const own=op?.interviewer_id===data.actorId;
  const [editing,setEditing]=useState(!op?.outcome);
  const review=c.reviews.find(r=>r.id===op?.review_id);
  const [outcome,setOutcome]=useState<OfflineOutcome>(op?.outcome??"passed");
  const [take,setTake]=useState(!!op?.match_id);
  const me=data.participants.find(p=>p.id===data.actorId);
  const full=me?.capacity==null || (me.activeMatches>=me.capacity && !op?.match_id);
  async function save(action:string,values:Record<string,unknown>) {
    if(busy) return;
    setBusy(true);
    try {
      const result=await saveOfflineInterviewAction({applicationId:c.id,action,revision:op?.revision??0,values});
      setState(result);
      if(result.ok) router.refresh();
    } catch {setState({ok:false,message:"Mất kết nối. Tải lại để kiểm tra kết quả trước khi thử lại."});}
    finally {setBusy(false);}
  }
  return <section className="grid gap-4 rounded-lg border-2 border-vam-green bg-white p-4" aria-label={`Hồ sơ ${c.name}`}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{c.name}</h2><p>{c.phone} · {c.email}</p><p>{formatDateTime(session?.starts_at??"")} – {formatTime(session?.ends_at??"")} · {session?.venue??"Chưa điền địa điểm"}</p></div><button onClick={close} className="rounded border px-3 py-2">Đóng hồ sơ</button></div>
    {state && <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-vam-green" : "text-red-700"}>{state.message}</p>}
    {data.canOperate && <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
      {!op?.checked_in_at ? <button disabled={busy || c.status==="withdrawn"} className={button} onClick={()=>{
        if(window.confirm(`Check-in ${c.name}, ca ${formatDateTime(session?.starts_at??"")}?`)) void save("checkin",{});
      }}>Xác nhận check-in</button> : <p>Đã check-in lúc {formatDateTime(op.checked_in_at)}</p>}
      {op?.checked_in_at && !op.outcome && <form className="grid gap-3 sm:grid-cols-3" onSubmit={e=>{
        e.preventDefault();const f=new FormData(e.currentTarget);void save("assign",{room:Number(f.get("room")),desk:Number(f.get("desk")),interviewerId:String(f.get("interviewer")),reason:String(f.get("reason")??"")});
      }}>
        <label>Phòng<select name="room" required defaultValue={op.room??""} className={field}><option value="">Chọn phòng</option>{roomDeskOptions(session?.starts_at).rooms.map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Bàn<select name="desk" required defaultValue={op.desk??""} className={field}><option value="">Chọn bàn</option>{roomDeskOptions(session?.starts_at).desks.map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Người phỏng vấn<select required name="interviewer" defaultValue={op.interviewer_id??""} className={field}><option value="">Chọn người có mặt</option>{data.participants.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <label className="sm:col-span-2">Lý do đổi phân công<input name="reason" className={field} placeholder="Bắt buộc khi đổi người phỏng vấn" /></label>
        <button className={button} disabled={busy}>Lưu phân bàn</button>
      </form>}
    </div>}
    <details open className="rounded border p-3"><summary className="cursor-pointer font-semibold">Application đã nộp</summary><dl className="mt-3 grid gap-4">{c.answers.map(([key,value],i)=><div key={`${key}-${i}`}><dt className="font-semibold text-slate-600">{key}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></details>
    <details open className="rounded border p-3"><summary className="cursor-pointer font-semibold">Điểm và nhận xét vòng hồ sơ</summary>{c.reviews.filter(r=>r.review_round==="profile_screening").map(r=><div key={r.id} className="mt-3 border-t pt-3">
      <p className="font-semibold">{r.reviewerName} · {r.total_score??"—"}/25 · {recommendationLabel(r.recommendation)}</p>
      <p className="text-sm">{OFFLINE_SCORES.map(([key,label])=>`${label}: ${r[key]??"—"}`).join(" · ")}</p><p className="whitespace-pre-wrap">{r.reviewer_note??"Chưa có nhận xét"}</p>
    </div>)}</details>
    {op?.outcome && <div className="rounded bg-vam-mint/40 p-3"><strong>{OFFLINE_OUTCOMES[op.outcome]}</strong><p>Điểm phỏng vấn: {review?.total_score??"—"}/25</p><p className="whitespace-pre-wrap">{review?.reviewer_note}</p>{op.outcome_reason && <p className="whitespace-pre-wrap">Lý do: {op.outcome_reason}</p>}{own && !editing && <button className="mt-2 rounded border px-3 py-2" onClick={()=>setEditing(true)}>Sửa kết quả / lựa chọn mentee</button>}</div>}
    {own && editing && <form className="grid gap-3 rounded-lg border p-3" onSubmit={e=>{
      e.preventDefault(); const f=new FormData(e.currentTarget);
      if(!window.confirm(`Xác nhận ${OFFLINE_OUTCOMES[outcome]} cho ${c.name}${take ? " và nhận làm mentee của bạn" : ""}?${op?.match_id && !take ? " Cặp hiện tại sẽ được hủy và hoàn lại chỗ." : ""}`)) return;
      void save("result",{outcome,takeMentee:take,scores:OFFLINE_SCORES.map(([key])=>Number(f.get(key))),note:String(f.get("note")??""),reason:String(f.get("reason")??"")});
    }}>
      <h3 className="font-semibold">Chấm phỏng vấn · 5 tiêu chí / 25 điểm</h3>
      <div className="grid gap-3 sm:grid-cols-2">{OFFLINE_SCORES.map(([key,label])=><label key={key}>{label}<select required name={key} defaultValue={review?.[key]??""} className={field}><option value="">Chọn điểm</option>{[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>)}</div>
      <label>Nhận xét<textarea name="note" rows={4} defaultValue={review?.reviewer_note??""} className={field} /></label>
      <label>Kết quả<select className={field} value={outcome} onChange={e=>{setOutcome(e.target.value as OfflineOutcome);if(e.target.value!=="passed")setTake(false);}}>{Object.entries(OFFLINE_OUTCOMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={take} disabled={outcome!=="passed" || full} onChange={e=>setTake(e.target.checked)} /><span>Nhận làm mentee của tôi — {me?.full_name??"tài khoản hiện tại"}{me?.capacity!=null ? ` (${me.activeMatches}/${me.capacity})` : " (chưa có hồ sơ mentor hợp lệ)"}</span></label>
      {full && !op?.match_id && <p className="text-sm text-slate-600">Chưa thể nhận thêm mentee. Vẫn có thể chốt đạt để BTC ghép sau.</p>}
      <label>Lý do {op?.outcome ? "sửa kết quả" : "không chọn / cần xem thêm"}<textarea name="reason" required={!!op?.outcome || outcome!=="passed"} rows={2} className={field} /></label>
      <p className="text-sm text-slate-600">Lưu sẽ chốt kết quả ngay. Mọi lần sửa đều có lịch sử cho BTC; chưa gửi email kết quả.</p>
      <button className={button} disabled={busy}>{busy ? "Đang lưu…" : "Xác nhận kết quả"}</button>
    </form>}
  </section>;
}
