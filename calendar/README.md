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

Recurring events support `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` with
`INTERVAL`/`COUNT`/`UNTIL`, plus a Google-Calendar-style scope prompt
("This event" / "This and following events" / "All events") for editing or
deleting a recurring event — implemented via `EXDATE` (single-occurrence
exceptions) and `UNTIL`-truncation + a new continuation series
(this-and-following splits). `BYDAY`/`BYMONTHDAY`/`BYMONTH` aren't in the UI
yet. See the feature-parity checklist below for what's still open.

Interaction model follows the pattern established by Google Calendar/
Outlook rather than a plain form-first flow: clicking an event shows a
small positioned **preview popover** (time, location, repeat summary,
description, edit/delete icon buttons) instead of jumping straight into
the edit form; creating a timed event supports click-*and*-drag to pick a
range (`selectable`/`select`, not `dateClick`); both the event popup and
the recurring-event scope prompt close on Escape or an outside click.
Icons throughout (`vendor/tabler-icons/`) are Tabler Icons — deliberately
*not* Google's own Material Symbols, even though the interaction pattern
above is modeled on Google Calendar: for a project like Peergos, whose
whole point is being a privacy-respecting alternative to relying on
services like Google's, visually borrowing Google's specific icon
language felt like the wrong call even though it's freely licensed. Tabler
is a neutral, modern outline-icon set with no big-tech branding attached.

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
- **Recurrence dates are floating time, no `TZID`.** `dtstart`/`until` are
  always passed to the plugin as bare local-time strings (`"YYYY-MM-DD"` or
  `"YYYY-MM-DDTHH:MM"`), never as `Date` objects — `rrule.js` reads a raw
  `Date` object via its UTC getters regardless of the actual local
  timezone, which silently corrupts the time for anyone not in UTC (found
  and fixed during development; see `calendar.js`'s `recur.dtstart`
  handling). Floating time (no explicit zone) is itself deliberate and
  RFC5545-legal — it's what `DTSTART`/`RRULE` look like with no `TZID` and
  no trailing `Z`, so this maps directly onto a real `.ics` file rather
  than needing conversion at export time. RFC5545 requires `UNTIL`'s value
  type to match `DTSTART`'s (date vs. date-time); the `UNTIL` date the user
  picks is always date-only (from a plain `<input type="date">`), so
  `formatUntil()` appends the series' own time-of-day for a *timed*
  recurring event before it reaches the plugin — this was needed for
  correctness anyway (a date-only `UNTIL` would exclude that day's own
  occurrence, whose time is always later than midnight) and happens to
  keep the `rrule` object export-ready too.

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

**Known bug in this plugin (v7.0.1), verified empirically with a real
browser session, not just source-reading:** passing a recurring event's
`duration` as a bare number (e.g. `duration: 2700000`) silently produces an
event with `end === start` — no error, but the event renders with zero
height in `timeGridWeek`/`timeGridDay` (invisible) and its true length is
lost. The plugin has its own local copy of `createDuration`, separate from
core's, and the bug is specific to the recurring-event path — the same
number works fine for a plain (non-recurring) event, and the object form
(`duration: { minutes: 45 }` / `{ milliseconds: 2700000 }`) works correctly
for recurring events too. **Always use the object form for a recurring
event's `duration`** — see `calendar.js`'s save handler and the `Gym` mock
event. Re-check this against the CHANGELOG when bumping to a newer
`@fullcalendar/rrule` version, in case it's since been fixed upstream.

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

### Tabler Icons (MIT)

`vendor/tabler-icons/outline/<icon>.svg` mirrors the upstream repo's own
path for each icon (the `outline` variant, matching the rest of the app's
line-icon look). Chosen over Google's Material Symbols deliberately: the
scope-prompt/popover interaction pattern elsewhere in this app is modeled
on Google Calendar, but the icon *set* isn't — see the note in Status
above. Picked over Feather/Lucide (the other well-known MIT outline sets)
based on actual current adoption, not GitHub stars alone: `@tabler/icons`
gets ~3M npm downloads/week vs. Lucide's ~860K and Feather's ~200K
(checked 2026-07-19), and it's the most actively maintained of the three.

```
https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/<icon>.svg
```

Icons currently used: `clock` (time), `map-pin` (location), `repeat`,
`flag` (status), `notes` (description), `x` (close), `pencil` (edit),
`trash` (delete). Tabler's SVGs already ship with `stroke="currentColor"`
baked in, but that only matters once the markup is actually inline in the
page — an `<img src="...svg">` renders the file in its own isolated
document context, so `currentColor` there still resolves independently of
the page, not to it. Static/informational icons (popover rows, form field
labels) are plain `<img>` tags referencing the vendored file directly —
simplest option, fine for the current single (light) theme. The three
*interactive* icons (edit/delete/close, which need to inherit a button's
text color for hover/danger states) are inlined directly in `index.html`,
copy-pasted from the same vendored files, which is what actually lets
`currentColor` pick up the button's color. **When dark mode gets built
(open item, not started yet)**, revisit the `<img>`-based icons too, since
those stay whatever color they were vendored as — either inline them the
same way, or use a CSS `mask-image` + `background-color: currentColor`
technique instead of duplicating markup for every icon.

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
