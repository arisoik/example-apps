# Vendored third-party libraries

No build step (no npm/webpack). Each package lives under `vendor/<package>/`
with the upstream source's own internal directory layout preserved, so a
local file's path doubles as its provenance and updating is a straight
re-copy of that subfolder.

## FullCalendar v7.0.1 (Standard bundle + all locales, MIT)

Source: the official GitHub release ZIP asset — not npm, not jsDelivr.

```
https://github.com/fullcalendar/fullcalendar/releases/download/v7.0.1/fullcalendar-7.0.1.zip
```

`vendor/fullcalendar/dist/` is a subset copy of the ZIP's
`fullcalendar-7.0.1/dist/` folder (same relative paths). Only the `classic`
theme is kept (ZIP also ships `breezy`/`forma`/`monarch`, unused here):

| Local path | ZIP path |
|---|---|
| `vendor/fullcalendar/dist/fullcalendar.global.js` | `dist/fullcalendar.global.js` |
| `vendor/fullcalendar/dist/skeleton.css` | `dist/skeleton.css` |
| `vendor/fullcalendar/dist/locales-all/global.js` | `dist/locales-all/global.js` |
| `vendor/fullcalendar/dist/themes/classic/global.js` | `dist/themes/classic/global.js` |
| `vendor/fullcalendar/dist/themes/classic/theme.css` | `dist/themes/classic/theme.css` |
| `vendor/fullcalendar/dist/themes/classic/palette.css` | `dist/themes/classic/palette.css` |

Docs: https://fullcalendar.io/docs/initialize-globals and
https://fullcalendar.io/docs/locale (`locales-all/global.js` self-registers
every locale; `index.html` picks one via the `locale:` config option, set
from `navigator.language`).

**Don't vendor `fullcalendar`'s `.min.js`/`.min.css` from jsDelivr** —
this package ships no pre-built minified files, so a jsDelivr `.min.*` URL
returns a file Terser-minified on the fly by jsDelivr itself (tell: the
comment `Minified by jsDelivr using Terser... dynamically generated
files`), not something FullCalendar actually publishes.

## RRule plugin `@fullcalendar/rrule` v7.0.1 (MIT)

`vendor/fullcalendar-rrule/` mirrors the npm package root (no `dist/` in
this package — the built file is at the top level). Load alongside `rrule`
below, not instead of it (adapter only, doesn't bundle rrule's parsing) —
`rrule.min.js` must load first. https://fullcalendar.io/docs/rrule-plugin

| Local path | Tarball path |
|---|---|
| `vendor/fullcalendar-rrule/global.js` | `package/global.js` |

```
https://registry.npmjs.org/@fullcalendar/rrule/-/rrule-7.0.1.tgz
```

npm-only: no GitHub release ZIP asset exists for this package.

## RRule library `rrule` v2.8.1 (MIT)

`vendor/rrule/` mirrors the npm package's internal path:

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
frozen spec, not abandonment — repo isn't archived, still gets commits.

## How to update to a newer release

Follow the source links above for each package, bump the version in the
URL, and replace that package's `vendor/` subfolder wholesale with what you
download — local paths mirror upstream paths, so nothing needs renaming.
Then re-check `index.html` and the docs links above for anything new.
