"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveOfflineInterviewAction, lookupOfflineTicketAction, cancelMenteeBookingAction, moveMenteeBookingAction, loadOfflineCandidateDetailAction, decideNeedsReviewAction } from "@/app/actions/mentee-offline";
import { btcCanDecide, detailCacheKey, isBtcDecision, normalizedPhone, BTC_DECISIONS, openAtDeskAndMentor, roomDeskBounds, roomDeskLabel, roomLabel, sortCandidatesByArrival, takesElsewhere, OFFLINE_GUIDE_PATH, OFFLINE_OUTCOMES, PROFILE_SCREENING_SCORES, type OfflineDashboard, type OfflineCandidate, type OfflineCandidateDetail, type OfflineOperation, type OfflineOutcome, type OfflineActionResult } from "@/lib/mentee-offline-core";
import { formatDateTime, formatTime } from "@/lib/utils";
import { recommendationLabel } from "@/lib/screening-decision";
import { InterviewQrCamera } from "./qr-camera";
import { InterviewResultForm, InterviewResultSummary } from "./rubric-form";
import { draftKey } from "@/lib/interview-draft-core";
import { MoveBookingForm } from "./move-booking-form";
import { MAX_TAKES_PER_INTERVIEWER } from "@/lib/mentee-interview-rubric-core";
import { matchesTableQuery } from "@/lib/table-search-core";

const field="w-full rounded-md border border-slate-300 bg-white p-2";
const button="rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50";

/**
 * Ô chọn phòng/bàn theo CHÍNH CA (roomDeskBounds): danh sách phòng trong địa điểm và
 * 10 bàn mỗi phòng. Chỉ là tiện dụng — cận thật do trigger vam104_room_desk_bounds_guard
 * cưỡng chế lại, vì ô chọn đã lọc trên màn hình không phải một phép kiểm.
 */
function roomDeskOptions(session: { venue: string | null; seat_limit: number | null } | undefined) {
  const { rooms, desks } = roomDeskBounds(session?.venue);
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  return { rooms: range(rooms), desks: range(desks) };
}

