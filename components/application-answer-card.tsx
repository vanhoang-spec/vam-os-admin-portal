"use client";

import { useState } from "react";
import { displayText } from "@/lib/utils";

const LONG_ANSWER_LIMIT = 800;

export function ApplicationAnswerCard({
  questionLabel,
  questionKey,
  valueText
}: {
  questionLabel: unknown;
  questionKey?: unknown;
  valueText: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const answer = displayText(valueText);
  const isLong = answer.length > LONG_ANSWER_LIMIT;
  const visibleAnswer = isLong && !expanded ? `${answer.slice(0, LONG_ANSWER_LIMIT).trimEnd()}...` : answer;

  return (
    <div className="rounded-md border border-vam-line bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-vam-ink">{displayText(questionLabel)}</h3>
        {displayText(questionKey) !== "-" ? (
          <span className="rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-slate-500">{displayText(questionKey)}</span>
        ) : null}
      </div>
      <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{visibleAnswer}</div>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-3 rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-medium text-vam-green hover:bg-vam-mint"
        >
          {expanded ? "Thu gọn" : "Xem đầy đủ"}
        </button>
      ) : null}
    </div>
  );
}
