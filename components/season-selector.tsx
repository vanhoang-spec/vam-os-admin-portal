"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getSeasonSelectorState,
  setSeasonContextAction,
  type SeasonSelectorState
} from "@/app/actions/season-context";

const EMPTY_STATE: SeasonSelectorState = {
  ok: false,
  selectedSeasonCode: null,
  seasons: []
};

export function SeasonSelector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [state, setState] = useState<SeasonSelectorState>(EMPTY_STATE);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(search);
    const values = params.getAll("season");
    const explicitSeason = values.length === 0 ? undefined : values.length === 1 ? values[0] : values;
    getSeasonSelectorState(explicitSeason).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [search]);

  if (!state.ok || !state.selectedSeasonCode || state.seasons.length === 0) return null;

  const returnTo = search ? `${pathname}?${search}` : pathname;
  return (
    <form action={setSeasonContextAction} className="flex items-center gap-2">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label htmlFor="operating-season" className="text-xs font-medium text-slate-500">
        Mùa vận hành
      </label>
      <select
        id="operating-season"
        name="season"
        aria-label="Chọn mùa vận hành"
        value={state.selectedSeasonCode}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-md border border-vam-line bg-white px-2 text-sm font-medium text-vam-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vam-green"
      >
        {state.seasons.map((season) => (
          <option key={season.id} value={season.code}>{season.label}</option>
        ))}
      </select>
    </form>
  );
}