export function OfflineDashboardClient({ data, initialApplication }: { data: OfflineDashboard; initialApplication?:string }) {
  const router=useRouter();
  const [session,setSession]=useState("");
  const [query,setQuery]=useState("");
  const [selected,setSelectedState]=useState<string | null>(initialApplication??null);
  // Hồ sơ đang mở nằm trên đường dẫn (?application=): điện thoại chuyển app rồi tải
  // lại trang thì mở lại ĐÚNG hồ sơ đó — cùng bản nháp phiếu đang chấm (BTC 03/10).
  const setSelected=useCallback((id:string|null)=>{
    setSelectedState(id);
    try {
      const url=new URL(window.location.href);
      if(id) url.searchParams.set("application",id); else url.searchParams.delete("application");
      window.history.replaceState(window.history.state,"",url.toString());
    } catch {/* không đổi được đường dẫn thì thôi — chọn hồ sơ vẫn chạy */}
  },[]);
  const [message,setMessage]=useState("");
  const [mine,setMine]=useState(false);
  // Chỉ các hồ sơ người phỏng vấn để lại "Cần BTC xem xét thêm" — hàng chờ của Core team (12/10/2026).
  const [needsReviewOnly,setNeedsReviewOnly]=useState(false);
  const needsReviewCount=data.candidates.filter(c=>c.operation?.outcome==="needs_review").length;
  // Hồ sơ chi tiết đã tải (đơn đăng ký + phiếu chấm), theo detailCacheKey. Nằm ở đây
  // chứ không trong CandidatePanel: panel dựng lại sau mỗi lần lưu, còn màn hình thì
  // sống suốt buổi — mở lại một bạn đã xem không phải tải lần nữa.
  const detailCache=useRef(new Map<string,OfflineCandidateDetail>());
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
  },[data.candidates,router,setSelected]);
  // Ca sớm trước; trong ca, ai check-in trước đứng trước (BTC 04/10/2026).
  const visible=sortCandidatesByArrival(data.candidates.filter(c=>(!session || c.sessionId===session) && (!mine || c.operation?.interviewer_id===data.actorId) && (!needsReviewOnly || c.operation?.outcome==="needs_review") &&
    matchesTableQuery([c.name, c.phone, normalizedPhone(c.phone??"")], query)),data.sessions);
  const candidate=data.candidates.find(c=>c.id===selected);
  const currentMentor=data.participants.find(p=>p.id===data.actorId);
  const count=(predicate:(c:OfflineCandidate)=>boolean)=>visible.filter(predicate).length;
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
      <button className="rounded border px-3 py-2" onClick={()=>router.refresh()}>Làm mới danh sách</button>
      <span>{data.candidates.length} đã đặt · {count(c=>!!c.operation?.checked_in_at)} đã đến trong bộ lọc · {count(c=>!!c.operation?.outcome)} đã có kết quả</span>
      {currentMentor?.capacity!=null && <strong>Chỗ mentee của tôi: {currentMentor.activeMatches}/{currentMentor.capacity}</strong>}
      <Link href={OFFLINE_GUIDE_PATH} className="rounded border border-vam-green px-3 py-2 text-vam-green">Hướng dẫn phỏng vấn mùa này</Link>
      <span className="text-sm text-slate-600">{data.rubric
        ? `Phiếu chấm: ${data.rubric.seasonCode} · phiên bản ${data.rubric.version}${data.rubric.own ? "" : " (đang dùng phiếu gần nhất)"}`
        : "Mùa này chưa có phiếu chấm — nhờ BTC cài phiếu"}</span>
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
    {(data.canOperate || data.canDecide) && <label className="flex items-center gap-2"><input type="checkbox" checked={needsReviewOnly} onChange={e=>setNeedsReviewOnly(e.target.checked)} />Chỉ hồ sơ cần BTC xem xét thêm ({needsReviewCount})</label>}
    <div className="vam-table-frame rounded-lg border bg-white"><table className="w-full text-left text-sm">
      <thead><tr className="bg-slate-100"><th className="p-3">Mentee / SĐT</th><th>Ca</th><th>Check-in / Bàn</th><th>Người phỏng vấn</th><th>Kết quả</th></tr></thead>
      <tbody>{visible.map(c=><tr key={c.id} className="border-t align-top">
        <td className="p-3"><button onClick={()=>setSelected(c.id)} className="text-left font-semibold text-vam-green underline">{c.name}</button><div>{c.phone}</div></td>
        <td className="p-3">{formatDateTime(data.sessions.find(s=>s.id===c.sessionId)?.starts_at??"")}</td>
        <td className="p-3">{c.operation?.checked_in_at ? `Đã đến ${formatTime(c.operation.checked_in_at)}` : "Chưa đến"}
          {c.operation?.checked_in_at && c.operation.checked_in_by_name ? <div className="text-xs text-slate-500">Check-in: {c.operation.checked_in_by_name}</div> : null}
          {c.operation?.room ? <div className="font-semibold">{roomDeskLabel(c.operation.room,c.operation.desk,data.sessions.find(s=>s.id===c.sessionId)?.venue)}</div> : null}</td>
        <td className="p-3">{data.participants.find(p=>p.id===c.operation?.interviewer_id)?.full_name??"Chưa phân"}</td>
        <td className="p-3">{c.operation?.outcome ? OFFLINE_OUTCOMES[c.operation.outcome] : "Chưa chấm"}{c.operation?.match_id && <div className="text-vam-green">Đã ghép mentor</div>}</td>
      </tr>)}</tbody>
    </table>{!visible.length && <p className="p-4">Không có ứng viên phù hợp.</p>}</div>
    {candidate && <CandidatePanel key={`${candidate.id}:${candidate.operation?.revision??0}`} candidate={candidate} data={data} detailCache={detailCache.current} close={()=>setSelected(null)} />}
    <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-semibold">Lịch sử thao tác — 200 lần gần nhất</summary>
      <div className="mt-3 grid gap-3">{data.logs.map(log=><details key={log.id} className="border-t pt-2">
        <summary>{formatDateTime(log.created_at)} · {log.actor_name} · {log.candidate_name} · {({checkin:"Check-in",assign:"Phân bàn",result:"Lưu/sửa kết quả",btc_decision:"BTC chốt kết quả"} as Record<string,string>)[log.action]??log.action}</summary>
        <p>Lý do: {log.reason??"—"}</p><AuditChange before={log.before_data} after={log.after_data} venue={data.sessions.find(s=>s.id===data.candidates.find(c=>c.id===log.application_id)?.sessionId)?.venue} />
      </details>)}</div>
    </details>
  </div>;
}

