/**
 * collector.js — runs inside the group page the organiser is already looking at.
 *
 * This is the part that reads Facebook, so it is written defensively.
 *
 * IT COLLECTS WHILE IT SCROLLS. The feed is virtualised: Facebook removes a
 * post's markup once it is far enough above the viewport. Scrolling to the
 * bottom first and reading afterwards returns the last screen and nothing else,
 * which is the failure mode the previous tool never noticed.
 *
 * IT ASKS FOR THE WHOLE POST. Every article gets its "Xem thêm" clicked before
 * the text is read, because a recap is long and the collapsed version stops
 * mid-sentence.
 *
 * IT FINDS THINGS BY ROLE, NOT BY POSITION. Selectors are `div[role="article"]`
 * and "a link whose href is a group post", not a 24-level absolute XPath. When
 * Facebook reshuffles its markup — and it will — role-based selectors usually
 * survive; positional ones never do.
 *
 * Nothing here is sent anywhere. The collector writes what it found to the
 * extension's own storage; the popup decides what to do with it.
 */

(() => {
  // Injected twice (the organiser pressed the button twice) — keep the first.
  if (window.__vamRecapCollectorReady) return;
  window.__vamRecapCollectorReady = true;

  const POST_HREF = /\/groups\/([^/]+)\/(posts|permalink)\/([^/?#]+)/;
  const SEE_MORE = /^(xem thêm|see more|hiển thị thêm)$/i;

  /** Stop after this many scrolls no matter what, so a bad run ends. */
  const MAX_SCROLLS = 400;
  /** Consecutive scrolls that added nothing before we call it done. */
  const IDLE_LIMIT = 8;
  /** Posts older than the period before we stop — a few, not one, since the feed can misorder. */
  const OLD_LIMIT = 12;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizePermalink(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      return null;
    }
    const match = url.pathname.match(POST_HREF);
    if (!match) return null;
    // Query and fragment are tracking noise; the app dedupes on this string.
    return `https://www.facebook.com/groups/${match[1]}/${match[2]}/${match[3]}`;
  }

  /** The outermost articles: a comment is also role="article". */
  function topLevelArticles() {
    return Array.from(document.querySelectorAll('div[role="article"]')).filter(
      (node) => !node.parentElement?.closest('div[role="article"]')
    );
  }

  function findPermalink(article) {
    for (const anchor of Array.from(article.querySelectorAll("a[href]"))) {
      const permalink = normalizePermalink(anchor.getAttribute("href"));
      if (permalink) return { permalink, anchor };
    }
    return null;
  }

  /**
   * The author's name.
   *
   * The first profile link inside the post's header — before the permalink
   * anchor, which is the timestamp. Deliberately not a heuristic on text
   * length: an empty name is better than a confident wrong one.
   */
  function findAuthorName(article) {
    const heading = article.querySelector("h2, h3, h4");
    const scope = heading ?? article;
    for (const anchor of Array.from(scope.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? "";
      if (POST_HREF.test(href)) break; // reached the timestamp; the name came first
      const text = (anchor.textContent ?? "").trim();
      if (text && text.length <= 80 && !/^https?:/i.test(text)) return text;
    }
    return null;
  }

  /** What Facebook prints where the time goes: "3 giờ", "Hôm qua", "14 Tháng 3". */
  function findPostedLabel(article, anchor) {
    const candidates = [
      anchor?.getAttribute("aria-label"),
      anchor?.textContent,
      article.querySelector("abbr")?.getAttribute("title")
    ];
    for (const value of candidates) {
      const text = (value ?? "").trim();
      if (text) return text.slice(0, 120);
    }
    return null;
  }

  /** Click "Xem thêm" inside one post, so the text below is the whole text. */
  async function expand(article) {
    const buttons = Array.from(article.querySelectorAll('div[role="button"], span[role="button"]'));
    let clicked = false;
    for (const button of buttons) {
      if (SEE_MORE.test((button.textContent ?? "").trim())) {
        try {
          button.click();
          clicked = true;
        } catch {
          // A button that refuses to be clicked is not worth failing the run over.
        }
      }
    }
    if (clicked) await sleep(120);
  }

  /**
   * The post's text, without the chrome around it.
   *
   * Reading innerText off the whole article picks up the reaction counts and
   * the comment box, so the message body is preferred when it can be
   * identified, and the article is the fallback.
   */
  function readContent(article) {
    const body =
      article.querySelector('div[data-ad-comet-preview="message"]') ??
      article.querySelector('div[data-ad-preview="message"]') ??
      article.querySelector('div[dir="auto"][style*="text-align"]');

    const text = ((body ?? article).innerText ?? "").replace(/\r\n/g, "\n").trim();
    return text.slice(0, 20000);
  }

  // ── Dates ──────────────────────────────────────────────────────────────────

  function vnDate(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  /**
   * Resolve a Vietnamese relative timestamp to a calendar day.
   *
   * Accurate to the day, which is what the reporting needs. A post right on the
   * boundary of a period may land on either side; the app dedupes on the
   * permalink, so collecting it twice costs nothing.
   */
  function labelToDate(label) {
    const raw = (label ?? "").toLowerCase().trim();
    if (!raw) return null;
    const now = new Date();
    const shift = (days) => vnDate(new Date(now.getTime() - days * 86400000));

    const dmy = raw.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (dmy) {
      let year = Number(dmy[3]);
      if (year < 100) year += 2000;
      return `${year}-${String(Number(dmy[2])).padStart(2, "0")}-${String(Number(dmy[1])).padStart(2, "0")}`;
    }

    const named = raw.match(/(\d{1,2})\s*tháng\s*(\d{1,2})(?:[,\s]+(\d{4}))?/);
    if (named) {
      const year = named[3] ? Number(named[3]) : Number(vnDate(now).slice(0, 4));
      return `${year}-${String(Number(named[2])).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`;
    }

    if (/vừa xong|vài giây|\d+\s*phút|\d+\s*giờ|hôm nay/.test(raw)) return shift(0);
    if (/hôm qua/.test(raw)) return shift(1);

    const days = raw.match(/(\d+)\s*ngày/);
    if (days) return shift(Number(days[1]));

    const weeks = raw.match(/(\d+)\s*tuần/);
    if (weeks) return shift(Number(weeks[1]) * 7);

    return null;
  }

  // ── The run ────────────────────────────────────────────────────────────────

  async function collect({ periodStart, periodEnd }) {
    const found = new Map();
    let idle = 0;
    let tooOld = 0;
    let scrolls = 0;

    const report = (phase) =>
      chrome.runtime
        .sendMessage({ type: "vam-progress", phase, count: found.size, scrolls })
        .catch(() => {
          // The popup was closed. The run continues; storage keeps the result.
        });

    while (scrolls < MAX_SCROLLS && idle < IDLE_LIMIT && tooOld < OLD_LIMIT) {
      const before = found.size;

      for (const article of topLevelArticles()) {
        const link = findPermalink(article);
        if (!link || found.has(link.permalink)) continue;

        await expand(article);

        const label = findPostedLabel(article, link.anchor);
        const postedDate = labelToDate(label);

        // Older than the window: count it, but keep reading — the feed is not
        // perfectly ordered, and one old post does not mean the rest are.
        if (postedDate && periodStart && postedDate < periodStart) {
          tooOld++;
          continue;
        }
        if (postedDate && periodEnd && postedDate > periodEnd) continue;

        found.set(link.permalink, {
          permalink: link.permalink,
          author_name: findAuthorName(article),
          posted_label: label,
          posted_date: postedDate,
          content: readContent(article)
        });
        tooOld = 0;
      }

      idle = found.size > before ? 0 : idle + 1;
      scrolls++;
      report("scrolling");

      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      await sleep(650);
    }

    const items = Array.from(found.values());
    const groupId = (window.location.pathname.match(/\/groups\/([^/]+)/) ?? [])[1] ?? null;

    await chrome.storage.local.set({
      lastScan: {
        group_id: groupId,
        period_start: periodStart ?? null,
        period_end: periodEnd ?? null,
        collected_at: new Date().toISOString(),
        items
      }
    });

    report("done");
    return { ok: true, count: items.length, groupId };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vam-collect") return undefined;
    collect(message).then(sendResponse, (error) =>
      sendResponse({ ok: false, message: String(error?.message ?? error) })
    );
    return true; // the answer comes later
  });
})();
