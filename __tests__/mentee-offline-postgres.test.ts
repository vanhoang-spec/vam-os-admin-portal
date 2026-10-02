import {afterAll,beforeAll,describe,expect,it} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {offlineDb,ids,uuid,save,assigned,pass,addCandidate,cancelBooking,moveBooking,guide,saveRubric,saveHandbook} from "./support/offline-postgres";
import {S12_INTERVIEW_CRITERIA,S12_INTERVIEW_GUIDANCE} from "@/lib/mentee-interview-rubric-s12";

const crit=(over:Record<string,unknown>)=>({...(pass.criteria as Record<string,unknown>),...over});
// Phiên bản phiếu S12 sau mọi migration (20261002150000 nâng lên 2) — đọc từ database, không gõ cứng.
const V=()=>pass.rubricVersion as number;

describe("offline workflow — thực thi PostgreSQL, không mock RPC",()=>{
  let db:PGlite;
  beforeAll(async()=>{db=await offlineDb();},30000);
  afterAll(async()=>{await db?.close();});
  // Each test has a transaction, rolled back even after a failing statement.
  async function isolated(run:()=>Promise<void>) {
    await db.exec("begin");
    try {await run();} finally {await db.exec("rollback");}
  }
  async function rejects(run:()=>Promise<unknown>,error:string) {
    await db.exec("savepoint expected_failure");
    await expect(run()).rejects.toThrow(error);
    await db.exec("rollback to savepoint expected_failure");
  }
  it("QR khác link quản lý; chỉ Support đúng mùa tra được vé",()=>isolated(async()=>{
    const {rows:[ticket]}=await db.query<{token:string;checkin_token:string}>("select token,checkin_token from mentee_interview_invites");
    expect(ticket.token).not.toBe(ticket.checkin_token);
    const lookup=(actor:string,code:string,season=ids.season)=>db.query("select vam104_lookup_offline_ticket($1,$2,$3) as id",[actor,season,code]);
    expect((await lookup(ids.support,ticket.checkin_token)).rows).toEqual([{id:ids.app}]);
    expect((await lookup(ids.support,ticket.token)).rows).toEqual([{id:null}]);
    await rejects(()=>lookup(ids.mentor,ticket.checkin_token),"ACCESS_DENIED");
    await rejects(()=>lookup(ids.support,ticket.checkin_token,uuid(50)),"ACCESS_DENIED");
  }));
  it("Support và interviewer thấy hồ sơ; người ngoài phạm vi bị chặn",()=>isolated(async()=>{
    for(const actor of [ids.support,ids.mentor]) {
      const {rows:[row]}=await db.query<{data:any}>("select vam104_offline_dashboard($1,$2) as data",[actor,ids.season]);
      expect(row.data.candidates[0].rawPayload.goal).toBe("Học hỏi");
      expect(row.data.participants[0].capacity).toBe(1);
      expect(JSON.stringify(row.data)).not.toContain("checkin_token");
    }
    await rejects(()=>db.query("select vam104_offline_dashboard($1,$2)",[ids.other,ids.season]),"ACCESS_DENIED");
  }));
  it("check-in lặp không tăng revision; không đổi ca sau check-in",()=>isolated(async()=>{
    await save(db,"checkin",0);await save(db,"checkin",1);
    expect((await db.query("select revision from mentee_interview_operations")).rows).toEqual([{revision:1}]);
    await rejects(()=>db.exec("update mentee_interview_bookings set status='cancelled'"),"ALREADY_CHECKED_IN");
  }));
  it("cấu hình không vượt 30 mentee mỗi ca — trần vật lý cao nhất (Chủ nhật)",()=>isolated(async()=>{
    await rejects(()=>db.exec(`update interview_sessions set seat_limit=31 where id='${ids.session}'`),"SESSION_MAX_30");
    expect((await db.query("select seat_limit from interview_sessions where id=$1",[ids.session])).rows).toEqual([{seat_limit:18}]);
  }));
  it("phải check-in; giới hạn phòng/bàn đúng theo NGÀY của ca; từ chối người chưa được cấp quyền",()=>isolated(async()=>{
    await rejects(()=>save(db,"assign",0,{room:1,desk:1,interviewerId:ids.mentor}),"CHECKIN_REQUIRED");
    await save(db,"checkin",0);
    // Thứ Bảy (ids.session): 3 phòng × 6 bàn.
    // desk=7 vượt cận thô 1..6 của chính RPC — chặn trước khi chạm trigger.
    await rejects(()=>save(db,"assign",1,{room:1,desk:7,interviewerId:ids.mentor}),"INVALID_ASSIGNMENT");
    // room=4 vẫn trong cận thô 1..6, nhưng thứ Bảy chỉ có 3 phòng — trigger chặn.
    await rejects(()=>save(db,"assign",1,{room:4,desk:1,interviewerId:ids.mentor}),"ROOM_DESK_OUT_OF_RANGE");
    await rejects(()=>save(db,"assign",1,{room:1,desk:1,interviewerId:ids.other}),"INVALID_ASSIGNMENT");
    await save(db,"assign",1,{room:3,desk:6,interviewerId:ids.mentor});
  }));
  it("Chủ nhật: 6 phòng × 5 bàn — trần khác hẳn thứ Bảy",()=>isolated(async()=>{
    const menteeSun=uuid(21);
    await addCandidate(db,menteeSun,ids.sessionSun);
    await save(db,"checkin",0,{},ids.support,menteeSun);
    // room=7 vượt cận thô 1..6 của RPC — chặn trước khi chạm trigger.
    await rejects(()=>save(db,"assign",1,{room:7,desk:1,interviewerId:ids.mentor},ids.support,menteeSun),"INVALID_ASSIGNMENT");
    // desk=6 vẫn trong cận thô 1..6, nhưng Chủ nhật chỉ có 5 bàn — trigger chặn.
    await rejects(()=>save(db,"assign",1,{room:1,desk:6,interviewerId:ids.mentor},ids.support,menteeSun),"ROOM_DESK_OUT_OF_RANGE");
    await save(db,"assign",1,{room:6,desk:5,interviewerId:ids.mentor},ids.support,menteeSun);
  }));
  it("không phân một interviewer hai ứng viên trong cùng ca",()=>isolated(async()=>{
    await assigned(db);await addCandidate(db,uuid(20));await save(db,"checkin",0,{},ids.support,uuid(20));
    await rejects(()=>save(db,"assign",1,{room:2,desk:2,interviewerId:ids.mentor},ids.support,uuid(20)),"mentee_interview_interviewer_uidx");
  }));
  it("Support không chấm thay; dữ liệu cũ hoặc thiếu điểm không ghi dở",()=>isolated(async()=>{
    await assigned(db);
    await rejects(()=>save(db,"result",2,pass),"NOT_ASSIGNED");
    await rejects(()=>save(db,"result",1,pass,ids.mentor),"STALE_REVISION");
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({need:{score:6}})},ids.mentor),"INVALID_SCORES");
    // "Có – nhận" chỉ đi cùng Đạt. Không chọn thì mục C khoá hẳn (02/10/2026) nên bị
    // chặn ở lựa chọn; Cần BTC xem xét mà vẫn "nhận" là phiếu mâu thuẫn.
    await rejects(()=>save(db,"result",2,{...pass,outcome:"rejected"},ids.mentor),"INVALID_TAKE_CHOICE");
    await rejects(()=>save(db,"result",2,{...pass,outcome:"needs_review"},ids.mentor),"INVALID_RESULT");
    expect((await db.query("select count(*)::int as n from matches")).rows[0]).toEqual({n:0});
    expect((await db.query("select status from application_reviews")).rows).toEqual([{status:"assigned"}]);
  }));
  it("nhận mentee chốt đạt + membership + match + điểm + audit; sửa nhầm hoàn slot",()=>isolated(async()=>{
    await assigned(db);await save(db,"result",2,pass,ids.mentor);
    expect((await db.query("select outcome,revision from mentee_interview_operations")).rows).toEqual([{outcome:"passed",revision:3}]);
    expect((await db.query("select status from applications where id=$1",[ids.app])).rows).toEqual([{status:"approved_as_mentee"}]);
    expect((await db.query("select status,total_score from application_reviews")).rows).toEqual([{status:"submitted",total_score:null}]);
    expect((await db.query("select status from matches")).rows).toEqual([{status:"active"}]);
    // Kết quả đã chốt thì đổi gì cũng phải có lý do SỬA, kể cả chỉ đổi lựa chọn mục C.
    await rejects(()=>save(db,"result",3,{...pass,takeChoice:"recommend_other"},ids.mentor),"REASON_REQUIRED");
    await save(db,"result",3,{...pass,outcome:"rejected",takeChoice:null,reason:"Chọn nhầm"},ids.mentor);
    expect((await db.query("select status from matches")).rows).toEqual([{status:"dropped"}]);
    expect((await db.query("select status from person_season_memberships where role='mentee'")).rows).toEqual([{status:"withdrawn"}]);
    const {rows:[log]}=await db.query<any>("select before_data,after_data,reason from mentee_interview_operation_log where action='result' order by (after_data->'operation'->>'revision')::int desc limit 1");
    expect(log.before_data.operation.outcome).toBe("passed");expect(log.after_data.operation.outcome).toBe("rejected");expect(log.reason).toBe("Chọn nhầm");
    await save(db,"result",4,{...pass,reason:"Đã kiểm lại"},ids.mentor);
    expect((await db.query("select count(*)::int as n from matches where status='active'")).rows).toEqual([{n:1}]);
    expect((await db.query("select status from person_season_memberships where role='mentee'")).rows).toEqual([{status:"active"}]);
  }));
  it("mentor đầy thì toàn bộ kết quả rollback; đường matching cũ cũng không vượt suất",()=>isolated(async()=>{
    await assigned(db);
    await db.exec(`insert into people(id,full_name) values('${uuid(30)}','Existing'); insert into matches(season_id,mentor_person_id,mentee_person_id,status) values('${ids.season}','${ids.person}','${uuid(30)}','active');`);
    await rejects(()=>save(db,"result",2,pass,ids.mentor),"MENTOR_FULL");
    expect((await db.query("select outcome,revision from mentee_interview_operations")).rows).toEqual([{outcome:null,revision:2}]);
    expect((await db.query("select status from application_reviews")).rows).toEqual([{status:"assigned"}]);
    await rejects(()=>db.exec(`insert into matches(season_id,mentor_person_id,mentee_person_id,status) values('${ids.season}','${ids.person}','${ids.person}','active')`),"MENTOR_FULL");
    await save(db,"result",2,{...pass,takeChoice:"recommend_other"},ids.mentor);
    expect((await db.query("select outcome from mentee_interview_operations")).rows).toEqual([{outcome:"passed"}]);
  }));
  it("không sửa điểm offline từ đường cũ; đổi bàn giữ cùng review",()=>isolated(async()=>{
    await assigned(db);
    const initial=(await db.query("select review_id from mentee_interview_operations")).rows;
    await save(db,"assign",2,{room:2,desk:2,interviewerId:ids.mentor});
    expect((await db.query("select review_id from mentee_interview_operations")).rows).toEqual(initial);
    await rejects(()=>db.exec("update application_reviews set reviewer_note='bypass'"),"OFFLINE_REVIEW_USE_WORKFLOW");
  }));
  it("nhận lại review cũ chưa nộp thay vì tạo trùng",()=>isolated(async()=>{
    await db.query("insert into application_reviews(application_id,review_round,reviewer_admin_user_id) values($1,'interview',$2)",[ids.app,ids.mentor]);
    await assigned(db);
    expect((await db.query("select count(*)::int as n from application_reviews")).rows).toEqual([{n:1}]);
    await save(db,"result",2,pass,ids.mentor);
  }));
  it("anon/authenticated không đọc bảng và không gọi RPC được",()=>isolated(async()=>{
    for(const role of ["anon","authenticated"]) {
      await db.exec(`set local role ${role}`);
      await rejects(()=>db.exec("select * from mentee_interview_operations"),"permission denied");
      await rejects(()=>db.query("select vam104_offline_dashboard($1,$2)",[ids.support,ids.season]),"permission denied");
      await rejects(()=>cancelBooking(db,"Thử quyền"),"permission denied");
      await rejects(()=>db.exec("select * from mentee_interview_rubrics"),"permission denied");
      await rejects(()=>db.exec("select * from mentee_interview_rubric_log"),"permission denied");
      await rejects(()=>guide(db,ids.btc),"permission denied");
      await rejects(()=>saveRubric(db,1,S12_INTERVIEW_CRITERIA),"permission denied");
      await rejects(()=>saveHandbook(db,0,"<p>x</p>"),"permission denied");
      await db.exec("set local role service_role");
    }
  }));
  it("phiếu Mùa 12 sau migration: phiên bản 2, đúng 4 tiêu chí, trọng số 30/20/25/25, trùng khít bản TS",()=>isolated(async()=>{
    const data=await guide(db,ids.btc);
    expect(data.rubric.own).toBe(true);
    expect(data.rubric.seasonCode).toBe("UEHM-S12");
    expect(data.rubric.version).toBe(2);
    expect(data.rubric.criteria).toEqual(S12_INTERVIEW_CRITERIA);
    expect(data.rubric.guidance).toEqual(S12_INTERVIEW_GUIDANCE);
    expect(data.rubric.criteria.map((c:{weight:number})=>c.weight)).toEqual([30,20,25,25]);
    expect(data.rubric.hasHandbook).toBe(false);
  }));
  it("lưu theo phiếu: ảnh chụp từng tiêu chí, điểm quy đổi tham khảo, KHÔNG có tổng, đủ mục A/B/C",()=>isolated(async()=>{
    await assigned(db);await save(db,"result",2,pass,ids.mentor);
    const {rows:[r]}=await db.query<any>(`select interview_scores,rubric_version,weighted_score::text as weighted,total_score,score_motivation,
      reviewer_note,recommendation,key_development_need,expectation_alignment,alignment_note,take_choice,desired_mentor_profile,additional_note
      from application_reviews`);
    expect(r.interview_scores).toEqual([
      {key:"need",label:"Nhu cầu Mentoring & Giá trị phát triển",weight:30,score:5,note:"Có development need thật"},
      {key:"readiness",label:"Sẵn sàng học hỏi",weight:20,score:3,note:"Nghe góp ý tốt"},
      {key:"ownership",label:"Chủ động & Chịu trách nhiệm",weight:25,score:4,note:"Tự đặt lịch"},
      {key:"follow_through",label:"Cam kết & Theo đến cùng",weight:25,score:2,note:"Kế hoạch còn chung"}
    ]);
    // (5×30 + 3×20 + 4×25 + 2×25) / 100 = 3.60
    expect(r.weighted).toBe("3.60");
    expect(r).toMatchObject({rubric_version:V(),total_score:null,score_motivation:null,reviewer_note:"Có động lực",
      recommendation:"approve_recommended",key_development_need:"Khám phá hướng nghề",expectation_alignment:"aligned",
      alignment_note:"Đã thống nhất lịch gặp",take_choice:"take",desired_mentor_profile:"Thiên về coaching, từng chuyển ngành",additional_note:null});
    const {rows:[decision]}=await db.query<any>("select decision_note from application_decisions");
    expect(decision.decision_note).toBe("Có động lực");
  }));
  it("điểm phải khớp ĐÚNG các tiêu chí của phiếu, mỗi điểm 1–5",()=>isolated(async()=>{
    await assigned(db);
    const {follow_through:_dropped,...missing}=pass.criteria as Record<string,unknown>;
    await rejects(()=>save(db,"result",2,{...pass,criteria:missing},ids.mentor),"INVALID_SCORES");
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({motivation:{score:3}})},ids.mentor),"INVALID_SCORES");
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({need:{score:"4.5"}})},ids.mentor),"INVALID_SCORES");
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({need:{score:0}})},ids.mentor),"INVALID_SCORES");
    await rejects(()=>save(db,"result",2,{...pass,criteria:[5,3,4,2]},ids.mentor),"INVALID_SCORES");
    expect((await db.query("select status from application_reviews")).rows).toEqual([{status:"assigned"}]);
  }));
  it("mục A/C bắt buộc: lý do chọn/không chọn, nhu cầu phát triển, chân dung mentor, alignment và lựa chọn hợp lệ",()=>isolated(async()=>{
    await assigned(db);
    await rejects(()=>save(db,"result",2,{...pass,rationale:"  "},ids.mentor),"RATIONALE_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,keyNeed:""},ids.mentor),"KEY_NEED_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,desiredMentor:""},ids.mentor),"DESIRED_MENTOR_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,alignment:"ok"},ids.mentor),"INVALID_ALIGNMENT");
    // Evidence / Note của MỌI tiêu chí và Concern / Note bắt buộc (BTC 02/10/2026).
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({readiness:{score:3,note:"   "}})},ids.mentor),"CRITERION_NOTE_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,criteria:crit({ownership:{score:4}})},ids.mentor),"CRITERION_NOTE_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,alignmentNote:" "},ids.mentor),"ALIGNMENT_NOTE_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,alignmentNote:undefined},ids.mentor),"ALIGNMENT_NOTE_REQUIRED");
    await rejects(()=>save(db,"result",2,{...pass,takeChoice:"yes"},ids.mentor),"INVALID_TAKE_CHOICE");
    await rejects(()=>save(db,"result",2,{...pass,rationale:"x".repeat(4001)},ids.mentor),"TEXT_TOO_LONG");
    expect((await db.query("select status from application_reviews")).rows).toEqual([{status:"assigned"}]);
  }));
  it("Không chọn: khoá mục C (không lựa chọn nhận, không cần chân dung mentor), ghi đúng lý do, không tạo cặp",()=>isolated(async()=>{
    await assigned(db);
    await rejects(()=>save(db,"result",2,{...pass,outcome:"rejected",takeChoice:"undecided",rationale:"x"},ids.mentor),"INVALID_TAKE_CHOICE");
    await rejects(()=>save(db,"result",2,{...pass,outcome:"rejected",takeChoice:"take",rationale:"x"},ids.mentor),"INVALID_TAKE_CHOICE");
    await save(db,"result",2,{...pass,outcome:"rejected",takeChoice:null,desiredMentor:"",rationale:"Chưa thấy nhu cầu mentoring rõ"},ids.mentor);
    expect((await db.query("select take_choice,desired_mentor_profile from application_reviews")).rows).toEqual([{take_choice:null,desired_mentor_profile:null}]);
    expect((await db.query("select count(*)::int as n from matches")).rows[0]).toEqual({n:0});
    expect((await db.query("select status from applications where id=$1",[ids.app])).rows).toEqual([{status:"rejected_or_not_fit"}]);
    const {rows:[op]}=await db.query<any>("select outcome_reason from mentee_interview_operations");
    expect(op.outcome_reason).toBe("Chưa thấy nhu cầu mentoring rõ");
  }));
  it("mỗi mentor chọn \"Có – Tôi muốn nhận\" cho tối đa 2 hồ sơ trong mùa; phiếu huỷ / lựa chọn khác không tính",()=>isolated(async()=>{
    await assigned(db);
    // Hai phiếu ĐÃ NỘP khác của chính mentor này đã chọn take; một phiếu huỷ và một phiếu
    // của mentor khác cũng chọn take nhưng KHÔNG được tính.
    await db.exec(`set local role postgres;
      insert into applications(id,season_id,role_applied,status,source,full_name) values
        ('${uuid(41)}','${ids.season}','mentee','approved_as_mentee','vam_os_form','A'),
        ('${uuid(42)}','${ids.season}','mentee','approved_as_mentee','vam_os_form','B'),
        ('${uuid(43)}','${ids.season}','mentee','approved_as_mentee','vam_os_form','C');
      insert into application_reviews(application_id,review_round,reviewer_admin_user_id,status,take_choice) values
        ('${uuid(41)}','interview','${ids.mentor}','submitted','take'),
        ('${uuid(43)}','interview','${ids.mentor}','cancelled','take'),
        ('${uuid(43)}','interview','${ids.btc}','submitted','take');
      set local role service_role;`);
    // Mới 1 phiếu tính → lần thứ hai vẫn hợp lệ (rồi huỷ để thử lần thứ ba).
    await db.exec("savepoint second_take");
    await save(db,"result",2,pass,ids.mentor);
    await db.exec("rollback to savepoint second_take");
    await db.exec(`set local role postgres;
      insert into application_reviews(application_id,review_round,reviewer_admin_user_id,status,take_choice) values
        ('${uuid(42)}','interview','${ids.mentor}','submitted','take');
      set local role service_role;`);
    await rejects(()=>save(db,"result",2,pass,ids.mentor),"TAKE_LIMIT_REACHED");
    expect((await db.query("select status from application_reviews where application_id=$1",[ids.app])).rows).toEqual([{status:"assigned"}]);
    expect((await db.query("select count(*)::int as n from matches")).rows[0]).toEqual({n:0});
    // Vẫn chốt Đạt được với lựa chọn khác.
    await save(db,"result",2,{...pass,takeChoice:"recommend_other"},ids.mentor);
    expect((await db.query("select take_choice from application_reviews where application_id=$1",[ids.app])).rows).toEqual([{take_choice:"recommend_other"}]);
  }));
  it("BTC sửa phiếu giữa chừng: form đang mở bị từ chối RUBRIC_CHANGED, không ghi điểm lệch phiếu",()=>isolated(async()=>{
    await assigned(db);
    await rejects(()=>save(db,"result",2,{...pass,rubricVersion:V()+1},ids.mentor),"RUBRIC_CHANGED");
    await rejects(()=>save(db,"result",2,{...pass,rubricId:uuid(99)},ids.mentor),"RUBRIC_CHANGED");
    await saveRubric(db,V(),S12_INTERVIEW_CRITERIA,{motto:"Đổi kim chỉ nam"});
    await rejects(()=>save(db,"result",2,pass,ids.mentor),"RUBRIC_CHANGED");
    await save(db,"result",2,{...pass,rubricVersion:V()+1},ids.mentor);
    expect((await db.query("select rubric_version from application_reviews")).rows).toEqual([{rubric_version:V()+1}]);
  }));
  it("điểm đã nộp giữ nguyên nhãn/trọng số lúc chấm dù phiếu bị sửa sau đó",()=>isolated(async()=>{
    await assigned(db);await save(db,"result",2,pass,ids.mentor);
    const renamed=S12_INTERVIEW_CRITERIA.map((c,i)=>i===0?{...c,label:"Nhu cầu (đổi tên)",weight:40}:i===1?{...c,weight:10}:c);
    await saveRubric(db,V(),renamed);
    const {rows:[r]}=await db.query<any>("select interview_scores->0 as first from application_reviews");
    expect(r.first).toMatchObject({label:"Nhu cầu Mentoring & Giá trị phát triển",weight:30,score:5});
  }));
  it("lưu phiếu: chỉ BTC vận hành mùa; chống ghi đè; hình dạng sai bị chặn; có log trước/sau",()=>isolated(async()=>{
    await rejects(()=>saveRubric(db,V(),S12_INTERVIEW_CRITERIA,{},ids.support),"ACCESS_DENIED");
    await rejects(()=>saveRubric(db,V(),S12_INTERVIEW_CRITERIA,{},ids.mentor),"ACCESS_DENIED");
    await rejects(()=>saveRubric(db,0,S12_INTERVIEW_CRITERIA),"STALE_VERSION");
    const heavy=S12_INTERVIEW_CRITERIA.map((c,i)=>i===0?{...c,weight:35}:c);
    await rejects(()=>saveRubric(db,V(),heavy),"INVALID_RUBRIC");
    const dup=S12_INTERVIEW_CRITERIA.map((c,i)=>i===1?{...c,key:"need"}:c);
    await rejects(()=>saveRubric(db,V(),dup),"INVALID_RUBRIC");
    const badKey=S12_INTERVIEW_CRITERIA.map((c,i)=>i===0?{...c,key:"Nhu cầu"}:c);
    await rejects(()=>saveRubric(db,V(),badKey),"INVALID_RUBRIC");
    await rejects(()=>saveRubric(db,V(),[]),"INVALID_RUBRIC");
    await rejects(()=>saveRubric(db,V(),S12_INTERVIEW_CRITERIA,{extra:"x"}),"INVALID_RUBRIC");
    const three=[{...S12_INTERVIEW_CRITERIA[0],weight:50},{...S12_INTERVIEW_CRITERIA[1],weight:25},{...S12_INTERVIEW_CRITERIA[2],weight:25}];
    await saveRubric(db,V(),three,{motto:"Ba tiêu chí"});
    const data=await guide(db,ids.btc);
    expect(data.rubric.version).toBe(V()+1);
    expect(data.rubric.criteria.map((c:{key:string})=>c.key)).toEqual(["need","readiness","ownership"]);
    const {rows:[log]}=await db.query<any>("select action,before_data,after_data,actor_id from mentee_interview_rubric_log");
    expect(log.action).toBe("save_rubric");expect(log.actor_id).toBe(ids.btc);
    expect(log.before_data.version).toBe(V());expect(log.after_data.version).toBe(V()+1);
    expect(log.before_data.criteria).toHaveLength(4);expect(log.after_data.criteria).toHaveLength(3);
  }));
  it("Handbook: tăng handbook_version nhưng KHÔNG tăng version — form chấm đang mở không bị hỏng",()=>isolated(async()=>{
    await rejects(()=>saveHandbook(db,0,"   "),"INVALID_HANDBOOK");
    await rejects(()=>saveHandbook(db,0,"<p>x</p>","Handbook.docx",ids.support),"ACCESS_DENIED");
    await saveHandbook(db,0,"<h1>VAM MENTEE INTERVIEW GUIDE</h1>","VAM_Handbook_S12.docx");
    await rejects(()=>saveHandbook(db,0,"<p>bản cũ</p>"),"STALE_VERSION");
    const data=await guide(db,ids.btc,ids.season,true);
    expect(data.rubric).toMatchObject({version:V(),handbookVersion:1,hasHandbook:true,handbookFileName:"VAM_Handbook_S12.docx",
      handbookHtml:"<h1>VAM MENTEE INTERVIEW GUIDE</h1>"});
    expect((await guide(db,ids.btc)).rubric.handbookHtml).toBeNull();
    await assigned(db);await save(db,"result",2,pass,ids.mentor);
  }));
  it("mùa chưa có phiếu riêng dùng phiếu lưu gần nhất; lưu lần đầu tạo phiếu riêng mang theo cả Handbook",()=>isolated(async()=>{
    await saveHandbook(db,0,"<p>Handbook S12</p>","VAM_Handbook_S12.docx");
    const inherited=await guide(db,ids.btc,ids.seasonNext,true);
    expect(inherited.rubric).toMatchObject({own:false,seasonCode:"UEHM-S12",handbookHtml:"<p>Handbook S12</p>"});
    await rejects(()=>saveRubric(db,1,S12_INTERVIEW_CRITERIA,{},ids.btc,ids.seasonNext),"STALE_VERSION");
    await saveRubric(db,0,S12_INTERVIEW_CRITERIA,{motto:"Mùa 13"},ids.btc,ids.seasonNext);
    const own=await guide(db,ids.btc,ids.seasonNext,true);
    expect(own.rubric).toMatchObject({own:true,seasonCode:"UEHM-S13",copiedFromSeasonCode:"UEHM-S12",version:1,
      handbookHtml:"<p>Handbook S12</p>",guidance:{motto:"Mùa 13"}});
    // Mùa 12 vẫn là phiếu riêng của Mùa 12, không bị kéo sang Mùa 13.
    expect((await guide(db,ids.btc)).rubric.seasonCode).toBe("UEHM-S12");
    const {rows:[log]}=await db.query<any>("select action from mentee_interview_rubric_log where season_id=$1",[ids.seasonNext]);
    expect(log.action).toBe("create");
  }));
  it("không có phiếu nào thì chấm bị từ chối RUBRIC_MISSING, không ghi dở",()=>isolated(async()=>{
    // service_role cố ý không có quyền DELETE trên bảng phiếu — xoá bằng chủ database.
    await db.exec("set local role postgres; delete from mentee_interview_rubrics; set local role service_role;");
    await assigned(db);
    await rejects(()=>save(db,"result",2,pass,ids.mentor),"RUBRIC_MISSING");
    expect((await guide(db,ids.btc)).rubric).toBeNull();
  }));
  it("mentor được phân đọc được phiếu/Handbook; người ngoài phạm vi thì không",()=>isolated(async()=>{
    expect((await guide(db,ids.mentor)).rubric.seasonCode).toBe("UEHM-S12");
    expect((await guide(db,ids.support)).rubric.seasonCode).toBe("UEHM-S12");
    await rejects(()=>guide(db,ids.other),"ACCESS_DENIED");
  }));
  it("cờ phỏng vấn ONLINE mặc định false khi không gửi; lưu đúng kèm ghi chú khi assign",()=>isolated(async()=>{
    await save(db,"checkin",0);
    await save(db,"assign",1,{room:1,desk:1,interviewerId:ids.mentor});
    expect((await db.query("select is_online,online_note from mentee_interview_operations")).rows).toEqual([{is_online:false,online_note:null}]);
    await save(db,"assign",2,{room:1,desk:1,interviewerId:ids.mentor,isOnline:true,onlineNote:"Link Zoom ABC"});
    expect((await db.query("select is_online,online_note from mentee_interview_operations")).rows).toEqual([{is_online:true,online_note:"Link Zoom ABC"}]);
  }));
  it("vam104_offline_dashboard tự trả về cờ online + điểm theo phiếu — không cần sửa hàm (to_jsonb từ bảng)",()=>isolated(async()=>{
    await assigned(db);
    await save(db,"assign",2,{room:1,desk:1,interviewerId:ids.mentor,isOnline:true,onlineNote:"Link Zoom ABC"});
    await save(db,"result",3,pass,ids.mentor);
    const {rows:[row]}=await db.query<any>("select vam104_offline_dashboard($1,$2) as data",[ids.support,ids.season]);
    const candidate=row.data.candidates[0];
    expect(candidate.operation.is_online).toBe(true);
    expect(candidate.operation.online_note).toBe("Link Zoom ABC");
    expect(candidate.reviews[0].interview_scores).toHaveLength(4);
    expect(candidate.reviews[0].weighted_score).toBe(3.6);
    expect(candidate.reviews[0].take_choice).toBe("take");
  }));
  it("vam105: huỷ lịch trước check-in nhả ghế + lưu lý do; bắt buộc lý do; không còn booking thì NO_BOOKING",()=>isolated(async()=>{
    await rejects(()=>cancelBooking(db,""),"REASON_REQUIRED");
    await cancelBooking(db,"Trùng lịch phỏng vấn khác");
    expect((await db.query("select status,cancelled_by,cancel_note from mentee_interview_bookings where application_id=$1",[ids.app])).rows)
      .toEqual([{status:"cancelled",cancelled_by:ids.support,cancel_note:"Trùng lịch phỏng vấn khác"}]);
    await rejects(()=>cancelBooking(db,"Lý do khác"),"NO_BOOKING");
  }));
  it("vam105: đã check-in thì không huỷ được — tái dùng trigger vam104_booking_guard sẵn có",()=>isolated(async()=>{
    await save(db,"checkin",0);
    await rejects(()=>cancelBooking(db,"Muốn huỷ sau khi đến"),"ALREADY_CHECKED_IN");
  }));
  // Ca đích dời ra "ngày mai so với lúc chạy test": các ca seed mang ngày thật
  // 03–04/10/2026, chạy test sau ngày đó thì mọi ca đều đã qua.
  async function futureSession(id:string,seat=25) {
    await db.exec(`set local role postgres;
      update interview_sessions set starts_at=now()+interval '1 day',ends_at=now()+interval '1 day 30 minutes',
        booking_closes_at=now()-interval '1 hour',seat_limit=${seat},status='open' where id='${id}';
      set local role service_role;`);
  }
  it("vam107: BTC/Support đổi ca SAU hạn tự đổi; nhả ca cũ có lý do, ghi ca mới, dòng vận hành theo ca mới, có lịch sử",()=>isolated(async()=>{
    await futureSession(ids.sessionSun);
    // Dòng vận hành đã có (đã mở hồ sơ) nhưng CHƯA check-in.
    await db.exec(`set local role postgres; insert into mentee_interview_operations(id,session_id) values('${ids.app}','${ids.session}'); set local role service_role;`);
    const {rows:[r]}=await moveBooking(db,ids.sessionSun,"Mentee bận đột xuất");
    expect((r as any).result.ok).toBe(true);
    const {rows:bookings}=await db.query<any>("select session_id,status,cancelled_by,cancel_note from mentee_interview_bookings where application_id=$1 order by booked_at",[ids.app]);
    expect(bookings).toEqual([
      {session_id:ids.session,status:"cancelled",cancelled_by:ids.support,cancel_note:"BTC đổi ca: Mentee bận đột xuất"},
      {session_id:ids.sessionSun,status:"booked",cancelled_by:null,cancel_note:null}
    ]);
    expect((await db.query<any>("select session_id from mentee_interview_operations where id=$1",[ids.app])).rows).toEqual([{session_id:ids.sessionSun}]);
    const {rows:[d]}=await db.query<any>("select decided_by,decision_note from application_decisions where application_id=$1",[ids.app]);
    expect(d.decided_by).toBe(ids.support);
    expect(d.decision_note).toContain("Lý do: Mentee bận đột xuất");
    const {rows:[log]}=await db.query<any>("select action,actor_id,reason from mentee_interview_operation_log where application_id=$1",[ids.app]);
    expect(log).toEqual({action:"move_booking",actor_id:ids.support,reason:"Mentee bận đột xuất"});
  }));
  it("vam107: chặn — không quyền vận hành, thiếu lý do, cùng ca, ca kín, ca đã qua, ca mùa khác, đã check-in; ca cũ giữ nguyên",()=>isolated(async()=>{
    await futureSession(ids.sessionSun);
    await rejects(()=>moveBooking(db,ids.sessionSun,"Lý do",ids.mentor),"ACCESS_DENIED");
    await rejects(()=>moveBooking(db,ids.sessionSun,"   "),"REASON_REQUIRED");
    await rejects(()=>moveBooking(db,ids.session,"Lý do"),"SAME_SESSION");
    await rejects(()=>moveBooking(db,uuid(77),"Lý do"),"SESSION_NOT_FOUND");
    // Ca kín thật: 1 ghế, đã có người khác giữ.
    await db.exec("set local role postgres;");
    await addCandidate(db,uuid(51),ids.sessionSun);
    await db.exec("set local role service_role;");
    await futureSession(ids.sessionSun,1);
    await rejects(()=>moveBooking(db,ids.sessionSun,"Lý do"),"SESSION_FULL");
    await db.exec(`set local role postgres; update interview_sessions set starts_at=now()-interval '1 minute',seat_limit=25 where id='${ids.sessionSun}'; set local role service_role;`);
    await rejects(()=>moveBooking(db,ids.sessionSun,"Lý do"),"SESSION_IN_PAST");
    await futureSession(ids.sessionSun);
    await save(db,"checkin",0,{});
    await rejects(()=>moveBooking(db,ids.sessionSun,"Lý do"),"ALREADY_CHECKED_IN");
    expect((await db.query<any>("select session_id from mentee_interview_bookings where application_id=$1 and status='booked'",[ids.app])).rows).toEqual([{session_id:ids.session}]);
  }));
});
