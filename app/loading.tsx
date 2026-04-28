import { Card } from "@/components/ui";

export default function Loading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index}>
          <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
          <div className="mt-3 h-8 w-16 animate-pulse rounded bg-slate-100" />
        </Card>
      ))}
    </div>
  );
}
