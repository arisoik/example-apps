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
- **Toolbar**: sidebar toggle, "+" new event (autofocuses title, defaults
  to now), search (title/location/description, 2-char minimum), "⋯"
  overflow menu (Import).
- **`.ics` export/import**: RFC 5545, per-event or per-calendar. Bulk
  import with duplicate detection. Unsupported `RRULE` parts simplify to
  plain `FREQ`+`INTERVAL`, reported in the import summary alongside the
  imported/skipped counts; `VALARM` is dropped. Timezone-aware (see
  Architecture decisions below) - a single event exports in UTC, a
  recurring series carries its own `TZID` plus a generated `VTIMEZONE`
  block so it stays pinned to local time across a DST change.
- **Email an event**: `mailto:` with a plain-text summary, not the `.ics`
  file.
- **Multiple calendars**: create/rename/delete/recolor, show/hide
  filtering. Primary calendar can't be deleted.
- **Sharing**: an event or non-primary calendar can be shared with a
  username or via a secret link, each grantable as view-only or
  can-edit, changeable after the fact; a secret link can also be
  revoked. Mock state (`mockShares`) - not wired to a real permission
  grant (see Architecture decisions).
- **Read-only calendars**: a calendar can be marked `readOnly`
  (`isCalendarWritable()`) - drops Edit/Share/Delete for it and its
  events. Per-calendar only, not a whole-app flag - the sandboxed-app
  runtime has no documented way to query that, and the old built-in
  calendar's own code confirms per-path is the right model
  (`dir.isWritable()`, checked once per calendar's own source).
- **Dark mode**: reads Peergos's `?theme=` param once at launch.
- **Navigation**: ISO week numbers, swipe/Previous/Next/Today/search all
  share a slide transition. The toolbar title is clickable/tappable to
  jump to any month/year via a Month `<select>` + year number field
  (`openGotoDatePicker()`/`navigateToSelectedMonthYear()` in
  calendar.js) - a popover on desktop, a full-width bottom sheet below
  `MOBILE_BREAKPOINT`. The year field has explicit +/− buttons and
  auto-navigates ~600ms after a 4-digit year is typed. Empty day
  cells/columns highlight on hover (`[data-date]:hover`) as a hint
  they're clickable. Pinch/double-tap zoom is off (`touch-action` in
  calendar.css - iOS Safari has ignored the viewport meta tag's
  `user-scalable` since iOS 10, so the meta tag alone isn't enough).
- **Back button (Android)**: the hardware/gesture back button closes the
  topmost open overlay (modal → popover → search → menu → sidebar
  drawer) instead of leaving the app, same order as Escape. At the root
  it shows a "press back again to exit" toast rather than exiting
  outright (see Architecture decisions for the press-count caveat).

## For maintainers

### Architecture decisions

- Sandboxed app, not built into `web-ui`.
- FullCalendar 7.0.2, Standard bundle (MIT) + `@fullcalendar/rrule`.
- Permissions `READ_CALENDAR`/`WRITE_CALENDAR` not yet implemented in
  `peergos` core.
- Sharing uses an existing app-facing API, not confirmed working from a
  sandboxed context yet. The old built-in calendar (`web-ui`) never
  actually offers write-access sharing either, despite the underlying
  Peergos sharing primitive supporting it (`readAccess`/`writeAccess`,
  an `allowReadWriteSharing` flag) - it always calls its own share
  dialog with that flag hardcoded off.
- Search is client-side, behind `getSearchableEvents()`.
- No drag-and-drop (FullCalendar/Android WebView compatibility risk) -
  editing goes through the edit popup, creating is `dateClick`.
- `openModal()` runs while the tap that triggered it is still resolving
  (`dateClick`/`eventClick` fire on `touchend`), so that gesture's own
  trailing mouse events hit whatever the modal has just put under that
  point - on a phone, usually one of its `<select>`s, which then opens
  on its own. Guarded by matching those trailing events on point+time
  (`armModalTapGuard()`/`isModalTapTail()`) plus a `focusin` backstop.
  It deliberately never touches `pointer-events` and never calls
  `preventDefault()` on the triggering gesture itself - three earlier
  attempts that did each broke single-tap-opens-the-modal on real
  devices. Treat as load-bearing.
- Back-button handling (`closeTopmostOverlay()`/
  `armOverlayBackHandling()`/`armExitGuard()`) rides on
  `history.pushState()`: the Android host maps its back button to
  `webView.goBack()`, which unwinds same-document history entries as a
  `popstate` without leaving the page. The "armed" flag is read from
  `history.state` itself rather than a tracked boolean — overlays also
  close via Escape/buttons/backdrop clicks, none of which touch history,
  so a boolean goes stale and double-pushes. Overlays are detected with
  a `MutationObserver` on `.open` classes, since each one opens from its
  own call site with no shared choke point. The exit toast is a 3-press
  approximation, not 2: a page can't close its own hosting Activity, so
  it can only react to a press that has already navigated. An exact
  2-press version needs a native-side change instead.
- Timed events reuse Breezy's own light-tint chip formula (`color-mix(in
  oklab, …)`, taken from its vendored `theme.css`) so they match the
  treatment Breezy already gives all-day/multi-day events. A solid fill
  with per-color computed contrast text was tried and reverted —
  Breezy's default event text color is used as-is.
- `.ics` stays plain RFC 5545.
- Timezone-aware export/import (calendar.js, "Timezone conversion" and
  ".ics" sections) - derived entirely from the browser's own `Intl` tz
  database, no bundled IANA rule table:
  - Single events export as a fixed UTC instant - correct for anyone
    sharing across zones, no `VTIMEZONE` needed.
  - Recurring series export with `TZID=<this app's current IANA zone>`
    on `DTSTART`/`DTEND`/`EXDATE` (`RRULE`'s `UNTIL` in UTC instead, per
    spec) plus a generated `VTIMEZONE` block, so occurrences stay pinned
    to local time across a DST change. No per-event zone picker - always
    this app's current zone.
  - Import resolves `TZID` via, in order: a recognized IANA name, a
    mapped legacy name (`LEGACY_TZID_TO_IANA` - some desktop calendar
    clients use these instead of IANA names), the file's own embedded
    `VTIMEZONE` block, then floating-local as a last resort. A bare UTC
    value skips all of this.
  - Known limitation: an ambiguous/nonexistent local time (fall-back's
    repeated hour, spring-forward's skipped one) resolves to one side
    deterministically - shared with most timezone libraries.
  - A TZID from an imported file is an untrusted object key - lookups
    use `Object.create(null)`/`hasOwnProperty`, not bare `{}` + `[key]`.
    A TZID of `"__proto__"` used to read back `Object.prototype` instead
    of `undefined`, crashing the whole import. The VTIMEZONE-fallback
    RRULE parser also only allows `YEARLY`/`MONTHLY`/`WEEKLY`/`DAILY`
    (same as the regular event importer) - an unbounded `FREQ=SECONDLY`
    observance froze a real browser tab.

### Requirements

- Recurring events (done)
- Scoped recurring edits — this/following/all (done)
- Event fields: title, location, description, color, status (done)
- Multiple calendars: create/rename/delete/recolor, filtering (done)
- Sharing a calendar or event (UI done, mock data)
- `.ics` import/export incl. email (done)
- Read-only mode, whole-calendar or per-event (done)
- Dark mode (done)
- Timezone handling (done - see Architecture decisions)
- Guest/secret-link access (UI done, mock data - see Architecture
  decisions on the sharing API caveat)
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
- Breezy 7.0.2 bug: clicking a custom `headerToolbar` button (the
  `buttons` option) throws an uncaught internal `refineProps` error,
  independent of this app's own code; built-in buttons
  (`prev`/`today`/`next`/etc.) are unaffected. Use a plain button
  outside FullCalendar's own toolbar instead (see "+" new event above).
- `datesSet`'s own DOM (e.g. the title heading) isn't safe to read back
  from once you've replaced its children yourself - FullCalendar's vdom
  then stops finding the plain text node it expects there and silently
  stops updating it on later renders. Use `arg.view.title` instead of
  the heading's own `textContent`.
- FullCalendar v7 renamed several documented options without an alias:
  `customButtons` → `buttons`, and `buttonText: { list: ... }` → a flat
  `listText`. Don't trust option names from older docs/examples.
- `rrule.RRule.parseString()`/`.between()` (already vendored for
  recurring events) are reused to expand an imported `VTIMEZONE`
  block's own `RRULE`-based DST observances - no separate evaluator
  needed for that path.
- Icons are inlined in HTML/JS for `currentColor` dark-mode support.
- `assets/icon.png`: solid black, transparent background, 512x512.
- To update: bump the version, replace that package's `vendor/` folder.

### Open items (tracked, not actionable from this repo)

- `READ_CALENDAR`/`WRITE_CALENDAR` permissions — blocks real save/load.
  `peergos-app.json` currently declares none, so the app installs and
  runs today; add them back once the permissions exist.
- Confirmation the sharing API is reachable from a sandboxed app.
- Reminders/notifications need a Service Worker + Push API + a server —
  unconfirmed support in sandboxed apps/Android WebView.
- `.ics` import's file picker needs Android WebView's
  `onShowFileChooser()` — unconfirmed on Android, confirmed on desktop.
- `.ics` export/email is blocked in a real Peergos run: the sandboxed-app
  CSP is missing the `allow-downloads` token. Server-side fix, not
  calendar-specific.
