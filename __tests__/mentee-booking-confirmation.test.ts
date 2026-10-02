import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn(),rows:{} as Record<string,unknown>}));
// Hai câu trả lời chuẩn bị bắt buộc trước khi giữ chỗ (BTC 02/10/2026): hàm giữ chỗ
// đọc invite → hồ sơ trước khi gọi vam101.
vi.mock("@/lib/supabase-server",()=>({getSupabaseServiceRoleClient:()=>({rpc:mocks.rpc,from:(table:string)=>{
  const b:any={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:mocks.rows[table]??null,error:null})};return b;}})}));
vi.mock("@/lib/email",()=>({sendMenteeSessionConfirmed:mocks.send}));
import {bookMenteeSession,changeMenteeSession} from "@/lib/mentee-interview";
const input={token:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222"};
const ANSWERED={mentor_expectation_text:"Mentor ngành tài chính",mentor_reason_text:"Cần định hướng"};
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,"error").mockImplementation(()=>{});
  mocks.rows={mentee_interview_invites:{application_id:"app-1"},applications:{raw_payload:ANSWERED}};});
it.each([[bookMenteeSession,"vam101_book_mentee_session"],[changeMenteeSession,"vam102_change_mentee_session"]] as const)("giữ/đổi ca xác nhận ngay và không gửi email thứ hai (%s)",async(fn,rpc)=>{
  mocks.rpc.mockResolvedValue({data:{ok:true,starts_at:"2026-10-03T01:00:00Z",ends_at:"2026-10-03T01:30:00Z",venue:"Phòng A",candidate:{full_name:"A",email:"a@example.test"}},error:null});
  const result=await fn(input);
  expect(result.ok).toBe(true);expect(result.sessionLabel).toContain("08:00 – 08:30");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith(rpc,{p_token:input.token,p_session_id:input.sessionId});
  expect(mocks.send).not.toHaveBeenCalled();
});
it("đổi sang ca kín giữ nguyên ca cũ",async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:false,code:"session_full"},error:null});
  expect(await changeMenteeSession(input)).toMatchObject({ok:false,message:expect.stringContaining("Ca cũ của bạn vẫn còn nguyên")});
  expect(mocks.send).not.toHaveBeenCalled();
});
it("đã check-in thì hướng dẫn gặp support",async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:"ALREADY_CHECKED_IN"}});
  expect(await changeMenteeSession(input)).toMatchObject({ok:false,message:expect.stringContaining("đã check-in")});
});
it("token không hợp lệ không gọi database",async()=>{
  expect((await bookMenteeSession({...input,token:"x"})).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  ["thiếu cả hai câu", {}],
  ["thiếu câu thứ hai", {mentor_expectation_text:"Có"}],
  ["chỉ có khoảng trắng", {mentor_expectation_text:"  ",mentor_reason_text:" "}]
])("chưa đủ 2 câu trả lời chuẩn bị (%s): KHÔNG giữ chỗ, nói rõ cần trả lời",async(_label,payload)=>{
  mocks.rows.applications={raw_payload:payload};
  const result=await bookMenteeSession(input);
  expect(result).toEqual({ok:false,message:"Bạn cần trả lời đủ 2 câu hỏi chuẩn bị trước khi chọn ca phỏng vấn."});
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("đổi ca (đã giữ chỗ) không bị chặn bởi câu trả lời — chỉ lần chọn ca đầu cần",async()=>{
  mocks.rows.applications={raw_payload:{}};
  mocks.rpc.mockResolvedValue({data:{ok:true,starts_at:"2026-10-03T01:00:00Z",ends_at:"2026-10-03T01:30:00Z"},error:null});
  expect((await changeMenteeSession(input)).ok).toBe(true);
});
