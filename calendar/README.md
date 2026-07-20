# Calendar

A calendar app for Peergos with recurring events, sharing, and `.ics`
import/export — built as a standard sandboxed Peergos app (manifest +
`/assets`), not built into `web-ui`.

Replaces `web-ui`'s built-in TOAST UI calendar, which has had no upstream
release in ~4 years and has a rigid, pixel-width layout that doesn't work
well on mobile. Proposed and discussed with `web-ui` maintainer `ianopolous`
in [Peergos/web-ui#757](https://github.com/Peergos/web-ui/issues/757).

## Status

Scaffold complete: manifest, vendored FullCalendar, and a working create/
edit/delete event UI wired against **in-memory mock events** (`calendar.js`).
Not yet connected to real Peergos storage.

**Blocked on:** the `READ_CALENDAR`/`WRITE_CALENDAR` permissions below —
not yet implemented on the `peergos` core side. Once they land, the mock
event source in `calendar.js` gets swapped for real
`/peergos-api/v0/data/...` reads/writes; the FullCalendar-facing event
mutation calls (`addEvent`, `setDates`, `remove`, etc.) are already written
against the shape that swap will need.

## Architecture decisions

- **Sandboxed app, not built into `web-ui`.** Per ianopolous: "The only
  reason the calendar is built-in is because we wrote it before we had the
  app sandbox... get it working as a standard third party app." This repo
  is that app — an ordinary Peergos folder (`peergos-app.json` manifest +
  `/assets`), installed the same way as any other app here.
- **Library: FullCalendar 7.0.1**, Standard bundle (MIT) + `@fullcalendar/rrule`
  plugin. Confirmed with ianopolous ("Fullcalendar looks nice yes"). No
  premium tier needed.
- **Permissions: `READ_CALENDAR` / `WRITE_CALENDAR`** (declared in
  `peergos-app.json`, not yet implemented in `peergos` core). Per
  ianopolous, these grant access to the *same* directory structure the old
  built-in calendar already uses (`<calendarDir>/<year>/<month>/<id>.ics`,
  `<calendarDir>/recurring/<id>.ics`) — no data migration needed once an
  existing user installs this app.
- **Sharing** goes through the existing app-facing sharing API rather than
  a new permission — per ianopolous, "that api already exists for apps (or
  if it is in the outer calendar wrapper I can port it)." Not yet confirmed
  working from a sandboxed app context; check before building the sharing
  UI.
- **Search is client-side, scoped to loaded events**, not a full-history
  index — per ianopolous, "efficient search probably needs a new api" that
  doesn't exist yet. Implemented behind a single lookup function so it can
  later be swapped for a real backend search call without reworking the UI.
- **No drag-and-drop.** Moving an event is done via the edit popup's date
  field, not `eventDrop`/`eventResize`. Deliberate — FullCalendar has an
  open report of event-dragging not working inside an embedded Android
  WebView, which is how the official Peergos Android app renders sandboxed
  apps. Avoiding the interaction pattern sidesteps the risk by design.
- **`.ics` stays a portable, standard format.** Plain RFC5545 with a
  standard `PRODID`, not a proprietary extension — export from Peergos must
  import cleanly into Google Calendar/Outlook/Apple Calendar and back.

## Requirements (feature parity with the old built-in calendar)

- Single and recurring event create/edit/delete (`DAILY`/`WEEKLY`/`MONTHLY`/
  `YEARLY`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `INTERVAL`, `COUNT`, `UNTIL`)
- Recurring edits scoped to "this event" / "this and future" / "all events"
- Event fields: title, location, description, color (per-calendar), status
- Multiple calendars: create/rename/delete/recolor, show/hide filtering
- Sharing a calendar or a single event
- `.ics` import (bulk and staged per-event) and export (single event,
  email)