type LoggedScore = {key?:string;label?:string;score?:number};
/** Điểm trong log: phiếu theo mùa ghi ảnh chụp/criteria; log cũ ghi mảng 5 điểm. */
function loggedScores(review?:{interview_scores?:LoggedScore[];total_score?:number}|null, values?:{criteria?:Record<string,{score?:number}>;scores?:number[]}|null) {
  if (review?.interview_scores?.length) return review.interview_scores.map(s=>`${s.label??s.key}: ${s.score??"—"}`).join(" · ");
  if (values?.criteria) return Object.entries(values.criteria).map(([key,v])=>`${key}: ${v?.score??"—"}`).join(" · ");
  if (values?.scores) return String(values.scores.reduce((sum,n)=>sum+n,0));
  return review?.total_score!=null ? String(review.total_score) : "—";
}
function AuditChange({before,after,venue}:{before:unknown;after:unknown;venue?:string|null}) {
  const old=before as {operation?: {outcome?:OfflineOutcome;room?:number;desk?:number;match_id?:string};review?:{total_score?:number;reviewer_note?:string;interview_scores?:LoggedScore[]}} | null;
  const next=after as {operation?: {outcome?:OfflineOutcome;room?:number;desk?:number;match_id?:string};values?:{scores?:number[];criteria?:Record<string,{score?:number}>;note?:string;rationale?:string}} | null;
  return <dl className="grid gap-1 text-sm text-slate-600">
    <div>Kết quả: {old?.operation?.outcome ? OFFLINE_OUTCOMES[old.operation.outcome] : "Chưa có"} → {next?.operation?.outcome ? OFFLINE_OUTCOMES[next.operation.outcome] : "Chưa có"}</div>
    <div>Điểm: {loggedScores(old?.review,null)} → {loggedScores(null,next?.values)}</div>
    <div>Nhận xét trước: {old?.review?.reviewer_note??"—"}</div><div>Nhận xét sau: {next?.values?.rationale??next?.values?.note??"—"}</div>
    <div>Phòng/bàn: {roomLabel(old?.operation?.room,venue)}/{old?.operation?.desk??"—"} → {roomLabel(next?.operation?.room,venue)}/{next?.operation?.desk??"—"}</div>
    <div>Ghép cặp: {old?.operation?.match_id ? "Có" : "Không"} → {next?.operation?.match_id ? "Có" : "Không"}</div>
  </dl>;
}

/**
 * Ô của Core team: chốt kết quả cho hồ sơ người phỏng vấn để lại "Cần BTC xem xét thêm"
 * (12/10/2026). Hai bước ngay tại chỗ — chọn + lý do, rồi xác nhận — vì đây là quyết định
 * biến một bạn thành mentee của mùa hoặc loại bạn đó; lỗi hiện cạnh nút, không ở đầu hồ sơ.
 * Quyền và mọi luật do vam119_btc_decide_needs_review kiểm lại; ô này chỉ là lời mời.
 */
