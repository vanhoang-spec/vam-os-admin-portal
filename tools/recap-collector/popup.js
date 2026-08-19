/**
 * popup.js — the three buttons an organiser actually presses.
 *
 * The period is suggested rather than demanded: on or before the 15th it
 * proposes the first half of the month, after that the second, and both dates
 * stay editable. Collecting an overlapping window is free — VAM OS drops a post
 * it has already seen — so the safe move when somebody misses a period is to
 * widen the range, not to worry about it.
 */

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  tab: null,
  groupId: null,
  scan: null
};

// ── Dates ────────────────────────────────────────────────────────────────────

function vnToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The two halves of this month, plus the two of last month for catching up. */
function periodOptions(today) {
  const [year, month, day] = today.split("-").map(Number);
  const mm = String(month).padStart(2, "0");
  const end = lastDay(year, month);

  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const pm = String(previousMonth).padStart(2, "0");
  const previousEnd = lastDay(previousYear, previousMonth);

  const options = [
    {
      id: "current-1",
      label: `Kỳ 1 tháng ${mm}/${year} (01–15)`,
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-15`
    },
    {
      id: "current-2",
      label: `Kỳ 2 tháng ${mm}/${year} (16–${end})`,
      from: `${year}-${mm}-16`,
      to: `${year}-${mm}-${end}`
    },
    {
      id: "previous-2",
      label: `Kỳ 2 tháng ${pm}/${previousYear} (16–${previousEnd})`,
      from: `${previousYear}-${pm}-16`,
      to: `${previousYear}-${pm}-${previousEnd}`
    },
    {
      id: "previous-1",
      label: `Kỳ 1 tháng ${pm}/${previousYear} (01–15)`,
      from: `${previousYear}-${pm}-01`,
      to: `${previousYear}-${pm}-15`
    }
  ];

  // Whichever half we are in now goes first.
  return day <= 15 ? options : [options[1], options[0], options[2], options[3]];
}

// ── Setup ────────────────────────────────────────────────────────────────────

async function loadConfig() {
  const stored = await chrome.storage.sync.get(["appUrl", "token", "groups"]);
  if (!stored.appUrl || !stored.token) return null;
  return {
    appUrl: String(stored.appUrl).replace(/\/+$/, ""),
    token: String(stored.token),
    groups: String(stored.groups ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

function groupIdFromUrl(url) {
  const match = String(url ?? "").match(/facebook\.com\/groups\/([^/?#]+)/);
  return match ? match[1] : null;
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setStatus(message, tone) {
  const node = $("status");
  node.textContent = message ?? "";
  node.className = tone ?? "";
}

async function init() {
  state.config = await loadConfig();
  if (!state.config) {
    show("setup", true);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.groupId = groupIdFromUrl(tab?.url);

  const configured = state.config.groups;
  const known = !configured.length || (state.groupId && configured.includes(state.groupId));

  if (!state.groupId || !known) {
    show("wrong-page", true);
    return;
  }

  // "Phù hợp nhất" hides posts; chronological order is what a sweep needs.
  if (!/sorting_setting=CHRONOLOGICAL/.test(tab.url ?? "")) show("sorting", true);

  const today = vnToday();
  const options = periodOptions(today);
  const select = $("period");
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.id;
    node.textContent = option.label;
    select.append(node);
  }

  const applyPeriod = () => {
    const chosen = options.find((option) => option.id === select.value) ?? options[0];
    $("from").value = chosen.from;
    $("to").value = chosen.to;
  };
  select.addEventListener("change", applyPeriod);
  applyPeriod();

  show("main", true);
}

// ── Actions ──────────────────────────────────────────────────────────────────

$("settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

$("fix-sorting").addEventListener("click", async () => {
  const url = new URL(state.tab.url);
  url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
  await chrome.tabs.update(state.tab.id, { url: url.toString() });
  window.close();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "vam-progress") return;
  $("progress").textContent =
    message.phase === "done"
      ? `Đã quét xong ${message.count} bài.`
      : `Đang cuộn và đọc… ${message.count} bài (lượt ${message.scrolls}).`;
});

$("scan").addEventListener("click", async () => {
  const periodStart = $("from").value;
  const periodEnd = $("to").value;

  $("scan").disabled = true;
  setStatus("");
  $("progress").textContent = "Đang chuẩn bị…";
  show("result", false);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      files: ["collector.js"]
    });

    const response = await chrome.tabs.sendMessage(state.tab.id, {
      type: "vam-collect",
      periodStart,
      periodEnd
    });

    if (!response?.ok) throw new Error(response?.message ?? "Không quét được.");

    const { lastScan } = await chrome.storage.local.get("lastScan");
    state.scan = lastScan;

    $("summary").textContent = `Tìm được ${lastScan.items.length} bài trong kỳ ${periodStart} → ${periodEnd}.`;
    show("result", lastScan.items.length > 0);
    if (!lastScan.items.length) setStatus("Không có bài nào trong khoảng này.", "muted");
  } catch (error) {
    setStatus(
      `Không quét được: ${error.message}. Thử tải lại trang group rồi bấm lại.`,
      "error"
    );
  } finally {
    $("scan").disabled = false;
  }
});

$("send").addEventListener("click", async () => {
  if (!state.scan?.items?.length) return;

  $("send").disabled = true;
  setStatus("Đang gửi…", "muted");

  const target = `${state.config.appUrl}/api/recap-import`;

  try {
    // The app origin is an optional permission, granted on the settings page.
    const origin = `${new URL(state.config.appUrl).origin}/*`;
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (!granted) throw new Error("Chưa được cấp quyền gửi tới địa chỉ VAM OS. Mở Cài đặt và lưu lại.");

    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.config.token}`
      },
      body: JSON.stringify({
        group_id: state.scan.group_id,
        period_start: state.scan.period_start,
        period_end: state.scan.period_end,
        items: state.scan.items
      })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      throw new Error(body.message ?? `Máy chủ trả về lỗi ${response.status}.`);
    }

    setStatus(body.message ?? "Đã gửi.", "ok");
  } catch (error) {
    setStatus(`Không gửi được: ${error.message}`, "error");
  } finally {
    $("send").disabled = false;
  }
});

$("csv").addEventListener("click", () => {
  if (!state.scan?.items?.length) return;

  const columns = ["permalink", "posted_date", "posted_label", "author_name", "content"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [
    columns.join(","),
    ...state.scan.items.map((item) => columns.map((column) => escape(item[column])).join(","))
  ];

  // The BOM is what makes Excel read Vietnamese correctly.
  const blob = new Blob([`﻿${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recap-${state.scan.period_start}-${state.scan.period_end}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

init();
