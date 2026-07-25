# Calendar

Calendar app for Peergos with recurring events, sharing, and `.ics`
import/export. Built as a standard sandboxed Peergos app (manifest +
`/assets`), not built into `web-ui`. Replaces `web-ui`'s built-in TOAST UI
calendar (unmaintained, poor mobile layout). Discussed with `web-ui`
maintainer `ianopolous` in
[Peergos/web-ui#757](https://github.com/Peergos/web-ui/issues/757).

## Status

UI complete, running on **in-memory mock events** — not yet connected to
real Peergos storage (blocked on `READ_CALENDAR`/`WRITE_CALENDAR`, see Open
items).

- **Recurring events**: `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY`,
  `INTERVAL`/`COUNT`/`UNTIL`, scoped edit/delete ("this event" / "this and
  following" / "all events") via `EXDATE` and series-splitting. Weekly has
  a day-of-week toggle (`BYDAY`, e.g. `MO,WE,FR`); monthly has "day N" vs.
  "Nth weekday" (`BYDAY` with ordinal prefix, e.g. `2TU`, or `-1FR` for
  "last"). `BYMONTHDAY`/`BYMONTH` have no standalone UI, matching Google
  Calendar's own scope. Occurrence math uses `rrule.RRuleSet`/`RRule`
  directly (see `toFakeUtc`/`fromFakeUtc` in `calendar.js` — works around
  `rrule`'s UTC-getter timezone bug).
- **Interaction**: click opens a popover (delete/edit/duplicate, then
  export/email) and outlines the clicked event on the grid (disambiguates
  which exact occurrence on a busy day, since the popup's position alone
  isn't always enough - a deliberate deviation from Google/Outlook/Apple,
  which rely on the popup position alone); double-click opens edit
  directly; drag creates a timed event. No drag-to-move (see Architecture
  decisions).
- **Toolbar**: hamburger sidebar toggle + centered search + "⋯" overflow
  menu (Import). Search matches title/location/description across all
  months, 2-char minimum; each result shows a calendar-color dot and the
  calendar's name; clicking a result on a currently-hidden calendar
  re-enables that calendar (matching Google Calendar) instead of silently
  failing to open a popover for an event that isn't rendered.
- **`.ics` export/import**: RFC 5545. Export per-event or per-calendar.
  Import is bulk with duplicate detection (by `UID`) and a post-import
  summary. `BYDAY` round-trips for the two shapes the UI produces; other
  `RRULE` parts (`BYMONTHDAY`, `BYMONTH`, unsupported `BYDAY` shapes, etc.)
  simplify to plain `FREQ`+`INTERVAL` with a `console.warn`. `TZID` reads as
  floating local time; `VALARM` is dropped (no reminder feature yet).
- **Email an event**: `mailto:` with a plain-text summary in the body, not
  the `.ics` file — `mailto:` can't carry attachments.
- **Multiple calendars**: create/rename/delete/recolor, show/hide
  filtering. Primary calendar can't be deleted.
- **Dark mode**: reads Peergos's `?theme=` param once at launch, sets
  `data-color-scheme="dark"`. Reuses the vendored Breezy theme's own
  `--fc-breezy-*` variables for this app's UI too, so one attribute flips
  both. No live updates — requires relaunching the app.
- **Navigation**: ISO week numbers, clickable to jump to Day/Week view;
  `nowIndicator` for the current-time line.

Two Breezy-specific fixes in `fixDayGridEventLayout()` (`calendar.js`):
Month/Year rows get a per-event color dot (missing by default) and are
forced flush-left instead of Breezy's title-left/time-right layout;
re-applied on every resize, not just at mount, since Breezy's own resize
logic rebuilds this content without re-firing `eventDidMount`.

Vendored-bundle gotcha: per-event `backgroundColor`/`borderColor`/
`textColor` are silent no-ops in this build — use `color` instead.

## Architecture decisions

- **Sandboxed app, not built into `web-ui`** — per ianopolous, the old
  calendar was only built-in because it predates the app sandbox.
- **FullCalendar 7.0.1**, Standard bundle (MIT) + `@fullcalendar/rrule`.
- **Permissions: `READ_CALENDAR`/`WRITE_CALENDAR`** (declared in
  `peergos-app.json`, not yet implemented in `peergos` core). Grants access
  to the same `<calendarDir>/<year>/<month>/<id>.ics` structure the old
  calendar used — no data migration needed.
- **Sharing** uses an existing app-facing API per ianopolous, not a new
  permission — not yet confirmed working from a sandboxed context.
- **Search is client-side** (no full-history index yet) — behind
  `getSearchableEvents()` so a real backend API can swap in later.
- **No drag-and-drop** — editing a date goes through the edit popup.
  FullCalendar has an open report of event-dragging not working inside an
  embedded Android WebView, which is how the Peergos Android app renders
  sandboxed apps.
- **`.ics` stays plain RFC 5545**, standard `PRODID` — must round-trip with
  Google Calendar/Outlook/Apple Calendar.
- **Recurrence dates are floating time, no `TZID`** — passed to
  `@fullcalendar/rrule` as bare local-time strings, never `Date` objects,
  since the plugin reads `Date` via UTC getters regardless of actual
  timezone.

## Requirements (parity with the old built-in calendar)

- Recurring events (done, see Status for `BYDAY`/`BYMONTHDAY`/`BYMONTH` scope)
- Scoped recurring edits — this/following/all (done)
- Event fields: title, location, description, color, status
- Multiple calendars: create/rename/delete/recolor, filtering (done)
- Sharing a calendar or event
- `.ics` import (done) / export incl. email (done)
- Read-only mode, whole-calendar or per-event
- Dark mode (done)
- Timezone handling, guest/secret-link access
- Event search (done), duplicate-event action (done)

## Vendored dependencies

No build step — `assets/vendor/<package>/` mirrors each package's own
upstream layout.

| Package | Version | Source |
|---|---|---|
| FullCalendar (Standard + all locales) | 7.0.1 | [GitHub release ZIP](https://github.com/fullcalendar/fullcalendar/releases/download/v7.0.1/fullcalendar-7.0.1.zip) |
| `@fullcalendar/rrule` | 7.0.1 | [npm tarball](https://registry.npmjs.org/@fullcalendar/rrule/-/rrule-7.0.1.tgz) (no GitHub release asset) |
| `rrule` | 2.8.1 | [npm tarball](https://registry.npmjs.org/rrule/-/rrule-2.8.1.tgz) (no GitHub release asset) |
| Tabler Icons | outline set | [raw.githubusercontent.com/tabler/tabler-icons](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/) |

Notes:
- Only the `breezy` FullCalendar theme is vendored (of 5 shipped). Don't
  vendor FullCalendar from jsDelivr — it has no pre-built `.min.*` files,
  so jsDelivr Terser-minifies on the fly.
- `@fullcalendar/rrule` v7.0.1 bug: a recurring event's `duration` as a
  bare number silently produces `end === start`. Always use the object
  form (`duration: { minutes: 45 }`).
- Tabler Icons chosen over Material Symbols (Peergos is privacy-focused)
  and over Feather/Lucide (higher npm adoption). Icons are inlined in
  HTML/JS, not `<img src>`, so they inherit `currentColor` for dark mode.
- To update: bump the version in the URL, replace that package's `vendor/`
  subfolder wholesale.

## Open items (tracked, not actionable from this repo)

- `READ_CALENDAR`/`WRITE_CALENDAR` permissions — blocks real save/load.
- Confirmation the sharing API is reachable from a sandboxed app.
- Reminders/notifications need a Service Worker + Push API + a server to
  fire pushes — unconfirmed whether sandboxed apps get Service
  Worker/Notification permissions, or whether the Android WebView supports
  Service Worker push at all.
- `.ics` import's `<input type="file">` needs Android's WebView to
  implement `onShowFileChooser()` — unconfirmed on Android, **confirmed
  working on Linux desktop**.
- **`.ics` export/email is blocked in a real Peergos run**: "Download is
  disallowed... the flag 'allow-downloads' is not set." The sandboxed-app
  CSP (`peergos` server, `StaticHandler.java`) is missing the
  `allow-downloads` sandbox token — confirmed as a real, standard token via
  `jspaint`'s own nested-iframe usage. Not calendar-specific: any app doing
  a client-side download (`mindmaps`, `drawio`, `luckysheet`) hits the same
  wall. Fixable only server-side.