function BtcDecisionBox({name,operation:op,busy,onDecide}:{name:string;operation:OfflineOperation;busy:boolean;onDecide:(outcome:string,reason:string)=>Promise<OfflineActionResult>}) {
  const [choice,setChoice]=useState("");
  const [reason,setReason]=useState("");
  const [confirming,setConfirming]=useState(false);
  const [error,setError]=useState("");
  const decided=Boolean(op.btc_decided_at);
  function ask() {
    if(!isBtcDecision(choice)) {setError("Chọn kết quả: Đạt hoặc Không chọn.");return;}
    if(!reason.trim()) {setError("Nhập lý do của quyết định — bắt buộc.");return;}
    setError("");setConfirming(true);
  }
  async function confirm() {
    const result=await onDecide(choice,reason.trim());
    if(!result.ok) {setError(result.message);setConfirming(false);}
  }
  return <div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="btc-decision">
    <h3 className="font-semibold text-amber-900">BTC chốt kết quả</h3>
    <p className="text-sm text-amber-900">{decided
      ? "BTC đã chốt hồ sơ này. Nếu bấm nhầm, chọn kết quả còn lại và ghi lý do để đổi."
      : "Người phỏng vấn để lại “Cần BTC xem xét thêm”. Đọc đơn đăng ký, điểm vòng hồ sơ và phiếu phỏng vấn ở trên rồi chốt."}</p>
    <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Kết quả BTC chốt</legend>
      {(Object.keys(BTC_DECISIONS) as Array<keyof typeof BTC_DECISIONS>).map(key=><label key={key} className="flex items-center gap-2">
        <input type="radio" name="btc-decision" value={key} checked={choice===key} disabled={busy || op.outcome===key}
          onChange={()=>{setChoice(key);setConfirming(false);setError("");}} />{BTC_DECISIONS[key]}{op.outcome===key ? " (đang là kết quả này)" : ""}</label>)}
    </fieldset>
    <label className="grid gap-1 text-sm">Lý do của quyết định (bắt buộc)
      <textarea rows={3} value={reason} disabled={busy} className={field} onChange={e=>{setReason(e.target.value);setConfirming(false);}} /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!confirming
      ? <div><button type="button" className={button} disabled={busy} onClick={ask}>Chốt kết quả</button></div>
      : <div role="group" aria-label="Xác nhận chốt kết quả" className="grid gap-2 rounded border border-amber-400 bg-white p-3">
          <p>Xác nhận chốt <strong>{isBtcDecision(choice) ? BTC_DECISIONS[choice] : ""}</strong> cho <strong>{name}</strong>? {choice==="passed"
            ? "Bạn này thành mentee của mùa và vào danh sách chờ mentor chọn ở Vòng 2."
            : "Hồ sơ chuyển sang không được chọn làm mentee."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy} onClick={()=>void confirm()}>Xác nhận chốt</button>
            <button type="button" className="rounded border px-4 py-2" disabled={busy} onClick={()=>setConfirming(false)}>Quay lại</button>
          </div>
        </div>}
  </div>;
}

/** Chỗ của đơn đăng ký khi hồ sơ chi tiết chưa về: đang tải, hoặc lỗi kèm nút thử lại. */
function DetailPending({error,retry}:{error:string;retry:()=>void}) {
  return error
    ? <div role="alert" data-testid="detail-error" className="mt-3 grid gap-2 text-red-700"><p>{error}</p><div><button type="button" className="rounded border border-red-700 px-3 py-2" onClick={retry}>Tải lại hồ sơ</button></div></div>
    : <p role="status" data-testid="detail-loading" className="mt-3 text-sm text-slate-600">Đang tải hồ sơ…</p>;
}

