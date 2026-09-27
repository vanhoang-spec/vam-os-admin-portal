import {redirect} from "next/navigation";
import {PageHeader,ErrorBox} from "@/components/ui";
import {getMentorInterviewResults} from "@/lib/mentor-interview-results";
import {MentorResultsClient} from "./results-client";
export const dynamic="force-dynamic";
export default async function MentorResultsPage() {
  const result=await getMentorInterviewResults();
  if(!result.ok&&result.status===401) redirect("/login");
  return <>
    <PageHeader title="Kết quả phỏng vấn mentor S12" description="Xem lại application, điểm và nhận xét sau khi lưu, kể cả hồ sơ đã duyệt, không phù hợp hoặc đang chờ quyết định."/>
    {result.ok?<MentorResultsClient data={result.data}/>:<ErrorBox message={result.message}/>}
  </>;
}
