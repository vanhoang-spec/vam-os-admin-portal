// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {OfflineDashboardClient} from "@/app/interviews/mentee-offline/workflow";
import {OFFLINE_SCORES,type OfflineDashboard} from "@/lib/mentee-offline-core";
const mocks=vi.hoisted(()=>({save:vi.fn(),lookup:vi.fn(),cancel:vi.fn(),refresh:vi.fn(),onCode:undefined as undefined|((code:string)=>void)}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/app/actions/mentee-offline",()=>({saveOfflineInterviewAction:mocks.save,lookupOfflineTicketAction:mocks.lookup,cancelMenteeBookingAction:mocks.cancel}));
vi.mock("@/app/interviews/mentee-offline/qr-camera",()=>({InterviewQrCamera:({onCode}:{onCode:(code:string)=>void})=>{mocks.onCode=onCode;return null;}}));
function data():OfflineDashboard {return {
  actorId:"mentor",seasonId:"season",canOperate:false,logs:[],
  sessions:[{id:"session",starts_at:"2026-10-03T01:00:00Z",ends_at:"2026-10-03T01:30:00Z",venue:"UEH",seat_limit:25}],
  participants:[{id:"mentor",full_name:"Mentor A",email:"mentor@example.test",capacity:1,activeMatches:0}],
  candidates:[{id:"app",name:"Mentee A",phone:"0901234567",email:"a@example.test",status:"interview_in_progress",sessionId:"session",bookedAt:"2026-09-27T01:00Z",rawPayload:null,answers:[["Mục tiêu","Học kỹ năng"]],reviews:[],
    operation:{checked_in_at:"2026-10-03T00:50Z",room:5,desk:5,interviewer_id:"mentor",review_id:"review",outcome:null,match_id:null,revision:2,is_online:false,online_note:null}}]
};}
beforeEach(()=>{vi.clearAllMocks();mocks.onCode=undefined;vi.spyOn(window,"confirm").mockReturnValue(true);mocks.save.mockResolvedValue({ok:true,message:"Đã lưu"});mocks.cancel.mockResolvedValue({ok:true,message:"Đã huỷ"});});
afterEach(cleanup);
it("mentor nhận mentee xác nhận đạt cùng 5 điểm, 5 ghi chú riêng và phiên bản đang xem",async()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  for(const [,label] of OFFLINE_SCORES) fireEvent.change(screen.getByLabelText(label),{target:{value:"4"}});
  fireEvent.change(screen.getByLabelText("Ghi chú — Động lực tham gia"),{target:{value:"Rất chủ động"}});
  fireEvent.change(screen.getByLabelText("Nhận xét"),{target:{value:"Phù hợp"}});
  fireEvent.click(screen.getByLabelText(/Nhận làm mentee của tôi/));
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận kết quả"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({applicationId:"app",action:"result",revision:2,
    values:{outcome:"passed",takeMentee:true,scores:[4,4,4,4,4],notes:["Rất chủ động","","","",""],note:"Phù hợp",reason:""}}));
  expect(mocks.refresh).toHaveBeenCalled();
});
it("đổi sang không chọn tự bỏ nhận mentee và bắt buộc lý do",()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  const take=screen.getByLabelText(/Nhận làm mentee của tôi/) as HTMLInputElement;
  fireEvent.click(take);fireEvent.change(screen.getByLabelText("Kết quả"),{target:{value:"rejected"}});
  expect(take.checked).toBe(false);expect(take.disabled).toBe(true);
  expect((screen.getByLabelText(/Lý do không chọn/) as HTMLTextAreaElement).required).toBe(true);
});
it("mentor đầy không nhận thêm; Support xem application nhưng không chấm thay",()=>{
  const full=data();full.participants[0].activeMatches=1;
  const view=render(<OfflineDashboardClient data={full} initialApplication="app"/>);
  expect((screen.getByLabelText(/Nhận làm mentee của tôi/) as HTMLInputElement).disabled).toBe(true);
  view.unmount();const support=data();support.actorId="support";support.canOperate=true;
  render(<OfflineDashboardClient data={support} initialApplication="app"/>);
  expect(screen.getByText("Học kỹ năng")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Xác nhận kết quả"})).toBeNull();
  expect(screen.getByRole("button",{name:"Lưu phân bàn"})).toBeTruthy();
});
it("tìm số điện thoại +84 để check-in thủ công",()=>{
  render(<OfflineDashboardClient data={data()}/>);
  fireEvent.change(screen.getByLabelText("Tìm tên hoặc số điện thoại"),{target:{value:"+84 901 234 567"}});
  expect(screen.getByRole("button",{name:"Mentee A"})).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Tìm tên hoặc số điện thoại"),{target:{value:"0999999999"}});
  expect(screen.queryByRole("button",{name:"Mentee A"})).toBeNull();
});
it("sửa kết quả cũ cần bấm edit và nhập lý do",()=>{
  const existing=data();existing.candidates[0].operation!.outcome="passed";
  render(<OfflineDashboardClient data={existing} initialApplication="app"/>);
  expect(screen.queryByLabelText("Nhận xét")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Sửa kết quả / lựa chọn mentee"}));
  expect((screen.getByLabelText("Lý do sửa kết quả") as HTMLTextAreaElement).required).toBe(true);
});
it("Support lưu phân bàn kèm đánh dấu phỏng vấn ONLINE và ghi chú",async()=>{
  const support=data();support.actorId="support";support.canOperate=true;
  render(<OfflineDashboardClient data={support} initialApplication="app"/>);
  fireEvent.change(screen.getByLabelText("Phòng"),{target:{value:"1"}});
  fireEvent.change(screen.getByLabelText("Bàn"),{target:{value:"1"}});
  fireEvent.change(screen.getByLabelText("Người phỏng vấn"),{target:{value:"mentor"}});
  fireEvent.click(screen.getByLabelText(/Phỏng vấn ONLINE/));
  fireEvent.change(screen.getByLabelText(/Ghi chú online/),{target:{value:"Link Zoom ABC"}});
  fireEvent.click(screen.getByRole("button",{name:"Lưu phân bàn"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({applicationId:"app",action:"assign",revision:2,
    values:{room:1,desk:1,interviewerId:"mentor",reason:"",isOnline:true,onlineNote:"Link Zoom ABC"}}));
});
it("huy hiệu ONLINE và ghi chú hiện khi op.is_online — ứng viên offline thì không",()=>{
  const online=data();online.candidates[0].operation!.is_online=true;online.candidates[0].operation!.online_note="Link Zoom ABC";
  render(<OfflineDashboardClient data={online} initialApplication="app"/>);
  expect(screen.getByText("Phỏng vấn ONLINE")).toBeTruthy();
  expect(screen.getByText(/Ghi chú online: Link Zoom ABC/)).toBeTruthy();
});
it("Support huỷ lịch đăng ký khi chưa check-in — bắt buộc nhập lý do qua prompt",async()=>{
  const notYet=data();notYet.actorId="support";notYet.canOperate=true;notYet.candidates[0].operation!.checked_in_at=null;
  vi.spyOn(window,"prompt").mockReturnValue("Trùng lịch phỏng vấn khác");
  render(<OfflineDashboardClient data={notYet} initialApplication="app"/>);
  fireEvent.click(screen.getByRole("button",{name:"Huỷ lịch đăng ký"}));
  await waitFor(()=>expect(mocks.cancel).toHaveBeenCalledWith({applicationId:"app",reason:"Trùng lịch phỏng vấn khác"}));
  expect(mocks.refresh).toHaveBeenCalled();
});
it("đã check-in thì không còn nút huỷ lịch đăng ký",()=>{
  const support=data();support.actorId="support";support.canOperate=true;
  render(<OfflineDashboardClient data={support} initialApplication="app"/>);
  expect(screen.queryByRole("button",{name:"Huỷ lịch đăng ký"})).toBeNull();
});
it("quét QR ứng viên chưa check-in: tự động check-in, KHÔNG qua window.confirm",async()=>{
  const confirmSpy=vi.spyOn(window,"confirm");
  const unchecked=data();unchecked.canOperate=true;unchecked.candidates[0].operation!.checked_in_at=null as never;
  mocks.lookup.mockResolvedValue({ok:true,message:"Đã tìm thấy vé. Kiểm tra thông tin rồi check-in.",applicationId:"app"});
  render(<OfflineDashboardClient data={unchecked}/>);
  await act(async()=>{await mocks.onCode!("VAM-PV:token");});
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({applicationId:"app",action:"checkin",revision:2,values:{}}));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalled();
  expect(await screen.findByText("Đã tự động check-in Mentee A.")).toBeTruthy();
});
it("quét QR ứng viên đã check-in rồi: không gọi lại checkin",async()=>{
  const checked=data();checked.canOperate=true;
  mocks.lookup.mockResolvedValue({ok:true,message:"Đã tìm thấy vé. Kiểm tra thông tin rồi check-in.",applicationId:"app"});
  render(<OfflineDashboardClient data={checked}/>);
  await act(async()=>{await mocks.onCode!("VAM-PV:token");});
  expect(mocks.save).not.toHaveBeenCalled();
  expect(await screen.findByText(/đã check-in trước đó lúc/)).toBeTruthy();
});
it("quét QR ứng viên đã rút hồ sơ: không tự động check-in",async()=>{
  const withdrawn=data();withdrawn.canOperate=true;withdrawn.candidates[0].status="withdrawn";withdrawn.candidates[0].operation!.checked_in_at=null as never;
  mocks.lookup.mockResolvedValue({ok:true,message:"Đã tìm thấy vé. Kiểm tra thông tin rồi check-in.",applicationId:"app"});
  render(<OfflineDashboardClient data={withdrawn}/>);
  await act(async()=>{await mocks.onCode!("VAM-PV:token");});
  expect(mocks.save).not.toHaveBeenCalled();
  expect(await screen.findByText(/đã rút, không check-in được/)).toBeTruthy();
});
it("nút Xác nhận check-in thủ công vẫn qua window.confirm — không bị đổi bởi luồng QR",()=>{
  const confirmSpy=vi.spyOn(window,"confirm").mockReturnValue(true);
  const unchecked=data();unchecked.canOperate=true;unchecked.candidates[0].operation!.checked_in_at=null as never;
  render(<OfflineDashboardClient data={unchecked} initialApplication="app"/>);
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận check-in"}));
  expect(confirmSpy).toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith({applicationId:"app",action:"checkin",revision:2,values:{}});
});
