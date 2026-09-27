import "server-only";
import PizZip from "pizzip";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type {Content,TDocumentDefinitions} from "pdfmake/interfaces";
import {MENTOR_RESULT_HEADERS,mentorResultCells,decisionText,RESULT_SCORE_FIELDS,type MentorResultsData} from "@/lib/mentor-interview-results-core";
import {formatDateTime} from "@/lib/utils";
import {applicationStatusLabel} from "@/lib/ui-labels";
import {recommendationLabel,reviewStatusLabel} from "@/lib/screening-decision";

const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function col(n:number):string {return n<26?String.fromCharCode(65+n):col(Math.floor(n/26)-1)+col(n%26);}
/** XLSX thật; inlineStr không diễn giải nhận xét bắt đầu bằng = thành công thức. */
export function mentorResultsXlsx(data:MentorResultsData):Buffer {
  const zip=new PizZip();
  const ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rows:(string|number)[][]=[MENTOR_RESULT_HEADERS];
  for(const result of data.rows) {
    const cells=mentorResultCells(data,result);
    // Excel giới hạn một ô 32767 ký tự. Nối tiếp sang dòng mới, không cắt mất ghi chú.
    const parts=cells.map(c=>typeof c==="string"&&c.length>30000?Array.from({length:Math.ceil(c.length/30000)},(_,i)=>c.slice(i*30000,(i+1)*30000)):[c]);
    const count=Math.max(...parts.map(p=>p.length));
    for(let i=0;i<count;i++) rows.push(parts.map(p=>p.length===1?p[0]:p[i]??""));
  }
  zip.file("[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file("_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml",`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Phong van Mentor S12" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("xl/styles.xml",`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml",`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${MENTOR_RESULT_HEADERS.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="${i===17||i===18?65:i===1||i===2||i===5?28:20}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((cells,i)=>`<row r="${i+1}">${cells.map((value,j)=>typeof value==="number"?`<c r="${col(j)}${i+1}" s="${i===0?1:0}"><v>${value}</v></c>`:`<c r="${col(j)}${i+1}" s="${i===0?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:T${rows.length}"/></worksheet>`);
  return zip.generate({type:"nodebuffer",compression:"DEFLATE"});
}

export function mentorResultsPdfContent(data:MentorResultsData):Content[] {
  const total=new Set(data.rows.map(r=>r.application_id)).size;
  const content:Content[]=[{text:"KẾT QUẢ PHỎNG VẤN MENTOR MÙA 12",fontSize:18,bold:true,color:"#167c4b"},
    {text:`${total} mentor · ${data.rows.length} phiếu · Xuất lúc ${formatDateTime(data.generatedAt)}`,margin:[0,8,0,8]},
    {text:"Bao gồm phiếu đã nộp và đang lưu nháp. Đề xuất phỏng vấn khác với quyết định BTC; trạng thái hồ sơ là trạng thái tại thời điểm xuất.",fontSize:9,color:"#475569",margin:[0,0,0,18]}];
  data.rows.forEach((r,i)=>{
    content.push({text:`${i+1}. ${r.application.full_name||"Mentor"}`,fontSize:15,bold:true,color:"#0f5132",pageBreak:i>0?"before":undefined},
      {text:`${r.application.email_primary||"—"} · ${r.application.phone_primary||"—"}\nMã hồ sơ: ${r.application_id}\nTrạng thái hiện tại: ${applicationStatusLabel(r.application.status)}`,margin:[0,6,0,10]},
      {text:`Interviewer: ${r.reviewer?.full_name||r.reviewer?.email||"Chưa xác định"}\n${reviewStatusLabel(r.status)} · ${formatDateTime(r.submitted_at||r.updated_at||data.generatedAt)}`,margin:[0,0,0,10]},
      {text:`${RESULT_SCORE_FIELDS.map(([key,label])=>`${label}: ${r[key]??"—"}`).join(" · ")}\nTổng: ${r.total_score??"—"}/25 · Đề xuất: ${recommendationLabel(r.recommendation)}`,margin:[0,0,0,12]},
      {text:"Nhận xét phỏng vấn",bold:true,margin:[0,0,0,4]},
      {text:r.reviewer_note||"Chưa có nhận xét.",margin:[0,0,0,14],lineHeight:1.2},
      {text:"Quyết định và ghi chú BTC",bold:true,margin:[0,0,0,4]},
      {text:decisionText(data,r.application_id)||"Chưa có quyết định được ghi nhận.",lineHeight:1.2},
      {text:`Mã phiếu: ${r.id}`,fontSize:8,color:"#64748b",margin:[0,12,0,0]});
  });
  return content;
}
export async function mentorResultsPdf(data:MentorResultsData):Promise<Buffer> {
  (pdfMake as unknown as {vfs:Record<string,string>}).vfs=pdfFonts as unknown as Record<string,string>;
  const definition:TDocumentDefinitions={pageSize:"A4",pageMargins:[42,42,42,48],defaultStyle:{font:"Roboto",fontSize:10},content:mentorResultsPdfContent(data),
    footer:(page,count)=>({text:`VAM OS · Mentor S12 · Trang ${page}/${count}`,alignment:"center",fontSize:8,margin:[0,16,0,0]})};
  return new Promise((resolve,reject)=>{try{pdfMake.createPdf(definition).getBuffer(b=>resolve(Buffer.from(b)));}catch(e){reject(e);}});
}
