import { Card } from "@/components/ui";

export default function PersonDetailLoading() {
  return (
    <div className="grid gap-4">
      <Card>
        <div className="h-5 w-48 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              <div className="mt-2 h-7 w-12 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </Card>
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <div className="h-5 w-36 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-24 animate-pulse rounded bg-slate-100" />
        </Card>
      ))}
    </div>
  );
}
