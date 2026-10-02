// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {OfflineDashboardClient} from "@/app/interviews/mentee-offline/workflow";
import {type OfflineDashboard,type OfflineReview} from "@/lib/mentee-offline-core";
import {EXPECTATION_BRIEF_NOTE,TAKE_CHOICES,type InterviewRubric} from "@/lib/mentee-interview-rubric-core";
import {S12_INTERVIEW_CRITERIA,S12_INTERVIEW_GUIDANCE} from "@/lib/mentee-interview-rubric-s12";
const RUBRIC:InterviewRubric={id:"rubric-1",seasonId:"season",seasonCode:"UEHM-S12",own:true,version:3,handbookVersion:0,
  criteria:S12_INTERVIEW_CRITERIA,guidance:S12_INTERVIEW_GUIDANCE,copiedFromSeasonCode:null,updatedAt:"2026-10-02T00:00:00Z",updatedByName:"BTC",
  hasHandbook:false,handbookHtml:null,handbookFileName:null,handbookUpdatedAt:null,handbookUpdatedByName:null};
const BLANK_REVIEW:OfflineReview={id:"review",review_round:"interview",reviewerName:"Mentor A",status:"submitted",score_motivation:null,score_goal_clarity:null,
  score_commitment:null,score_fit:null,score_communication:null,total_score:null,recommendation:"approve_recommended",reviewer_note:null};
