export default function ProgramWorkspaceLoading() {
  return (
    <div aria-busy="true" aria-label="Đang tải workspace chương trình" className="space-y-4">
      <div className="h-16 animate-pulse rounded-md bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-md bg-slate-200" />)}
      </div>
    </div>
  );
}
