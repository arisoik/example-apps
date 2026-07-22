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
Outlook rather than a plain form-first flow: a single click on an event
shows a small positioned **preview popover** (time, location, repeat
summary, description, delete/edit/duplicate/export icon buttons, in that
order — matches Google Calendar's own event popover, which puts Delete
first rather than isolating it at the end); a **double click opens
straight into editing** instead, matching desktop click-to-select/
double-click-to-open conventions (Outlook and Google Calendar desktop
both do this) — deliberately kept even though it has no touch equivalent,
since it simply never fires on mobile and single click already reaches
Edit one click further via the popover. Creating a timed event supports
click-*and*-drag to pick a range (`selectable`/`select`, not `dateClick`);
the event popup and the recurring-event scope prompt close on Escape or
an outside click. Clicking outside the popover closes it and still lets
the click act on whatever it landed on — switching straight to a
different event's popover in one click, opening the search/import
buttons normally. The one exception is day-grid `select` (clicking empty
space to create a new event), swallowed via a capture-phase `mousedown`
listener rather than passed through, since opening the create form as a
side effect of dismissing a popover reads as broken in a way switching to
a different event doesn't.
**Duplicate** always creates a standalone, non-recurring copy of just the
clicked occurrence (pre-filled into the create form, not silently created)
— even when duplicating one occurrence of a recurring series, since the
copy is never itself part of that series and shouldn't need the scope
prompt recurring edits do.
Icons throughout (`vendor/tabler-icons/`) are Tabler Icons — deliberately
*not* Google's own Material Symbols, even though the interaction pattern
above is modeled on Google Calendar: for a project like Peergos, whose
whole point is being a privacy-respecting alternative to relying on
services like Google's, visually borrowing Google's specific icon
language felt like the wrong call even though it's freely licensed. Tabler
is a neutral, modern outline-icon set with no big-tech branding attached.

**Search** is a command-palette-style overlay, not an anchored dropdown —
a pill-shaped trigger in the utility bar (magnifying glass + "Search"
label) opens a centered modal with a text input and a live results list
below it, matching the visual pattern used by most modern app/docs search.
No keyboard shortcut - deliberately click-only, not a hidden Ctrl+K/⌘K
affordance a user has to already know about. Each result shows the same
kind of information an event does elsewhere in this app — title, a
repeat-icon badge if recurring, cancelled events struck through,
date/time (or "All day"), and location. Requires a 2-character minimum
(`MIN_SEARCH_QUERY_LENGTH`) before matching anything, since title,
location, and description are all searched and a single-character query
tends to match nearly everything through some field or other.
Matching walks the FullCalendar event store's *defs* rather than
`calendar.getEvents()`, since for a recurring series the latter only
returns occurrences already expanded for the currently rendered view — a
def stays searchable regardless of which month is on screen. A def with
no active instance has `.start === null`, so `nearestRecurOccurrenceDate()`
computes somewhere to jump to: the occurrence closest to the *start of
today's day* (not the exact current time, so a daily event's own
occurrence for today doesn't look "already past" once its time-of-day
has elapsed), clamped to the series' own `COUNT`/`UNTIL` and nudged off
any `EXDATE`, reusing the same stepping helpers the recurring-edit logic
uses.
Clicking a result navigates via `gotoDate()` (so a future backend search
returning matches from unloaded months already works) and opens the
event's own preview popover, matching Google Calendar's search-result
behavior — a permanent state until dismissed, not a transient highlight
that can be missed. `jumpToSearchResult()` re-resolves `ev` to a real
rendered instance close to `jumpDate`, since a recurring series' master
can have `.start === null` before `gotoDate()` makes an instance exist.
Available in read-only mode (it doesn't mutate anything); Import is the
only utility-bar icon hidden when `isPathWritable=false`. Escape and
clicking the backdrop dismiss the modal, matching the other modals here.

`.ics` export (single event, from the popover) and import (bulk, via the
icon in the same utility bar) are implemented and hand-verified against
the actual RFC 5545 spec text, not memory — see `calendar.js`'s "`.ics`
(RFC 5545) export/import" section. Round-trip tested (export → re-import,
in-app) for a plain event, a `COUNT`-based recurring series, a
`UNTIL`-based series with an `EXDATE` exception, an all-day multi-day
event, and text containing commas/semicolons/newlines/backslashes — all
byte-identical after the round trip. Also tested importing a realistic
external `.ics` file (Google-Calendar-shaped, `TZID` + `BYDAY`) to confirm
graceful degradation rather than a crash — see "Known `.ics` limitations"
below for exactly what that degrades to.