function fillRubricForm() {
  const scores=[5,3,4,2];
  S12_INTERVIEW_CRITERIA.forEach((c,i)=>fireEvent.change(screen.getByLabelText(c.label),{target:{value:String(scores[i])}}));
  // Evidence / Note của mọi tiêu chí bắt buộc (BTC 02/10/2026).
  const notes=["Có development need thật","Nghe góp ý tốt","Tự đặt lịch","Kế hoạch còn chung"];
  S12_INTERVIEW_CRITERIA.forEach((c,i)=>fireEvent.change(screen.getByLabelText(`Evidence / Note — ${c.label}`),{target:{value:notes[i]}}));
  fireEvent.change(screen.getByLabelText("Lý do chọn / không chọn"),{target:{value:"Có động lực"}});
  fireEvent.change(screen.getByLabelText("Nhu cầu phát triển chính"),{target:{value:"Khám phá hướng nghề"}});
  fireEvent.change(screen.getByLabelText("Mức độ phù hợp về kỳ vọng của Mentee"),{target:{value:"aligned"}});
  fireEvent.change(screen.getByLabelText("Concern / Note"),{target:{value:"Đã thống nhất lịch gặp"}});
  fireEvent.change(screen.getByLabelText("Chân dung Mentor phù hợp"),{target:{value:"Thiên về coaching"}});
}
const mocks=vi.hoisted(()=>({save:vi.fn(),lookup:vi.fn(),cancel:vi.fn(),refresh:vi.fn(),onCode:undefined as undefined|((code:string)=>void)}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/app/actions/mentee-offline",()=>({saveOfflineInterviewAction:mocks.save,lookupOfflineTicketAction:mocks.lookup,cancelMenteeBookingAction:mocks.cancel}));
vi.mock("@/app/interviews/mentee-offline/qr-camera",()=>({InterviewQrCamera:({onCode}:{onCode:(code:string)=>void})=>{mocks.onCode=onCode;return null;}}));
function data():OfflineDashboard {return {
  actorId:"mentor",seasonId:"season",canOperate:false,logs:[],rubric:RUBRIC,
  sessions:[{id:"session",starts_at:"2026-10-03T01:00:00Z",ends_at:"2026-10-03T01:30:00Z",venue:"UEH",seat_limit:25}],
  participants:[{id:"mentor",full_name:"Mentor A",email:"mentor@example.test",capacity:1,activeMatches:0}],
  candidates:[{id:"app",name:"Mentee A",phone:"0901234567",email:"a@example.test",status:"interview_in_progress",sessionId:"session",bookedAt:"2026-09-27T01:00Z",rawPayload:null,answers:[["Mục tiêu","Học kỹ năng"]],reviews:[],
    operation:{checked_in_at:"2026-10-03T00:50Z",room:5,desk:5,interviewer_id:"mentor",review_id:"review",outcome:null,match_id:null,revision:2,is_online:false,online_note:null}}]
};}
beforeEach(()=>{vi.clearAllMocks();mocks.onCode=undefined;vi.spyOn(window,"confirm").mockReturnValue(true);mocks.save.mockResolvedValue({ok:true,message:"Đã lưu"});mocks.cancel.mockResolvedValue({ok:true,message:"Đã huỷ"});});
afterEach(cleanup);
it("mentor chấm theo phiếu của mùa: gửi đủ điểm từng tiêu chí, mục A/B/C, id + phiên bản phiếu",async()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  fillRubricForm();
  fireEvent.click(screen.getByLabelText(TAKE_CHOICES.take));
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận kết quả"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({applicationId:"app",action:"result",revision:2,values:{
    outcome:"passed",rubricId:"rubric-1",rubricVersion:3,
    criteria:{need:{score:5,note:"Có development need thật"},readiness:{score:3,note:"Nghe góp ý tốt"},ownership:{score:4,note:"Tự đặt lịch"},follow_through:{score:2,note:"Kế hoạch còn chung"}},
    rationale:"Có động lực",keyNeed:"Khám phá hướng nghề",alignment:"aligned",alignmentNote:"Đã thống nhất lịch gặp",
    takeChoice:"take",desiredMentor:"Thiên về coaching",additionalNote:"",reason:""}}));
  expect(mocks.refresh).toHaveBeenCalled();
});
it("form vẽ đúng các tiêu chí + trọng số của phiếu và KHÔNG hiện tổng điểm cho mentor",()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  const legends=Array.from(document.querySelectorAll("legend")).map(l=>l.textContent);
  S12_INTERVIEW_CRITERIA.forEach((c,i)=>{
    expect(screen.getByLabelText(c.label).tagName).toBe("SELECT");
    expect(legends).toContain(`${i+1}. ${c.label} · trọng số ${c.weight}%`);
  });
  // Soi riêng form chấm: ô chọn ca phía trên cũng có dạng "1/25" (số chỗ).
  const form=screen.getByRole("button",{name:"Xác nhận kết quả"}).closest("form")!;
  expect(form.textContent).not.toContain("/25");
  expect(form.textContent).not.toContain("Tổng điểm");
  expect(form.textContent).not.toContain("quy đổi");
  expect(form.textContent).toContain("Kim chỉ nam: Có cần không?");
});
it("chưa chọn mục C thì không gửi và nói rõ thiếu gì",()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  fillRubricForm();
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận kết quả"}));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("mục C");
});
it("đổi sang Không chọn: khoá CẢ 3 lựa chọn mục C và ô chân dung mentor; gửi không kèm lựa chọn",async()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  const take=screen.getByLabelText(TAKE_CHOICES.take) as HTMLInputElement;
  fireEvent.click(take);expect(take.checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Kết quả"),{target:{value:"rejected"}});
  expect(take.checked).toBe(false);
  for (const label of Object.values(TAKE_CHOICES)) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  const desired=screen.getByLabelText("Chân dung Mentor phù hợp") as HTMLTextAreaElement;
  expect(desired.disabled).toBe(true);expect(desired.required).toBe(false);
  expect((screen.getByLabelText("Lý do chọn / không chọn") as HTMLTextAreaElement).required).toBe(true);
  // Đổi lại Đạt thì mục C mở lại.
  fireEvent.change(screen.getByLabelText("Kết quả"),{target:{value:"passed"}});
  expect((screen.getByLabelText(TAKE_CHOICES.recommend_other) as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Kết quả"),{target:{value:"rejected"}});
  fillRubricForm();
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận kết quả"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0].values).toMatchObject({outcome:"rejected",takeChoice:null,desiredMentor:""});
});
it("sửa phiếu Không chọn cũ (lưu trước 02/10, còn lựa chọn mục C): gửi lại KHÔNG mang lựa chọn đó",async()=>{
  const d=data();
  d.candidates[0].operation={...d.candidates[0].operation!,outcome:"rejected"};
  d.candidates[0].reviews=[{...BLANK_REVIEW,take_choice:"undecided"}];
  render(<OfflineDashboardClient data={d} initialApplication="app"/>);
  fireEvent.click(screen.getByRole("button",{name:"Sửa kết quả / lựa chọn mentee"}));
  fillRubricForm();
  fireEvent.change(screen.getByLabelText("Lý do sửa kết quả"),{target:{value:"Bổ sung ghi chú"}});
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận kết quả"}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0].values).toMatchObject({outcome:"rejected",takeChoice:null,desiredMentor:""});
});
it("Evidence / Note của mọi tiêu chí và Concern / Note là ô bắt buộc; mục B có lưu ý của BTC",()=>{
  render(<OfflineDashboardClient data={data()} initialApplication="app"/>);
  for (const c of S12_INTERVIEW_CRITERIA) expect((screen.getByLabelText(`Evidence / Note — ${c.label}`) as HTMLTextAreaElement).required).toBe(true);
  expect((screen.getByLabelText("Concern / Note") as HTMLTextAreaElement).required).toBe(true);
  const legends=Array.from(document.querySelectorAll("legend")).map(l=>l.textContent);
  expect(legends).toContain("A. Quyết định chọn mentee");
  expect(legends).toContain("B. Sự phù hợp về kỳ vọng của Mentee");
  const form=screen.getByRole("button",{name:"Xác nhận kết quả"}).closest("form")!;
  expect(form.textContent).toContain(EXPECTATION_BRIEF_NOTE);
});
it("đã chọn \"Có – Tôi muốn nhận\" cho 2 hồ sơ khác thì khoá lựa chọn này ở hồ sơ thứ ba",()=>{
  const d=data();
  const taken=(id:string)=>({...d.candidates[0],id,name:`Đã nhận ${id}`,operation:{...d.candidates[0].operation!,review_id:`rv-${id}`,outcome:"passed" as const},
    reviews:[{...BLANK_REVIEW,id:`rv-${id}`,take_choice:"take" as const}]});
  d.candidates.push(taken("x1"));
  // Hồ sơ thứ hai: chỉ một lần nhận → vẫn chọn được.
  const one=render(<OfflineDashboardClient data={d} initialApplication="app"/>);
  expect((screen.getByLabelText(TAKE_CHOICES.take) as HTMLInputElement).disabled).toBe(false);
  one.unmount();
  d.candidates.push(taken("x2"));
  render(<OfflineDashboardClient data={d} initialApplication="app"/>);
  expect((screen.getByLabelText(TAKE_CHOICES.take) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText(TAKE_CHOICES.recommend_other) as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByText(/cho đủ 2 hồ sơ/)).toBeTruthy();
});
it("mentor đầy không nhận thêm; Support xem application nhưng không chấm thay",()=>{
  const full=data();full.participants[0].activeMatches=1;
  const view=render(<OfflineDashboardClient data={full} initialApplication="app"/>);
  expect((screen.getByLabelText(TAKE_CHOICES.take) as HTMLInputElement).disabled).toBe(true);
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
it("sửa kết quả cũ cần bấm edit và nhập lý do sửa; form mở lại đúng điểm đã chấm",()=>{
  const existing=data();existing.candidates[0].operation!.outcome="passed";
  existing.candidates[0].reviews=[{...BLANK_REVIEW,reviewer_note:"Có động lực",take_choice:"recommend_other",
    interview_scores:[{key:"need",label:"Nhu cầu Mentoring & Giá trị phát triển",weight:30,score:5,note:"Rõ nhu cầu"}]}];
  render(<OfflineDashboardClient data={existing} initialApplication="app"/>);
  expect(screen.queryByLabelText("Lý do chọn / không chọn")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Sửa kết quả / lựa chọn mentee"}));
  expect((screen.getByLabelText("Lý do sửa kết quả") as HTMLTextAreaElement).required).toBe(true);
  expect((screen.getByLabelText("Nhu cầu Mentoring & Giá trị phát triển") as HTMLSelectElement).value).toBe("5");
  expect((screen.getByLabelText("Lý do chọn / không chọn") as HTMLTextAreaElement).value).toBe("Có động lực");
  expect((screen.getByLabelText(TAKE_CHOICES.recommend_other) as HTMLInputElement).checked).toBe(true);
});
it("kết quả đã lưu: mentor KHÔNG thấy điểm quy đổi, Support/BTC thấy",()=>{
  const saved=(canOperate:boolean)=>{const d=data();d.canOperate=canOperate;d.actorId=canOperate?"support":"mentor";
    d.candidates[0].operation!.outcome="passed";
    d.candidates[0].reviews=[{...BLANK_REVIEW,reviewer_note:"Có động lực",weighted_score:3.6,key_development_need:"Khám phá hướng nghề",
      expectation_alignment:"aligned",take_choice:"take",desired_mentor_profile:"Thiên về coaching",
      interview_scores:[{key:"need",label:"Nhu cầu Mentoring & Giá trị phát triển",weight:30,score:5,note:null}]}];return d;};
  const view=render(<OfflineDashboardClient data={saved(false)} initialApplication="app"/>);
  expect(screen.getByText(/Nhu cầu Mentoring & Giá trị phát triển:/)).toBeTruthy();
  expect(screen.getByText(/Mentor nhận: Có – Tôi muốn nhận bạn này/)).toBeTruthy();
  expect(screen.queryByText(/Điểm quy đổi/)).toBeNull();
  view.unmount();
  render(<OfflineDashboardClient data={saved(true)} initialApplication="app"/>);
  expect(screen.getByText("3.60/5")).toBeTruthy();
});
it("điểm vòng hồ sơ vẫn theo 5 nhãn cũ; phiếu phỏng vấn nộp trước khi có phiếu theo mùa hiện theo 5 nhãn cũ",()=>{
  const d=data();d.candidates[0].operation!.outcome="passed";
  d.candidates[0].reviews=[
    {...BLANK_REVIEW,id:"screen",review_round:"profile_screening",score_motivation:4,total_score:18,reviewer_note:"Hồ sơ tốt"},
    {...BLANK_REVIEW,score_motivation:4,score_goal_clarity:4,score_commitment:4,score_fit:4,score_communication:4,total_score:20,reviewer_note:"Ổn"}
  ];
  render(<OfflineDashboardClient data={d} initialApplication="app"/>);
  expect(screen.getByText(/Mentor A · 18\/25/)).toBeTruthy();
  expect(screen.getByText("Điểm phỏng vấn (phiếu cũ 5 tiêu chí): 20/25")).toBeTruthy();
});
it("mùa chưa có phiếu chấm: không có form, nói rõ nhờ BTC cài phiếu",()=>{
  const d=data();d.rubric=null;
  render(<OfflineDashboardClient data={d} initialApplication="app"/>);
  expect(screen.queryByRole("button",{name:"Xác nhận kết quả"})).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("chưa có phiếu chấm");
  expect(screen.getByText("Mùa này chưa có phiếu chấm — nhờ BTC cài phiếu")).toBeTruthy();
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
