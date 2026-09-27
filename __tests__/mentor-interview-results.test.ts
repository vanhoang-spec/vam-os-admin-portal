import {beforeEach,expect,it,vi} from "vitest";
import {mentorResult} from "./support/mentor-result-fixture";
const mocks=vi.hoisted(()=>({actor:vi.fn(),scope:vi.fn(),read:vi.fn(),operate:vi.fn(),review:vi.fn(),client:vi.fn()}));
vi.mock("@/lib/admin-auth",()=>({getCurrentAdminUser:mocks.actor}));
vi.mock("@/lib/program-scope",()=>({getAdminScopeContext:mocks.scope,canReadSeason:mocks.read,canOperateSeason:mocks.operate,canReviewSeason:mocks.review}));
vi.mock("@/lib/supabase-server",()=>({getSupabaseServiceRoleClient:mocks.client}));
import {getMentorInterviewResults} from "@/lib/mentor-interview-results";
type Row=Record<string,any>;
let records:Record<string,Row[]>;
let queries:Array<{table:string;filters:Array<[string,string,unknown]>}>;
let failTable:string;
// Real paging helper against a cap of ONE row: both page filters and exhaustion matter.
function client() {return {from:(table:string)=>{
  const filters:Array<[string,string,unknown]>=[];
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(["eq",k,v]);return q;},
    in:(k:string,v:unknown)=>{filters.push(["in",k,v]);return q;},gt:(k:string,v:unknown)=>{filters.push(["gt",k,v]);return q;},order:()=>q,
    single:async()=>({data:{id:"s12"},error:null}),limit:async()=>{
      queries.push({table,filters});
      if(table===failTable) return {data:null,error:{message:"network"}};
      const value=(r:Row,k:string):any=>k.split(".").reduce((o,key)=>o?.[key],r);
      const found=(records[table]??[]).filter(r=>filters.every(([op,k,v])=>op==="eq"?value(r,k)===v:op==="in"?(v as unknown[]).includes(value(r,k)):value(r,k)>String(v))).sort((a,b)=>a.id.localeCompare(b.id));
      return {data:found.slice(0,1),error:null};
    }};return q;
}};}
beforeEach(()=>{
  vi.clearAllMocks();failTable="";queries=[];
  mocks.actor.mockResolvedValue({id:"interviewer",role:"core_team"});mocks.scope.mockResolvedValue({scopeError:null});mocks.read.mockResolvedValue(true);mocks.operate.mockResolvedValue(true);mocks.review.mockResolvedValue(true);mocks.client.mockReturnValue(client());
  records={application_reviews:[{...mentorResult(),review_round:"interview",application:{...mentorResult().application,role_applied:"mentor"}}],application_decisions:[]};
});
it("keeps rejected/approved/waitlisted mentors after saving and reads ALL capped pages",async()=>{
  ["approved_as_mentor","waitlisted","interview_passed"].forEach((status,i)=>records.application_reviews.push({...records.application_reviews[0],id:`r${i+2}`,application:{...records.application_reviews[0].application,status}}));
  const result=await getMentorInterviewResults();expect(result.ok).toBe(true);
  if(result.ok) expect(result.data.rows).toHaveLength(4);
  expect(queries.filter(q=>q.table==="application_reviews")).toHaveLength(5);
  for(const q of queries.filter(q=>q.table==="application_reviews")) {
    expect(q.filters).toContainEqual(["eq","application.season_id","s12"]);
    expect(q.filters).toContainEqual(["eq","application.role_applied","mentor"]);
    expect(q.filters.some(([,key])=>key==="application.status")).toBe(false);
  }
});
it("excludes other seasons, mentees, screening and unstarted/cancelled reviews",async()=>{
  const base=records.application_reviews[0];
  records.application_reviews.push({...base,id:"r2",application:{...base.application,season_id:"s11"}},{...base,id:"r3",application:{...base.application,role_applied:"mentee"}},{...base,id:"r4",review_round:"profile_screening"},{...base,id:"r5",status:"assigned"},{...base,id:"r6",status:"cancelled"});
  const result=await getMentorInterviewResults();expect(result.ok&&result.data.rows.map(r=>r.id)).toEqual(["r1"]);
});
it("reviewer only sees own saved notes, not other interviewer or BTC notes",async()=>{
  mocks.actor.mockResolvedValue({id:"interviewer",role:"reviewer"});
  records.application_reviews.push({...records.application_reviews[0],id:"r2",reviewer_admin_user_id:"someone-else",reviewer_note:"PRIVATE"});
  const result=await getMentorInterviewResults();expect(result.ok&&result.data.rows.map(r=>r.id)).toEqual(["r1"]);
  expect(queries.some(q=>q.table==="application_decisions")).toBe(false);
  expect(result.ok&&result.data.canExport).toBe(false);
});
it("Support can read saved notes but cannot bulk export",async()=>{
  mocks.actor.mockResolvedValue({id:"support",role:"support_team"});
  expect((await getMentorInterviewResults()).ok).toBe(true);
  expect(await getMentorInterviewResults(true)).toMatchObject({ok:false,status:403});
});
it("exports require operations scope and deny missing identity/role/scope",async()=>{
  mocks.actor.mockResolvedValue(null);expect(await getMentorInterviewResults()).toMatchObject({ok:false,status:401});
  mocks.actor.mockResolvedValue({id:"x",role:"viewer"});expect(await getMentorInterviewResults()).toMatchObject({ok:false,status:403});
  mocks.actor.mockResolvedValue({id:"x",role:"core_team"});mocks.operate.mockResolvedValue(false);
  expect(await getMentorInterviewResults(true)).toMatchObject({ok:false,status:403});
  mocks.read.mockResolvedValue(false);expect(await getMentorInterviewResults()).toMatchObject({ok:false,status:403});
  expect(queries).toHaveLength(0);
});
it("scope failure or decision read failure never produces a partial report",async()=>{
  mocks.scope.mockResolvedValue({scopeError:"unavailable"});expect(await getMentorInterviewResults()).toMatchObject({ok:false,status:503});expect(queries).toHaveLength(0);
  mocks.scope.mockResolvedValue({scopeError:null});failTable="application_decisions";
  expect(await getMentorInterviewResults(true)).toMatchObject({ok:false,status:500});
});
it("BTC decisions are limited to authorized mentor applications",async()=>{
  records.application_decisions=[{id:"d1",application_id:"a1",created_at:"2026-09-27",decision_note:"core note"},{id:"d2",application_id:"outside",created_at:"2026-09-27",decision_note:"SECRET"}];
  const result=await getMentorInterviewResults(true);expect(result.ok&&result.data.decisions.map(d=>d.id)).toEqual(["d1"]);
});
