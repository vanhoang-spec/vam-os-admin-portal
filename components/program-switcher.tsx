"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { IntakeBatchCatalogRow, ProgramCatalogRow, SeasonCatalogRow } from "@/lib/program-context-core";

export type ProgramSwitcherOptions = {
  programs: ProgramCatalogRow[];
  seasons: SeasonCatalogRow[];
  intakeBatches: IntakeBatchCatalogRow[];
  canViewPortfolio: boolean;
};

function routeProgramCode(pathname: string, queryProgram: string | null) {
  const match = pathname.match(/^\/programs\/([^/]+)/);
  return decodeURIComponent(match?.[1] ?? queryProgram ?? "").toUpperCase();
}

export function ProgramSwitcher({ options }: { options: ProgramSwitcherOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedProgramCode = routeProgramCode(pathname, searchParams.get("program"));
  const selectedProgram = options.programs.find((program) => program.code.toUpperCase() === selectedProgramCode);
  const selectedSeasonCode = searchParams.get("season") ?? "";
  const selectedSeason = options.seasons.find(
    (season) => season.programId === selectedProgram?.id && season.code === selectedSeasonCode
  );
  const selectedBatchId = searchParams.get("batch") ?? "";
  const seasons = useMemo(
    () => options.seasons.filter((season) => season.programId === selectedProgram?.id),
    [options.seasons, selectedProgram?.id]
  );
  const batches = useMemo(
    () => options.intakeBatches.filter((batch) => batch.seasonId === selectedSeason?.id),
    [options.intakeBatches, selectedSeason?.id]
  );

  function openProgram(code: string) {
    if (code === "__all__") {
      router.push("/portfolio");
      return;
    }
    if (pathname === "/portfolio" || pathname === "/admin/users") {
      router.push(`${pathname}?${new URLSearchParams({ program: code }).toString()}`);
      return;
    }
    router.push(`/programs/${encodeURIComponent(code)}`);
  }

  function openSeason(code: string) {
    if (!selectedProgram) return;
    const query = new URLSearchParams({ program: selectedProgram.code });
    if (code) query.set("season", code);
    const destination = pathname === "/portfolio" || pathname === "/admin/users"
      ? pathname
      : `/programs/${encodeURIComponent(selectedProgram.code)}`;
    router.push(`${destination}?${query.toString()}`);
  }

  function openBatch(id: string) {
    if (!selectedProgram || !selectedSeason) return;
    const query = new URLSearchParams({ season: selectedSeason.code });
    if (id) query.set("batch", id);
    router.push(`/programs/${encodeURIComponent(selectedProgram.code)}?${query.toString()}`);
  }

  const selectClass = "h-9 min-w-0 rounded-md border border-vam-line bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vam-green";

  return (
    <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto" aria-label="Phạm vi chương trình">
      <label className="min-w-0 text-xs font-medium text-slate-500">
        <span className="sr-only">Chương trình hiện tại</span>
        <select
          aria-label="Chọn chương trình"
          value={selectedProgram?.code ?? (pathname === "/portfolio" ? "__all__" : "")}
          onChange={(event) => openProgram(event.target.value)}
          className={selectClass}
        >
          <option value="" disabled>Chọn chương trình</option>
          {options.canViewPortfolio ? <option value="__all__">Tất cả chương trình</option> : null}
          {options.programs.map((program) => <option key={program.id} value={program.code}>{program.name}</option>)}
        </select>
      </label>

      <label className="min-w-0 text-xs font-medium text-slate-500">
        <span className="sr-only">Season hiện tại</span>
        <select
          aria-label="Chọn season"
          value={selectedSeason?.code ?? ""}
          onChange={(event) => openSeason(event.target.value)}
          disabled={!selectedProgram}
          className={selectClass}
        >
          <option value="">Tất cả season</option>
          {seasons.map((season) => <option key={season.id} value={season.code}>{season.name}</option>)}
        </select>
      </label>

      <label className="min-w-0 text-xs font-medium text-slate-500">
        <span className="sr-only">Đợt tuyển hiện tại</span>
        <select
          aria-label="Chọn đợt tuyển"
          value={batches.some((batch) => batch.id === selectedBatchId) ? selectedBatchId : ""}
          onChange={(event) => openBatch(event.target.value)}
          disabled={!selectedSeason}
          className={selectClass}
        >
          <option value="">Tất cả đợt tuyển</option>
          {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
        </select>
      </label>
    </div>
  );
}