**Known `.ics` limitations** (real, not yet closed — not silently
glossed over): imported events using a named `TZID` (e.g.
`TZID=America/New_York`) are read as floating local time — the wall-clock
numbers are kept, but the zone itself isn't converted, since full IANA
timezone/DST handling is a much bigger undertaking than this pass covers.
`RRULE` parts we don't support in our UI (`BYDAY`, `BYMONTHDAY`,
`BYMONTH`, `BYYEARDAY`, `BYWEEKNO`, `BYSETPOS`) are dropped on import,
simplified down to plain `FREQ`+`INTERVAL` (logged via `console.warn`,
not silently discarded without a trace) — an imported "every Mon/Wed/Fri"
event becomes plain weekly. Import is bulk-only for now; the plan's
"staged per-event confirmation" import mode (review each event before
it's added) is deferred, same pattern as recurrence's whole-series-first
approach earlier in this project.

**Two bugs found and fixed in code that predates this session's search
work.** Creating or duplicating an all-day event saved one extra day —
`openModal()`'s create-mode branch was missing the `toFormEnd()`
inclusive-display conversion its edit-mode branch already had. And the
event popover could position itself on top of the event it describes:
`positionPopover()` now defaults to below the anchor, only flipping
above when below doesn't fit and above does without clamping (the usual
Popper.js/Floating UI convention, matching Google Calendar's own event
popover), and `showEventPopover()` re-measures the anchor once more via
`setTimeout(fn, 0)` shortly after opening, since FullCalendar's day-grid
row-height pass can settle an event into its final position slightly
after the click handler runs. That re-measure prefers the originally
clicked element over an id-based re-lookup, since a multi-day event's row
segments and a recurring series' occurrences all share the same
`data-search-event-id` — a re-lookup by id alone would always land on
the first one rather than whichever was actually clicked.

**Multiple calendars** work the way Google Calendar/Outlook/Apple Calendar
all do it: a persistent left sidebar listing each calendar with a colored
checkbox (show/hide) and a "⋮" menu (Edit — name + color together in one
modal, not separate actions — and Delete, which cascades to that
calendar's own events after a native `confirm()`; deleting the last
remaining calendar is blocked with a native `alert()`). Colors come from
a small fixed palette (`CALENDAR_COLORS`), not free-form picking, same
reasoning as the icon-set choice elsewhere in this app — a few
pre-chosen, legible colors beats letting someone land on unreadable white
text on pale yellow. The sidebar is persistent on desktop and an
off-canvas drawer on mobile (`max-width: 700px`), toggled by a hamburger
button that's hidden entirely above that width, with a dimmed backdrop
that closes it on tap — collapsing the sidebar on *desktop* to reclaim
grid space, which Google Calendar's own desktop UI also offers, is a
deliberately deferred nice-to-have, not built here.
Visibility filtering uses FullCalendar's own per-event `display` property
(`'auto'`/`'none'`) via `EventApi.setProp()`, not CSS — CSS would still
leave a hidden event's space reserved in FullCalendar's own row-height
and "+N more" calculations, since FullCalendar wouldn't know it's
supposed to be excluded from them.
**Found the hard way: this vendored FullCalendar bundle silently ignores
the `backgroundColor`/`borderColor`/`textColor` per-event properties
documented for FullCalendar generally** — confirmed by grepping the
bundle itself (zero occurrences of any of those three strings) after
setting them produced no visible change and left `EventApi.backgroundColor`
`null`. The actual mechanism this bundle uses is a single `color`
property per event (confirmed via the internal event def's `ui.color`
field actually populating, and the rendered element's own
`--fc-event-color` inline custom property reflecting it) — every color
assignment in this codebase (mock events, `buildPlainEventPayload`/
`buildRecurringEventPayload`, recoloring via the calendar Edit modal)
uses `color`, not the separate background/border/text properties. Worth
re-checking against the CHANGELOG on any future FullCalendar version bump,
same as the `@fullcalendar/rrule` duration bug below.
New events default to whichever calendar is first in the list; imported
`.ics` events (which have no concept of "our calendars") land there too.
A calendar picker (`<select>`, populated from `mockCalendars`) sits near
the top of the event form, right under Title.

