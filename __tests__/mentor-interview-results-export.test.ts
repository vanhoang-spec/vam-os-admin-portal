import {expect,it,vi,beforeEach} from "vitest";
import PizZip from "pizzip";
import {mentorReport} from "./support/mentor-result-fixture";
import {mentorResultsPdf,mentorResultsPdfContent,mentorResultsXlsx} from "@/lib/mentor-interview-results-export";
const mocks=vi.hoisted(()=>({load:vi.fn()}));
vi.mock("react",async(importOriginal)=>({...await importOriginal<typeof import("react")>(),cache:(fn:unknown)=>fn}));
vi.mock("@/lib/mentor-interview-results",()=>({getMentorInterviewResults:mocks.load}));
import {GET} from "@/app/api/exports/mentor-interviews/route";
beforeEach(()=>vi.clearAllMocks());
it("XLSX stores Vietnamese notes and phone as text, never executable formulas",()=>{
  const data=mentorReport();data.rows[0].reviewer_note='=HYPERLINK("https://example.test")\nÝ kiến & nhận xét <core>';
  const zip=new PizZip(mentorResultsXlsx(data));
  const sheet=zip.file("xl/worksheets/sheet1.xml")!.asText();
  expect(zip.file("xl/workbook.xml")!.asText()).toContain("Phong van Mentor S12");
  expect(sheet).toContain('t="inlineStr"');expect(sheet).toContain('0900000000');
  expect(sheet).toContain('=HYPERLINK(&quot;https://example.test&quot;)');expect(sheet).not.toContain('<f>');
  expect(sheet).toContain('Ý kiến &amp; nhận xét &lt;core&gt;');
  expect(sheet).toContain('Cần ưu tiên khả năng đồng hành đều đặn.');
});
it("long Excel comments continue across rows without losing text",()=>{
  const data=mentorReport();data.rows[0].reviewer_note='a'.repeat(32768)+'CUỐI GHI CHÚ';
  const sheet=new PizZip(mentorResultsXlsx(data)).file("xl/worksheets/sheet1.xml")!.asText();
  expect(sheet).toContain('r="A3"');expect(sheet).toContain('CUỐI GHI CHÚ');
  expect(sheet).not.toContain('a'.repeat(30001));
});
it("PDF includes all notes and BTC decisions, produces an actual PDF",async()=>{
  const data=mentorReport();data.rows[0].reviewer_note+='\n'+"Ghi chú dài cần lưu đầy đủ. ".repeat(200)+'KẾT THÚC NHẬN XÉT';
  expect(JSON.stringify(mentorResultsPdfContent(data))).toContain('KẾT THÚC NHẬN XÉT');
  expect(JSON.stringify(mentorResultsPdfContent(data))).toContain('Cần ưu tiên khả năng đồng hành đều đặn');
  const pdf=await mentorResultsPdf(data);expect(pdf.subarray(0,4).toString()).toBe('%PDF');
  // Optional local visual QA artifact, only fake data.
  if(process.env.MENTOR_EXPORT_QA==='1') {
    const {writeFileSync,mkdirSync}=await import('node:fs');mkdirSync('tmp/mentor-export',{recursive:true});
    writeFileSync('tmp/mentor-export/results.pdf',pdf);writeFileSync('tmp/mentor-export/results.xlsx',mentorResultsXlsx(data));
  }
},15000);
it("download route reauthorizes and sets private attachment headers",async()=>{
  mocks.load.mockResolvedValue({ok:true,data:mentorReport()});
  const response=await GET(new Request('https://test/api/exports/mentor-interviews?format=xlsx'));
  expect(mocks.load).toHaveBeenCalledWith(true);expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-disposition')).toContain('.xlsx');
  expect(new PizZip(await response.arrayBuffer()).file('xl/workbook.xml')).toBeTruthy();
});
it("denied scope is not exported; bad format does not load private data",async()=>{
  mocks.load.mockResolvedValue({ok:false,status:403,message:'Không có quyền'});
  expect((await GET(new Request('https://test/api/exports/mentor-interviews?format=pdf'))).status).toBe(403);
  mocks.load.mockClear();expect((await GET(new Request('https://test/api/exports/mentor-interviews?format=csv'))).status).toBe(400);
  expect(mocks.load).not.toHaveBeenCalled();
});
