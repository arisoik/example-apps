# Calendar

A calendar app for Peergos with recurring events, sharing, and `.ics`
import/export — built as a standard sandboxed Peergos app (manifest +
`/assets`), not built into `web-ui`.

Replaces `web-ui`'s built-in TOAST UI calendar, which has had no upstream
release in ~4 years and has a rigid, pixel-width layout that doesn't work
well on mobile. Proposed and discussed with `web-ui` maintainer `ianopolous`
in [Peergos/web-ui#757](https://github.com/Peergos/web-ui/issues/757).

## Status

Scaffold complete: manifest, vendored FullCalendar, full UI wired against
**in-memory mock events** (`calendar.js`) — not yet connected to real
Peergos storage (blocked on `READ_CALENDAR`/`WRITE_CALENDAR`, see Open
items). The FullCalendar-facing mutation calls (`addEvent`, `setDates`,
`remove`, etc.) are already written against the shape that swap will need.

- **Recurring events**: `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` with
  `INTERVAL`/`COUNT`/`UNTIL`, plus a scope prompt ("This event" / "This
  and following" / "All events") for edit/delete, via `EXDATE` and
  series-splitting. `BYDAY`/`BYMONTHDAY`/`BYMONTH` aren't in the UI yet.
- **Interaction**: single click opens a preview popover
  (time/location/repeat/description + delete/edit/duplicate/export);
  double click opens edit directly; click-and-drag creates a timed event;
  Duplicate always creates a standalone non-recurring copy. Icons are
  Tabler (not Material Symbols — deliberate, see Vendored dependencies).
- **Toolbar**: YouTube-style layout — hamburger (sidebar toggle, closed by
  default) + centered always-visible search + "⋯" overflow menu (Import,
  FullCalendar version). Search is a live anchored dropdown, 2-character
  minimum, matches title/location/description across all months
  (including recurring series with no visible occurrence).
- **`.ics` export/import**: RFC 5545, round-trip tested. Export is
  per-event (popover) or per-calendar (sidebar "⋮" menu → Export, one
  multi-`VEVENT` file) — matches Google/Outlook/Apple, who all treat
  whole-calendar export as the primary case. A UID from this app
  (`<id>@peergos.org`) is only minted for natively-created events;
  re-exporting an imported event keeps its original foreign UID
  untouched, so re-importing that file back into its source app is still
  recognized as the same event. Import is bulk-only with duplicate
  detection (skips events whose id — derived from the file's own `UID`
  — already exists), a "not a valid calendar file" check
  (`BEGIN:VCALENDAR` must be present), and a post-import summary
  (imported / skipped-duplicate / skipped-unreadable counts); a
  staged/per-event-confirmation mode was considered and dropped — Google
  Calendar/Outlook/Apple Calendar don't do that either. Known
  limitations: a named `TZID` is read as floating local time (not
  converted); unsupported `RRULE` parts (`BYDAY`/`BYMONTHDAY`/`BYMONTH`/
  `BYYEARDAY`/`BYWEEKNO`/`BYSETPOS`) simplify to plain `FREQ`+`INTERVAL`
  (`console.warn`ed, not silent); `VALARM` (reminders) is silently
  dropped on import — see Open items, this app has no reminder feature
  to keep that data for yet.
- **Multiple calendars**: sidebar with show/hide checkboxes and an Edit/
  Delete menu; colors from a small fixed palette; the primary calendar
  can't be deleted (matches Google/Outlook/Apple). Visibility filtering
  uses FullCalendar's own per-event `display` property, not CSS.
- **Dark mode**: reads Peergos's `?theme=` param and sets
  `data-color-scheme="dark"`, which the vendored Breezy theme's own CSS
  already keys off — `calendar.css` reuses those same `--fc-breezy-*`
  variables throughout instead of a hand-rolled second palette, so one
  attribute flip re-themes FullCalendar's grid and this app's own UI at
  once. The dark background is overridden to Peergos web-ui's own colors
  (`#2c3e50`/`#283744`, not Breezy's stock near-black) so this app reads
  as part of its host; calendar event colors get a brighter dark-mode
  variant via `displayColor()` (the stored identity color never changes).
- **Navigation**: ISO week numbers; day/week numbers are clickable
  (`navLinks: true`), jumping to Day/Week view; `nowIndicator: true` for
  the current-time line in Week/Day view (not on by default in
  FullCalendar - easy to miss enabling).

Two Breezy-specific fixes in `fixDayGridEventLayout()`
(`calendar.js`, called from `eventDidMount` and again on every window
resize): its Month/Year event rows show no per-event color indicator by
default, unlike Week/Day (colored blocks) and List (colored dots) which
both already work correctly — a small dot is added, colored from
`--fc-event-color`, and each row is forced flush-left (dot, time, title)
instead of Breezy's own title-left/time-right `space-between` layout.
The time label shows only if it actually fits the cell's current width
(not a fixed breakpoint), so it reappears on rotating a phone to
landscape. This has to be **re-applied on every resize, not just at
mount** — Breezy's own responsive logic rebuilds this content on resize
(adding/removing the time div by width) without re-invoking
`eventDidMount`, which left the dot/time/title order scrambled after a
couple of rotations before this was caught.

One vendored-bundle gotcha worth knowing: this FullCalendar build's
per-event `backgroundColor`/`borderColor`/`textColor` properties are
silently no-ops (confirmed by grepping the bundle — those strings don't
appear in it at all). Use the single `color` property instead; every
color assignment in this codebase already does.

## Architecture decisions

- **Sandboxed app, not built into `web-ui`.** Per ianopolous, the
  built-in calendar only existed because it predates the app sandbox —
  this is an ordinary Peergos folder (`peergos-app.json` + `/assets`),
  installed like any other app.
- **FullCalendar 7.0.1**, Standard bundle (MIT) + `@fullcalendar/rrule`.
  Confirmed with ianopolous; no premium tier needed.
- **Permissions: `READ_CALENDAR`/`WRITE_CALENDAR`** (declared in
  `peergos-app.json`, not yet implemented in `peergos` core). Per
  ianopolous these grant access to the same directory structure the old
  built-in calendar used (`<calendarDir>/<year>/<month>/<id>.ics`,
  `<calendarDir>/recurring/<id>.ics`) — no data migration needed.
- **Sharing** uses the existing app-facing sharing API, not a new
  permission — per ianopolous it "already exists for apps (or... I can
  port it)." Not yet confirmed working from a sandboxed context.
- **Search is client-side**, not a full-history index — per ianopolous,
  real search needs a new backend API that doesn't exist yet. Behind a
  single `getSearchableEvents()` lookup so that can be swapped in later
  without reworking the UI.
- **No drag-and-drop.** Editing an event's date goes through the edit
  popup, not `eventDrop`/`eventResize` — FullCalendar has an open report
  of event-dragging not working inside an embedded Android WebView,
  which is how the official Peergos Android app renders sandboxed apps.
- **`.ics` stays plain RFC 5545** with a standard `PRODID` — export from
  Peergos must import cleanly into Google Calendar/Outlook/Apple
  Calendar and back.
- **Recurrence dates are floating time, no `TZID`.** Passed to
  `@fullcalendar/rrule` as bare local-time strings, never `Date` objects
  — the plugin reads a raw `Date` via UTC getters regardless of actual
  local timezone, which corrupts the time for anyone not in UTC.
  Floating time is itself deliberate and RFC5545-legal (no `TZID`, no
  trailing `Z`), so it maps directly onto a real `.ics` file.

## Requirements (feature parity with the old built-in calendar)

- Single and recurring event create/edit/delete (`DAILY`/`WEEKLY`/`MONTHLY`/
  `YEARLY`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `INTERVAL`, `COUNT`, `UNTIL`)
- Recurring edits scoped to "this event" / "this and future" / "all events"
- Event fields: title, location, description, color (per-calendar), status
- Multiple calendars: create/rename/delete/recolor, show/hide filtering (done)
- Sharing a calendar or a single event
- `.ics` import (bulk done, see Status) and export (single event and
  per-calendar done, see Status; email an event still open)
- Read-only mode, whole-calendar or per-event
- Dark mode via the sandbox runtime's `?theme=` param (done)
- Timezone handling, guest/secret-link access
- New: event search (done); duplicate-event action (done)

## Vendored dependencies

No build step — everything under `assets/vendor/<package>/` mirrors that
package's own upstream directory layout, so a local file's path doubles
as its provenance and updating is a re-copy of that subfolder.

### FullCalendar v7.0.1 (Standard bundle + all locales, MIT)

```
https://github.com/fullcalendar/fullcalendar/releases/download/v7.0.1/fullcalendar-7.0.1.zip
```

Only the `breezy` theme (indigo palette) is vendored, of the five the ZIP
ships (`classic`/`breezy`/`forma`/`monarch`/`pulse`, all MIT) — picked for
a more modern look than classic's flatter default. Each theme is a
`global.js` (class-name generator, loaded as a `<script>`) plus
`theme.css` and a `palettes/<color>.css`; no `themeSystem` config option
needed. Swapping themes is a file-copy, not a code change.

| Local path | ZIP path |
|---|---|
| `vendor/fullcalendar/dist/fullcalendar.global.js` | `dist/fullcalendar.global.js` |
| `vendor/fullcalendar/dist/skeleton.css` | `dist/skeleton.css` |
| `vendor/fullcalendar/dist/locales-all/global.js` | `dist/locales-all/global.js` |
| `vendor/fullcalendar/dist/themes/breezy/global.js` | `dist/themes/breezy/global.js` |
| `vendor/fullcalendar/dist/themes/breezy/theme.css` | `dist/themes/breezy/theme.css` |
| `vendor/fullcalendar/dist/themes/breezy/palettes/indigo.css` | `dist/themes/breezy/palettes/indigo.css` |

Docs: https://fullcalendar.io/docs/initialize-globals,
https://fullcalendar.io/docs/locale.

**Don't vendor from jsDelivr** — this package ships no pre-built minified
files, so a jsDelivr `.min.*` URL is Terser-minified on the fly by
jsDelivr itself, not something FullCalendar actually publishes.

### RRule plugin `@fullcalendar/rrule` v7.0.1 (MIT)

`vendor/fullcalendar-rrule/` mirrors the npm package root. Requires
`rrule` below too (adapter only, not a replacement); `rrule.min.js` must
load first. See https://fullcalendar.io/docs/rrule-plugin.

| Local path | Tarball path |
|---|---|
| `vendor/fullcalendar-rrule/global.js` | `package/global.js` |

```
https://registry.npmjs.org/@fullcalendar/rrule/-/rrule-7.0.1.tgz
```

npm-only: no GitHub release ZIP asset for this package.

**Known bug (v7.0.1), verified empirically:** a recurring event's
`duration` as a bare number (e.g. `duration: 2700000`) silently produces
`end === start` (invisible zero-height event in time-grid views) — the
object form (`duration: { minutes: 45 }`) works correctly. **Always use
the object form for a recurring event's duration.** Re-check against the
CHANGELOG on any version bump.

### RRule library `rrule` v2.8.1 (MIT)

| Local path | Tarball path |
|---|---|
| `vendor/rrule/dist/es5/rrule.min.js` | `package/dist/es5/rrule.min.js` |

```
https://registry.npmjs.org/rrule/-/rrule-2.8.1.tgz
```

npm-only (no GitHub release ZIP), but genuinely ships this file
pre-built (webpack UMD) — safe to vendor as-is. `@fullcalendar/rrule`
hard-pins `rrule: ^2.6.0` and is the only recurrence plugin FullCalendar
ships, so this isn't swappable without a custom plugin. Slow release
cadence reflects RFC5545 being a frozen spec, not abandonment.

### Tabler Icons (MIT)

`vendor/tabler-icons/outline/<icon>.svg` mirrors the upstream repo's own
path. Chosen over Google's Material Symbols deliberately (Peergos is a
privacy-respecting alternative to big-tech services, even though some
interaction patterns here are modeled on Google Calendar) and over
Feather/Lucide on current adoption (`@tabler/icons` ~3M npm downloads/
week vs. Lucide ~860K, Feather ~200K, checked 2026-07-19).

```
https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/<icon>.svg
```

Every icon is inlined directly in `index.html` (or via `.innerHTML` in
`calendar.js` for dynamically-created ones) rather than loaded via
`<img src>` — required for `currentColor`/dark-mode support, since an
`<img>`-loaded SVG can't inherit page color at all.

### Updating to a newer release

Follow the source links above, bump the version in the URL, and replace
that package's `vendor/` subfolder wholesale — local paths mirror
upstream paths, so nothing needs renaming. Re-check `index.html` and the
docs links above for anything new.

## Open items (tracked, not actionable from this repo)

- `READ_CALENDAR`/`WRITE_CALENDAR` permissions — needed before real
  save/load can be implemented and tested (blocks the rest of this app).
- Confirmation that the sharing API is reachable from a sandboxed app, or
  that ianopolous has ported it — needed before building the sharing UI.
- Reminders/notifications: real (app-closed) reminders need a Service
  Worker + Push API and, since browsers can't self-schedule a future
  push, a server to actually fire it at the right time — infrastructure
  this app doesn't have. Also unconfirmed whether sandboxed Peergos apps
  get Service Worker/Notification permissions at all, and whether the
  official Android app's WebView supports Service Worker push
  notifications (bare WebViews historically don't, unless the native
  host bridges it).
- `<input type="file">` (used for `.ics` import) needs the host Android
  app to implement `WebChromeClient.onShowFileChooser()` for the file
  picker to open at all inside a WebView — unconfirmed whether Peergos's
  Android app does this. Needs testing on a real device.