**The primary calendar (`Personal`, `cal.primary === true`) can't be
deleted** — matches Google Calendar/Outlook/Apple Calendar, which all
protect your primary calendar the same way (rename/recolor it, just not
remove it). Enforced in two places, both checking `cal.primary`: the
sidebar's "⋮" menu doesn't offer Delete for it at all, and its Edit
modal's own Delete button is hidden too, since the two decide whether to
show a Delete affordance independently of each other. Deleting any other
calendar goes through a real confirm dialog styled like the rest of this
app (`openConfirmModal()`, generic enough to reuse for a future
destructive action), not the browser's native `confirm()`.
The sidebar collapses on desktop now too, not just as a mobile drawer -
the same toggle button branches on `window.innerWidth` at click time
(`MOBILE_BREAKPOINT = 700`, matching the CSS media query) since the two
behaviors are different enough (an off-canvas overlay with a dimming
backdrop vs. a persistent column collapsing to zero width in place) that
one CSS class can't reasonably drive both.
**Two real click-handling bugs found via live testing.** A calendar "⋮"
menu is tall enough to overlap the row below it, so a click aimed at that
row's kebab button landed on the open menu instead (WebDriver's own
"element click intercepted" error confirmed this) and, since that read as
"inside the menu, do nothing," left the menu looking stuck open — fixed
by only exempting the menu's own buttons from the outside-click check,
not its blank space. Separately, both the calendar-menu-closer and the
event popover's outside-click-closer are bubble-phase `document`
listeners, and each could be silently skipped by an unrelated
`stopPropagation()` call between the click target and `document` -
`eventClick`'s own `stopPropagation()` meant clicking an event never
closed an open calendar menu at all, and a calendar kebab button's
`stopPropagation()` meant clicking it never closed an open popover.
Both switched to capture phase, which runs before any `stopPropagation()`
downstream - "switch straight to a different event's popover in one
click" still works afterward, since capture doesn't stop propagation
itself.

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
- **Search is client-side**, not a full-history index — per ianopolous,
  "efficient search probably needs a new api" that doesn't exist yet.
  Implemented behind a single lookup function (`getSearchableEvents()`) so
  it can later be swapped for a real backend search call without reworking
  the UI. Matches against every event currently held in the FullCalendar
  instance (title/location/description), including recurring series with
  no occurrence in the current view — see Status above for how jumping to
  those is handled.
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
  (done, see Status above)
- Sharing a calendar or a single event
- `.ics` import (bulk done, staged per-event confirmation still open) and
  export (single event done, see Status above; email an event still open)
- Read-only mode, whole-calendar or per-event
- Dark mode via the sandbox runtime's `?theme=` param
- Timezone handling, guest/secret-link access
- New: event search done (see Status above); duplicate-event action done
  (see Status above)

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
`copy` (duplicate), `download` (export), `upload` (import), `trash`
(delete). Tabler's SVGs already ship with `stroke="currentColor"`
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