function CandidatePanel({candidate:c,data,detailCache,close}:{candidate:OfflineCandidate;data:OfflineDashboard;detailCache:Map<string,OfflineCandidateDetail>;close:()=>void}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [state,setState]=useState<OfflineActionResult | null>(null);
  const op=c.operation;
  const session=data.sessions.find(s=>s.id===c.sessionId);
  const own=op?.interviewer_id===data.actorId;
  const [editing,setEditing]=useState(!op?.outcome);
  // Bàn / mentor đang chọn trong form phân bàn — chỉ để nhắc ai đang ở đó chưa có kết quả.
  const [pick,setPick]=useState<{room:number|null;desk:number|null;interviewerId:string|null}>({room:op?.room??null,desk:op?.desk??null,interviewerId:op?.interviewer_id??null});
  const busyHere=openAtDeskAndMentor(data,c.id,pick);
  // Hồ sơ chi tiết — đơn đăng ký + phiếu chấm đầy đủ (11/10/2026). Danh sách không còn
  // chở theo cho mọi người: tải riêng cho bạn đang mở. Phần check-in / phân bàn phía
  // trên và form chấm của bạn CHƯA có kết quả không chờ lần tải này — mạng chập chờn
  // thì Support và mentor vẫn làm việc được.
  const cacheKey=detailCacheKey(c);
  const inline=c.answers!==undefined;
  const [fetched,setFetched]=useState<OfflineCandidateDetail|null>(()=>detailCache.get(cacheKey)??null);
  const [detailError,setDetailError]=useState("");
  const [detailAttempt,setDetailAttempt]=useState(0);
  useEffect(()=>{
    if(inline || detailCache.has(cacheKey)) return;
    setDetailError("");
    // Panel này gắn với đúng một bạn ở đúng một phiên bản (key của nó), nên câu trả lời
    // về muộn không thể hiện nhầm dưới tên bạn khác; về sau khi panel đã đóng thì chỉ
    // còn việc nhớ lại — lần mở sau không phải tải nữa.
    loadOfflineCandidateDetailAction(c.id).then(result=>{
      if(result.ok) {detailCache.set(cacheKey,result.detail);setFetched(result.detail);}
      else setDetailError(result.message);
    }).catch(()=>setDetailError("Mất kết nối khi tải hồ sơ. Kiểm tra mạng rồi bấm “Tải lại hồ sơ”."));
  },[inline,detailCache,cacheKey,c.id,detailAttempt]);
  const detail:OfflineCandidateDetail|null=c.answers!==undefined ? {answers:c.answers,reviews:c.reviews} : fetched;
  const review=(detail?.reviews??c.reviews).find(r=>r.id===op?.review_id);
  const me=data.participants.find(p=>p.id===data.actorId);
  const full=me?.capacity==null || (me.activeMatches>=me.capacity && !op?.match_id);
  // Database kiểm lại cùng con số (TAKE_LIMIT_REACHED); ở đây chỉ để khoá nút trước khi bấm.
  const takeLimitReached=takesElsewhere(data.candidates,c.id,data.actorId)>=MAX_TAKES_PER_INTERVIEWER;
  // Trả kết quả cho form chấm: ok → xoá bản nháp; lỗi → hiện NGAY cạnh nút gửi (đầu
  // hồ sơ cách nút gửi cả màn hình — sự cố 03/10: mentor không thấy lỗi, tải lại, mất phiếu).
  async function save(action:string,values:Record<string,unknown>):Promise<OfflineActionResult> {
    if(busy) return {ok:false,message:"Đang lưu, chờ một chút."};
    setBusy(true);
    try {
      const result=await saveOfflineInterviewAction({applicationId:c.id,action,revision:op?.revision??0,values});
      setState(result);
      if(result.ok) router.refresh();
      return result;
    } catch {
      const failed={ok:false,message:"Mất kết nối. Phiếu vẫn còn trong bản nháp — kiểm tra mạng rồi bấm gửi lại."};
      setState(failed);return failed;
    }
    finally {setBusy(false);}
  }
  async function moveBooking(sessionId:string,reason:string) {
    if(busy) return;
    setBusy(true);
    try {
      const result=await moveMenteeBookingAction({applicationId:c.id,sessionId,reason});
      setState(result);
      if(result.ok) router.refresh();
    } catch {setState({ok:false,message:"Mất kết nối. Tải lại để kiểm tra trước khi thử lại."});}
    finally {setBusy(false);}
  }
  // Trả kết quả về cho ô chốt để lỗi hiện ngay cạnh nút; thành công thì trang làm mới và panel dựng lại.
  async function decide(outcome:string,reason:string):Promise<OfflineActionResult> {
    if(busy) return {ok:false,message:"Đang lưu, chờ một chút."};
    setBusy(true);
    try {
      const result=await decideNeedsReviewAction({applicationId:c.id,revision:op?.revision??0,outcome,reason});
      if(result.ok) {setState(result);router.refresh();}
      return result;
    } catch {
      return {ok:false,message:"Mất kết nối. Tải lại để kiểm tra trước khi chốt lại."};
    }
    finally {setBusy(false);}
  }
  async function cancelBooking(reason:string) {
    if(busy) return;
    setBusy(true);
    try {
      const result=await cancelMenteeBookingAction({applicationId:c.id,reason});
      setState(result);
      if(result.ok) router.refresh();
    } catch {setState({ok:false,message:"Mất kết nối. Tải lại để kiểm tra trước khi thử lại."});}
    finally {setBusy(false);}
  }
  return <section className="grid gap-4 rounded-lg border-2 border-vam-green bg-white p-4" aria-label={`Hồ sơ ${c.name}`}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{c.name}{op?.is_online && <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-sm font-semibold text-sky-800">Phỏng vấn ONLINE</span>}</h2><p>{c.phone} · {c.email}</p><p>{formatDateTime(session?.starts_at??"")} – {formatTime(session?.ends_at??"")} · {session?.venue??"Chưa điền địa điểm"}</p>{op?.room ? <p className="text-lg font-semibold text-vam-green" data-testid="assigned-room">{roomDeskLabel(op.room,op.desk,session?.venue)}</p> : null}{op?.is_online && op.online_note && <p className="text-sm text-sky-800">Ghi chú online: {op.online_note}</p>}</div><button onClick={close} className="rounded border px-3 py-2">Đóng hồ sơ</button></div>
    {state && <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-vam-green" : "text-red-700"}>{state.message}</p>}
    {data.canOperate && <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
      {!op?.checked_in_at ? <button disabled={busy || c.status==="withdrawn"} className={button} onClick={()=>{
        if(window.confirm(`Check-in ${c.name}, ca ${formatDateTime(session?.starts_at??"")}?`)) void save("checkin",{});
      }}>Xác nhận check-in</button> : <p>Đã check-in lúc {formatDateTime(op.checked_in_at)}{op.checked_in_by_name ? ` · bởi ${op.checked_in_by_name}` : ""}</p>}
      {!op?.checked_in_at && c.status!=="withdrawn" ? <button disabled={busy} className="rounded border border-red-700 px-4 py-2 text-red-700 disabled:opacity-50" onClick={()=>{
        const reason=window.prompt(`Nhập lý do huỷ lịch đăng ký của ${c.name}:`);
        if(reason===null) return;
        if(!reason.trim()) {setState({ok:false,message:"Cần nhập lý do huỷ."});return;}
        void cancelBooking(reason);
      }}>Huỷ lịch đăng ký</button> : !op?.checked_in_at ? null : <p className="text-sm text-slate-600">Đã check-in — không huỷ lịch đăng ký được nữa.</p>}
      {!op?.checked_in_at && c.status!=="withdrawn" && <MoveBookingForm sessions={data.moveTargets ?? data.sessions} currentSessionId={c.sessionId}
        takenBySession={data.candidates.reduce((m,x)=>x.sessionId ? m.set(x.sessionId,(m.get(x.sessionId)??0)+1) : m,new Map<string,number>())}
        candidateName={c.name} busy={busy} nowIso={new Date().toISOString()} onMove={(sessionId,reason)=>void moveBooking(sessionId,reason)} />}
      {op?.checked_in_at && !op.outcome && <form className="grid gap-3 sm:grid-cols-3" onSubmit={e=>{
        e.preventDefault();const f=new FormData(e.currentTarget);void save("assign",{room:Number(f.get("room")),desk:Number(f.get("desk")),interviewerId:String(f.get("interviewer")),reason:String(f.get("reason")??""),isOnline:f.get("isOnline")==="on",onlineNote:String(f.get("onlineNote")??"")});
      }}>
        <label>Phòng<select name="room" required defaultValue={op.room??""} className={field} onChange={e=>{const v=Number(e.target.value)||null;setPick(p=>({...p,room:v}));}}><option value="">Chọn phòng</option>{roomDeskOptions(session).rooms.map(n=><option key={n} value={n}>{roomLabel(n,session?.venue)}</option>)}</select></label>
        <label>Bàn<select name="desk" required defaultValue={op.desk??""} className={field} onChange={e=>{const v=Number(e.target.value)||null;setPick(p=>({...p,desk:v}));}}><option value="">Chọn bàn</option>{roomDeskOptions(session).desks.map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Người phỏng vấn<select required name="interviewer" defaultValue={op.interviewer_id??""} className={field} onChange={e=>{const v=e.target.value||null;setPick(p=>({...p,interviewerId:v}));}}><option value="">Chọn người có mặt</option>{data.participants.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        {(busyHere.atDesk.length>0 || busyHere.withMentor.length>0) && <div role="note" data-testid="assign-busy-note" className="grid gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 sm:col-span-3">
          {busyHere.atDesk.length>0 && <p>Bàn này đang có {busyHere.atDesk.length} bạn chưa có kết quả: {busyHere.atDesk.join(", ")}.</p>}
          {busyHere.withMentor.length>0 && <p>Mentor này đang có {busyHere.withMentor.length} bạn chưa có kết quả: {busyHere.withMentor.join(", ")}.</p>}
          <p>Vẫn lưu được — mentor thường nhận bạn kế tiếp rồi mới viết xong phiếu bạn trước. Chỉ kiểm lại cho chắc không xếp nhầm.</p>
        </div>}
        <label className="sm:col-span-2">Lý do đổi phân công<input name="reason" className={field} placeholder="Bắt buộc khi đổi người phỏng vấn" /></label>
        <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" name="isOnline" defaultChecked={op.is_online} />Phỏng vấn ONLINE — chỉ BTC đánh dấu, ứng viên không thấy ô này</label>
        <label className="sm:col-span-3">Ghi chú online (link gặp, ghi chú riêng của BTC)<input name="onlineNote" defaultValue={op.online_note??""} className={field} /></label>
        <button className={button} disabled={busy}>Lưu phân bàn</button>
      </form>}
    </div>}
    <details open className="rounded border p-3"><summary className="cursor-pointer font-semibold">Application đã nộp</summary>{detail
      ? <dl className="mt-3 grid gap-4">{detail.answers.map(([key,value],i)=><div key={`${key}-${i}`}><dt className="font-semibold text-slate-600">{key}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
      : <DetailPending error={detailError} retry={()=>setDetailAttempt(n=>n+1)} />}</details>
    <details open className="rounded border p-3"><summary className="cursor-pointer font-semibold">Điểm và nhận xét vòng hồ sơ</summary>{detail ? detail.reviews.filter(r=>r.review_round==="profile_screening").map(r=><div key={r.id} className="mt-3 border-t pt-3">
      <p className="font-semibold">{r.reviewerName} · {r.total_score??"—"}/25 · {recommendationLabel(r.recommendation)}</p>
      <p className="text-sm">{PROFILE_SCREENING_SCORES.map(([key,label])=>`${label}: ${r[key]??"—"}`).join(" · ")}</p><p className="whitespace-pre-wrap">{r.reviewer_note??"Chưa có nhận xét"}</p>
    </div>) : <p className="mt-3 text-sm text-slate-600">{detailError ? "Chưa tải được — bấm “Tải lại hồ sơ” ở mục trên." : "Đang tải…"}</p>}</details>
    {/* Đã có kết quả: phiếu đã lưu nằm trong hồ sơ chi tiết. Chưa về thì chỉ nói kết quả,
        và CHƯA cho sửa — form sửa dựng trên một phiếu trống sẽ ghi đè phiếu thật bằng ô trống. */}
    {op?.outcome && <div className="rounded bg-vam-mint/40 p-3">
      {detail
        ? <InterviewResultSummary review={review} operation={op} showWeighted={data.canOperate} />
        : <p data-testid="result-pending">Kết quả: <strong>{OFFLINE_OUTCOMES[op.outcome]}</strong> · {detailError ? "chưa tải được phiếu đã lưu — bấm “Tải lại hồ sơ” ở trên." : "đang tải phiếu đã lưu…"}</p>}
      {op.btc_decided_at && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm" data-testid="btc-decided">
        BTC đã chốt: <strong>{OFFLINE_OUTCOMES[op.outcome]}</strong> · {op.btc_decided_by_name ?? "BTC"} · {formatDateTime(op.btc_decided_at)}.
        {" "}Người phỏng vấn để lại “{OFFLINE_OUTCOMES.needs_review}”. Lý do của BTC: <span className="whitespace-pre-wrap">{op.outcome_reason ?? "—"}</span></p>}
      {/* BTC đã chốt thì người phỏng vấn không sửa đè được nữa (database cũng chặn: BTC_DECIDED). */}
      {own && !editing && detail && !op.btc_decided_at && <button className="mt-2 rounded border px-3 py-2" onClick={()=>setEditing(true)}>Sửa kết quả / lựa chọn mentee</button>}
    </div>}
    {data.canDecide && op && btcCanDecide(op) && <BtcDecisionBox name={c.name} operation={op} busy={busy} onDecide={decide} />}
    {own && editing && (data.rubric
      ? <InterviewResultForm rubric={data.rubric} review={review} operation={op} candidateName={c.name}
          mentorLabel={`${me?.full_name??"tài khoản hiện tại"}${me?.capacity!=null ? ` · ${me.activeMatches}/${me.capacity}` : " · chưa có hồ sơ mentor hợp lệ"}`}
          full={full} takeLimitReached={takeLimitReached} busy={busy}
          draftKey={data.actorId ? draftKey(data.actorId,c.id) : null} onSubmit={values=>save("result",values)} />
      : <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">Mùa này chưa có phiếu chấm phỏng vấn. Nhờ BTC cài phiếu ở mục &quot;Phiếu chấm &amp; hướng dẫn mentee&quot; rồi tải lại trang.</p>)}
  </section>;
}
