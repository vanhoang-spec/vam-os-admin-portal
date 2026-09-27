import {NextResponse} from "next/server";
import {getMentorInterviewResults} from "@/lib/mentor-interview-results";
import {mentorResultsPdf,mentorResultsXlsx} from "@/lib/mentor-interview-results-export";
import {privateExportHeaders} from "@/lib/application-export-access";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request) {
  const format=new URL(request.url).searchParams.get("format");
  if(format!=="pdf"&&format!=="xlsx") return new NextResponse("Chọn định dạng pdf hoặc xlsx.",{status:400,headers:privateExportHeaders()});
  const result=await getMentorInterviewResults(true);
  if(!result.ok) return new NextResponse(result.message,{status:result.status,headers:privateExportHeaders()});
  try {
    const bytes=format==="pdf"?await mentorResultsPdf(result.data):mentorResultsXlsx(result.data);
    return new NextResponse(new Uint8Array(bytes),{headers:privateExportHeaders(format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",`ket-qua-phong-van-mentor-S12.${format}`)});
  } catch {return new NextResponse("Không tạo được file. Vui lòng thử lại.",{status:500,headers:privateExportHeaders()});}
}