- Read-only mode, whole-calendar or per-event
- Dark mode via the sandbox runtime's `?theme=` param
- Timezone handling, guest/secret-link access
- New: event search (loaded-events scope, see above), duplicate-event
  action (pre-fill a new event from an existing one's fields)

## Vendored dependencies

No build step — everything under `assets/vendor/<package>/` mirrors that
package's own upstream directory layout (e.g. `vendor/fullcalendar/dist/`
is a subset copy of the FullCalendar release ZIP's `dist/` folder), so a
local file's path doubles as its provenance and updating is a re-copy of
that subfolder, no renaming.

### FullCalendar v7.0.1 (Standard bundle + all locales, MIT)

Source: the official GitHub release ZIP — not npm, not jsDelivr.

```
https://github.com/fullcalendar/fullcalendar/releases/download/v7.0.1/fullcalendar-7.0.1.zip
```

Only the `classic` theme is vendored (ZIP also ships `breezy`/`forma`/
`monarch`, unused here):

| Local path | ZIP path |
|---|---|
| `vendor/fullcalendar/dist/fullcalendar.global.js` | `dist/fullcalendar.global.js` |
| `vendor/fullcalendar/dist/skeleton.css` | `dist/skeleton.css` |
| `vendor/fullcalendar/dist/locales-all/global.js` | `dist/locales-all/global.js` |
| `vendor/fullcalendar/dist/themes/classic/global.js` | `dist/themes/classic/global.js` |
| `vendor/fullcalendar/dist/themes/classic/theme.css` | `dist/themes/classic/theme.css` |
| `vendor/fullcalendar/dist/themes/classic/palette.css` | `dist/themes/classic/palette.css` |

Docs: https://fullcalendar.io/docs/initialize-globals,
https://fullcalendar.io/docs/locale.

**Don't vendor `fullcalendar`'s `.min.js`/`.min.css` from jsDelivr** — this
package ships no pre-built minified files, so a jsDelivr `.min.*` URL
returns a file Terser-minified on the fly by jsDelivr itself (tell: a
`Minified by jsDelivr using Terser... dynamically generated files`
comment), not something FullCalendar actually publishes.

### RRule plugin `@fullcalendar/rrule` v7.0.1 (MIT)

`vendor/fullcalendar-rrule/` mirrors the npm package root (no `dist/` in
this package). Required alongside `rrule` below, not instead of it —
this is only an adapter connecting `rrule`'s parsing to
`FullCalendar.Calendar`; `rrule.min.js` must load first. See
https://fullcalendar.io/docs/rrule-plugin.

| Local path | Tarball path |
|---|---|
| `vendor/fullcalendar-rrule/global.js` | `package/global.js` |

```
https://registry.npmjs.org/@fullcalendar/rrule/-/rrule-7.0.1.tgz
```

npm-only: no GitHub release ZIP asset exists for this package (its source
lives in the same `fullcalendar/fullcalendar` monorepo, at
`packages/rrule`, just never packaged into a release asset).

### RRule library `rrule` v2.8.1 (MIT)

| Local path | Tarball path |
|---|---|
| `vendor/rrule/dist/es5/rrule.min.js` | `package/dist/es5/rrule.min.js` |

```
https://registry.npmjs.org/rrule/-/rrule-2.8.1.tgz
```

npm-only (no GitHub release ZIP). Unlike FullCalendar's own packages,
`rrule` genuinely ships this file pre-built (webpack UMD, no jsDelivr
minification comment) — safe to vendor as-is.

`@fullcalendar/rrule` hard-pins `rrule: ^2.6.0` as a peer dependency and is
the only recurrence plugin FullCalendar ships, so `rrule` isn't swappable
for a more actively-released alternative without writing a custom plugin.
Its slow release cadence (last release 2023-11-10) reflects RFC5545 being a
frozen spec, not abandonment — the repo isn't archived and still gets
commits.

### Updating to a newer release

Follow the source links above for each package, bump the version in the
URL, and replace that package's `vendor/` subfolder wholesale with what you
download — local paths mirror upstream paths, so nothing needs renaming.
Then re-check `index.html` and the docs links above for anything new.

## Open items (tracked, not actionable from this repo)

- `READ_CALENDAR`/`WRITE_CALENDAR` permissions — needed before real
  save/load can be implemented and tested (blocks the rest of this app).
- Confirmation that the sharing API is reachable from a sandboxed app, or
  that ianopolous has ported it — needed before building the sharing UI.
