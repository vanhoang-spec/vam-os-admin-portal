import {afterAll,beforeAll,describe,expect,it} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {offlineDb,ids,uuid,save,assigned,pass,addCandidate} from "./support/offline-postgres";

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
    await rejects(()=>save(db,"result",2,{...pass,scores:[5,5,5,5,6]},ids.mentor),"INVALID_SCORES");
    await rejects(()=>save(db,"result",2,{...pass,outcome:"rejected",takeMentee:false},ids.mentor),"REASON_REQUIRED");
    expect((await db.query("select count(*)::int as n from matches")).rows[0]).toEqual({n:0});
  }));
  it("nhận mentee chốt đạt + membership + match + điểm + audit; sửa nhầm hoàn slot",()=>isolated(async()=>{
    await assigned(db);await save(db,"result",2,pass,ids.mentor);
    expect((await db.query("select outcome,revision from mentee_interview_operations")).rows).toEqual([{outcome:"passed",revision:3}]);
    expect((await db.query("select status from applications where id=$1",[ids.app])).rows).toEqual([{status:"approved_as_mentee"}]);
    expect((await db.query("select status,total_score from application_reviews")).rows).toEqual([{status:"submitted",total_score:22}]);
    expect((await db.query("select status from matches")).rows).toEqual([{status:"active"}]);
    await rejects(()=>save(db,"result",3,{...pass,takeMentee:false},ids.mentor),"REASON_REQUIRED");
    await save(db,"result",3,{...pass,outcome:"rejected",takeMentee:false,reason:"Chọn nhầm"},ids.mentor);
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
    await save(db,"result",2,{...pass,takeMentee:false},ids.mentor);
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
      await db.exec("set local role service_role");
    }
  }));
});
