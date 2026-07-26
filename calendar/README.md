# Calendar

Calendar app for Peergos with recurring events, sharing, and `.ics`
import/export. Built as a standard sandboxed Peergos app (manifest +
`/assets`), not built into `web-ui`.

## Status

UI complete, running on **in-memory mock events** — not yet connected to
real Peergos storage (blocked on `READ_CALENDAR`/`WRITE_CALENDAR`, see Open
items).

- **Recurring events**: `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY`,
  `INTERVAL`/`COUNT`/`UNTIL`, scoped edit/delete (this/following/all).
  Weekly has a day-of-week toggle; monthly has "day N" vs. "Nth weekday".
  `BYMONTHDAY`/`BYMONTH` have no UI.
- **Interaction**: click for a popover (edit/delete/duplicate/export/
  email/share), double-click for edit directly (desktop only), click/tap
  an empty slot to create. Title/location capped at 1024 characters. Long
  text truncates with an ellipsis on the grid, scrolls in the popover.
- **Toolbar**: sidebar toggle, search (title/location/description,
  2-char minimum), "⋯" overflow menu (Import).
- **`.ics` export/import**: RFC 5545, per-event or per-calendar. Bulk
  import with duplicate detection. Unsupported `RRULE` parts simplify to
  plain `FREQ`+`INTERVAL`. `TZID` reads as floating local time; `VALARM`
  is dropped.
- **Email an event**: `mailto:` with a plain-text summary, not the `.ics`
  file.
- **Multiple calendars**: create/rename/delete/recolor, show/hide
  filtering. Primary calendar can't be deleted.
- **Sharing**: an event or non-primary calendar can be shared with a
  username or via a secret link, read-only only. Mock state
  (`mockShares`).
- **Read-only calendars**: a calendar can be marked `readOnly`
  (`isCalendarWritable()`), independent of the whole-app `isWritable`
  flag - drops Edit/Share/Delete for it and its events.
- **Dark mode**: reads Peergos's `?theme=` param once at launch.
- **Navigation**: ISO week numbers, swipe/Previous/Next/Today/search all
  share a slide transition.

## For maintainers

### Architecture decisions

- Sandboxed app, not built into `web-ui`.
- FullCalendar 7.0.2, Standard bundle (MIT) + `@fullcalendar/rrule`.
- Permissions `READ_CALENDAR`/`WRITE_CALENDAR` not yet implemented in
  `peergos` core.
- Sharing uses an existing app-facing API, not confirmed working from a
  sandboxed context yet.
- Search is client-side, behind `getSearchableEvents()`.
- No drag-and-drop (FullCalendar/Android WebView compatibility risk) -
  editing goes through the edit popup, creating is `dateClick`.
- `.ics` stays plain RFC 5545.
- Recurrence dates are floating time, no `TZID`.

### Requirements

- Recurring events (done)
- Scoped recurring edits — this/following/all (done)
- Event fields: title, location, description, color, status (done)
- Multiple calendars: create/rename/delete/recolor, filtering (done)
- Sharing a calendar or event (UI done, mock data)
- `.ics` import/export incl. email (done)
- Read-only mode, whole-calendar or per-event (done)
- Dark mode (done)
- Timezone handling, guest/secret-link access
- Event search (done), duplicate-event action (done)

### Vendored dependencies

No build step — `assets/vendor/<package>/` mirrors each package's own
upstream layout.

| Package | Version | Source |
|---|---|---|
| FullCalendar (Standard + all locales) | 7.0.2 | [GitHub release ZIP](https://github.com/fullcalendar/fullcalendar/releases/download/v7.0.2/fullcalendar-7.0.2.zip) |
| `@fullcalendar/rrule` | 7.0.2 | [npm tarball](https://registry.npmjs.org/@fullcalendar/rrule/-/rrule-7.0.2.tgz) |
| `rrule` | 2.8.1 | [npm tarball](https://registry.npmjs.org/rrule/-/rrule-2.8.1.tgz) |
| Tabler Icons | outline set | [raw.githubusercontent.com/tabler/tabler-icons](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/) |

Notes:
- Only the `breezy` theme is vendored. Don't vendor from jsDelivr — no
  pre-built `.min.*` files there.
- `@fullcalendar/rrule` bug (still present in 7.0.2): a bare-number
  `duration` on a recurring event silently produces `end === start` - use
  `{ minutes: 45 }` form.
- Icons are inlined in HTML/JS for `currentColor` dark-mode support.
- `assets/icon.png`: solid black, transparent background, 512x512.
- To update: bump the version, replace that package's `vendor/` folder.

### Open items (tracked, not actionable from this repo)

- `READ_CALENDAR`/`WRITE_CALENDAR` permissions — blocks real save/load.
- Confirmation the sharing API is reachable from a sandboxed app.
- Reminders/notifications need a Service Worker + Push API + a server —
  unconfirmed support in sandboxed apps/Android WebView.
- `.ics` import's file picker needs Android WebView's
  `onShowFileChooser()` — unconfirmed on Android, confirmed on desktop.
- `.ics` export/email is blocked in a real Peergos run: the sandboxed-app
  CSP is missing the `allow-downloads` token. Server-side fix, not
  calendar-specific.
