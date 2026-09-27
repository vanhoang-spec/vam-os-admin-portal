// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {MentorResultsClient} from "@/app/interviews/ket-qua-mentor/results-client";
import {mentorReport} from "./support/mentor-result-fixture";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
afterEach(cleanup);
it("saved rejected mentor retains full notes and application link",()=>{
  render(<MentorResultsClient data={mentorReport()}/>);
  expect(screen.getByText(/Chưa phù hợp mùa này/)).toBeTruthy();
  expect(screen.getByText(/Cần ưu tiên khả năng đồng hành đều đặn/)).toBeTruthy();
  expect(screen.getByRole("link",{name:"Xem application"}).getAttribute("href")).toBe("/applications/a1");
  expect(screen.getByRole("link",{name:"Xuất Excel toàn bộ S12"}).getAttribute("href")).toBe("/api/exports/mentor-interviews?format=xlsx");
});
it("filtering the page does not narrow whole-season exports",()=>{
  render(<MentorResultsClient data={mentorReport()}/>);
  fireEvent.change(screen.getByLabelText("Tìm mentor hoặc interviewer"),{target:{value:"not-found"}});
  expect(screen.queryByRole("link",{name:"Xem application"})).toBeNull();
  expect(screen.getByRole("link",{name:"Xuất PDF toàn bộ S12"}).getAttribute("href")).toBe("/api/exports/mentor-interviews?format=pdf");
});
it("reviewer uses own authorized review to open application and cannot export all",()=>{
  const data=mentorReport();data.isReviewer=true;data.canExport=false;data.decisions=[];
  render(<MentorResultsClient data={data}/>);
  expect(screen.getByRole("link",{name:"Xem application"}).getAttribute("href")).toBe("/reviews/r1");
  expect(screen.queryByRole("link",{name:"Xuất Excel toàn bộ S12"})).toBeNull();
  expect(screen.queryByText("Quyết định và ghi chú BTC")).toBeNull();
});
