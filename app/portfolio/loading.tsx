import { Card } from "@/components/ui";

export default function PortfolioLoading() {
  return (
    <div aria-busy="true" aria-label="Đang tải danh mục chương trình" className="space-y-6">
      <div className="h-16 animate-pulse rounded-md bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-md bg-slate-200" />)}
      </div>
      <Card><div className="h-64 animate-pulse rounded-md bg-slate-100" /></Card>
    </div>
  );
}
