# VAM Recap Collector

A Chrome extension that reads recap posts from the programme's Facebook group and
sends them to VAM OS, where an organiser approves them into `mentoring_recaps`.

## Why it exists, and why it works this way

Meta closed the Groups API, and group-admin rights do not unlock an export. The
only remaining route is the page a person is already allowed to look at — so the
extension reads the feed the organiser has open, in their own browser, under
their own login. Nothing about Facebook is automated on a server: no stored
session, no headless login, no unattended crawling. That was a deliberate
decision, not a limitation to be worked around later.

Season 11 is the reason this exists at all. Of the 286 recaps imported then, 258
carry the placeholder URL `system.local/missing-url` — the group was never the
system of record, a tracking spreadsheet was. Capturing the permalink is the
point of the whole path.

## What it collects

For every post in the chosen window: the full text (it clicks "Xem thêm" first),
the author's name, the timestamp, and the permalink. VAM OS parses the first
lines server-side for the student id, the meeting-type hashtag, the topic, and
the mentor/mentee names.

## Install (no build step)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose this folder.
3. Open the extension's **Cài đặt** and fill in:
   - the VAM OS address (`https://…`),
   - the connection code (`VAM_OS_RECAP_IMPORT_TOKEN`, from the super admin),
   - the group ids, comma-separated.
   Saving asks Chrome for permission to talk to that one address.

## Each period

1. Open the group and switch it to **Mới nhất** (the popup offers a button).
2. Click the extension, pick the period, press **Quét bài trong kỳ**. Leave the
   popup open while it scrolls.
3. Press **Gửi vào VAM OS**, then review at `/operations/recap-import`.

Scanning an overlapping window is harmless: `recap_import_items.permalink` is
unique, so a post already collected is dropped on arrival. If a period was
missed, widen the range rather than worrying about it.

## When Facebook changes its markup

It will. The selectors are role-based (`div[role="article"]`, "a link whose href
is a group post") rather than absolute XPaths, which survives most reshuffles —
but not all. Everything that touches the DOM lives in `collector.js`, in named
functions: `topLevelArticles`, `findPermalink`, `findAuthorName`,
`findPostedLabel`, `readContent`. A broken run is usually one of those five.

The symptom to watch for is a scan that finds zero posts on a group that plainly
has them, or posts arriving with empty content. Both mean a selector, not the
server.

## What is deliberately not here

- **No `.pem` key.** The predecessor tool committed its signing key; this one is
  loaded unpacked and has none to leak.
- **No hardcoded group id.** Groups are configuration, because there are two
  programmes.
- **No scrolling-then-reading.** The feed is virtualised — posts are collected
  during the scroll, or they are lost.
