let pad = n => String(n).padStart(2, '0');

function toDateInputValue(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function toTimeInputValue(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function addDays(date, n) {
    let d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

// The form always shows the all-day end date inclusively (the event's last
// actual day), matching how a user thinks about it. FullCalendar itself
// stores all-day end dates exclusively (the moment after the event), so
// that conversion happens only at these two boundaries: populating the
// form from an event, and reading the form back into one.
function toFormEnd(end, allDay) {
    return allDay ? addDays(end, -1) : end;
}

function fromFormEnd(allDay) {
    if (!allDay) return new Date(endDateInput.value + 'T' + endTimeInput.value);
    return toDateInputValue(addDays(new Date(endDateInput.value + 'T00:00'), 1));
}

function computeDurationMs(start, end, allDay) {
    let startMs = allDay ? new Date(start + 'T00:00').getTime() : start.getTime();
    let endMs = allDay ? new Date(end + 'T00:00').getTime() : end.getTime();
    return endMs - startMs;
}

// rrule.js reads Date fields via UTC getters regardless of the actual
// local timezone (the same bug documented for @fullcalendar/rrule in the
// README's Vendored dependencies section - found there, fixed there by
// always handing the *plugin* bare date strings instead of Date objects).
// The helpers below call the rrule library directly, bypassing that
// plugin's own translation layer, so they need the equivalent fix
// themselves: build/read dates via their UTC fields instead of their
// local ones, so rrule.js's UTC getters see the intended wall-clock
// values regardless of the browser's own timezone.
function toFakeUtc(localDate) {
    return new Date(Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate(), localDate.getHours(), localDate.getMinutes(), localDate.getSeconds()));
}

function fromFakeUtc(fakeUtcDate) {
    return new Date(fakeUtcDate.getUTCFullYear(), fakeUtcDate.getUTCMonth(), fakeUtcDate.getUTCDate(), fakeUtcDate.getUTCHours(), fakeUtcDate.getUTCMinutes(), fakeUtcDate.getUTCSeconds());
}

let WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function weekdayCodeOf(date) {
    return WEEKDAY_CODES[date.getDay()];
}

// 1-5 for "the nth <weekday> of this month", or -1 if this date is in
// the final 7 days of the month ("the last <weekday>") - matches Google
// Calendar's own monthly-repeat convention.
function nthWeekdayOfMonth(date) {
    let day = date.getDate();
    let daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return (day + 7 > daysInMonth) ? -1 : Math.ceil(day / 7);
}

let ORDINAL_LABELS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };
let WEEKDAY_LABELS = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };

// recur.byday holds RRULE-text-style day codes - plain ('MO') for a
// weekly series repeating on that weekday, ordinal-prefixed ('2TU',
// '-1FR') for "the nth weekday of the month". Same array shape is reused
// for both ICS export (BYDAY=MO,WE,FR joins directly) and here, where
// each code becomes an actual rrule.js Weekday instance (not a plain
// string) - only RRule's own class exposes a `.nth()` method for the
// ordinal case, and passing an instance through works for the plain case
// too, so there's one code path instead of two.
function rruleByweekdayFromByday(byday) {
    return byday.map(function (code) {
        let m = code.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
        if (!m) return null;
        let day = rrule.RRule[m[2]];
        return m[1] ? day.nth(parseInt(m[1], 10)) : day;
    }).filter(Boolean);
}

function rruleOptionsFor(recur, allDay) {
    let dtstart = allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
    let options = { freq: rrule.RRule[recur.freq.toUpperCase()], interval: recur.interval, dtstart: toFakeUtc(dtstart) };
    if (recur.byday && recur.byday.length) options.byweekday = rruleByweekdayFromByday(recur.byday);
    return options;
}

// The occurrence immediately before `date` (exclusive), ignoring
// count/until/exdates - used only to find a truncation boundary for
// "this and following" splits, where the original series' own bounds
// don't matter (a fresh boundary is being computed specifically to
// replace them). Returns null if `date` is the series' first occurrence
// (nothing comes before it) - the caller uses that to remove the
// original series outright instead of leaving a degenerate rule.
function previousOccurrenceBoundary(recur, allDay, date) {
    let rr = new rrule.RRule(rruleOptionsFor(recur, allDay));
    let result = rr.before(toFakeUtc(date), false);
    return result ? fromFakeUtc(result) : null;
}

// How many occurrences of the base pattern (ignoring count/until/exdates,
// same reasoning as previousOccurrenceBoundary) fall before targetDate -
// used only to shrink a remaining COUNT when splitting a series.
function countOccurrencesBefore(recur, allDay, targetDate) {
    let rr = new rrule.RRule(rruleOptionsFor(recur, allDay));
    let fakeTarget = toFakeUtc(targetDate).getTime();
    return rr.all(function (dt) { return dt.getTime() < fakeTarget; }).length;
}

function buildRRuleSet(recur, allDay) {
    let options = rruleOptionsFor(recur, allDay);
    if (recur.end === 'until' && recur.until) options.until = toFakeUtc(new Date(formatUntil(recur.until, recur.dtstart, allDay)));
    if (recur.end === 'count' && recur.count) options.count = recur.count;
    let set = new rrule.RRuleSet();
    set.rrule(new rrule.RRule(options));
    (recur.exdates || []).forEach(function (exStr) {
        set.exdate(toFakeUtc(allDay ? new Date(exStr + 'T00:00') : new Date(exStr)));
    });
    return set;
}

// Nearest occurrence to referenceDate, clamped to count/until and nudged
// off any exdate (all handled natively by RRuleSet). Compares against the
// start of referenceDate's day, not its exact time - otherwise a daily
// event's occurrence for today looks "already past" once its time-of-day
// has elapsed, and this skips ahead to tomorrow instead of the occurrence
// actually shown in the grid today.
function nearestRecurOccurrenceDate(recur, allDay, referenceDate) {
    let dayStart = toFakeUtc(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()));
    let set = buildRRuleSet(recur, allDay);
    let result = set.after(dayStart, true) || set.before(dayStart, true);
    return result ? fromFakeUtc(result) : (allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart));
}

// RFC5545 requires UNTIL's precision to match DTSTART's - a date-only
// UNTIL on a timed series would exclude that day's own occurrence, since
// its time is always later than midnight. Carry the series' own
// time-of-day forward so the boundary occurrence is correctly included.
function formatUntil(dateOnlyStr, dtstartStr, allDay) {
    if (allDay || !dateOnlyStr) return dateOnlyStr;
    let time = dtstartStr.includes('T') ? dtstartStr.split('T')[1] : '23:59';
    return dateOnlyStr + 'T' + time;
}

function mockDate(dayOffset, hour, minute) {
    let d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour || 0, minute || 0, 0, 0);
    return d;
}

let gymStart = mockDate(0, 7, 0);

let url = new URL(window.location.href);
let filePath = url.searchParams.get('path');
let isWritable = url.searchParams.get('isPathWritable') == 'true';
let theme = url.searchParams.get('theme');
let isDarkMode = theme === 'dark-mode';
if (isDarkMode) document.documentElement.setAttribute('data-color-scheme', 'dark');

// Fixed palette, not free-form color picking - matches Google Calendar's
// own calendar-color picker (a small set of pre-chosen, legible colors)
// rather than letting a user land on something unreadable against white
// event text.
let CALENDAR_COLORS = ['#3788d8', '#8e24aa', '#0b8043', '#e67c73', '#f4511e', '#e53935'];

// Index-matched to CALENDAR_COLORS - the same colors saturated/lightened
// for legibility against a dark background, since colors picked to read
// well on white (the swatch/checkbox identity, stored in `cal.color`)
// tend to look muddy or low-contrast once the surrounding UI goes dark.
// Only ever used for *display* (events, checkboxes, swatch previews);
// `cal.color` itself always stays the light-mode identity value so
// swatch-selection matching and saved data stay stable regardless of
// which mode was active when a calendar was created or edited.
let CALENDAR_COLORS_DARK = ['#60a5fa', '#c084fc', '#4ade80', '#fca5a5', '#fb923c', '#f87171'];

function displayColor(hex) {
    if (!isDarkMode) return hex;
    let idx = CALENDAR_COLORS.indexOf(hex);
    return idx >= 0 ? CALENDAR_COLORS_DARK[idx] : hex;
}

// `primary: true` marks the one calendar that can never be deleted -
// matches Google Calendar/Outlook/Apple Calendar, which all protect your
// primary calendar the same way (you can rename or recolor it, just not
// remove it - there always has to be somewhere for events to land).
let mockCalendars = [
    { id: 'cal-personal', name: 'Personal', color: CALENDAR_COLORS[0], visible: true, primary: true },
    { id: 'cal-work', name: 'Work', color: CALENDAR_COLORS[1], visible: true }
];

let mockEvents = [
    {
        id: 'mock-1',
        title: 'Team sync',
        start: mockDate(1, 10, 0),
        end: mockDate(1, 11, 0),
        allDay: false,
        color: displayColor(CALENDAR_COLORS[1]),
        extendedProps: { location: 'Meeting room 2', description: 'Weekly planning call', status: 'active', recur: null, calendarId: 'cal-work' }
    },
    {
        id: 'mock-2',
        title: 'Company retreat',
        start: mockDate(3),
        end: mockDate(6),
        allDay: true,
        color: displayColor(CALENDAR_COLORS[1]),
        extendedProps: { location: 'Lake house', description: '', status: 'active', recur: null, calendarId: 'cal-work' }
    },
    {
        id: 'mock-3',
        title: 'Dentist',
        start: mockDate(-2, 9, 30),
        end: mockDate(-2, 10, 0),
        allDay: false,
        color: displayColor(CALENDAR_COLORS[0]),
        extendedProps: { location: '', description: '', status: 'cancelled', recur: null, calendarId: 'cal-personal' }
    },
    {
        id: 'mock-4',
        title: 'Gym',
        allDay: false,
        rrule: { freq: 'daily', interval: 1, dtstart: toDateInputValue(gymStart) + 'T' + toTimeInputValue(gymStart), count: 10 },
        duration: { minutes: 45 },
        color: displayColor(CALENDAR_COLORS[0]),
        extendedProps: {
            location: 'Downtown gym', description: '', status: 'active', calendarId: 'cal-personal',
            recur: {
                freq: 'daily', interval: 1, end: 'count', until: null, count: 10,
                dtstart: toDateInputValue(gymStart) + 'T' + toTimeInputValue(gymStart), exdates: []
            }
        }
    }
];

let modalBackdrop = document.getElementById('event-modal-backdrop');
let form = document.getElementById('event-form');
let titleInput = document.getElementById('event-title');
let calendarSelectInput = document.getElementById('event-calendar');
let allDayInput = document.getElementById('event-all-day');
let startDateInput = document.getElementById('event-start-date');
let startTimeInput = document.getElementById('event-start-time');
let endDateInput = document.getElementById('event-end-date');
let endTimeInput = document.getElementById('event-end-time');
let locationInput = document.getElementById('event-location');
let repeatSection = document.getElementById('event-repeat-section');
let repeatFreqInput = document.getElementById('event-repeat-freq');
let repeatDetails = document.getElementById('event-repeat-details');
let repeatIntervalInput = document.getElementById('event-repeat-interval');
let repeatIntervalUnit = document.getElementById('event-repeat-interval-unit');
let repeatEndInput = document.getElementById('event-repeat-end');
let repeatUntilInput = document.getElementById('event-repeat-until');
let repeatCountRow = document.getElementById('event-repeat-count-row');
let repeatCountInput = document.getElementById('event-repeat-count');
let repeatWeekdayRow = document.getElementById('event-repeat-weekday-row');
let weekdayToggleButtons = Array.prototype.slice.call(document.querySelectorAll('.weekday-toggle'));
let repeatMonthlyModeInput = document.getElementById('event-repeat-monthly-mode');
let statusInput = document.getElementById('event-status');
let descriptionInput = document.getElementById('event-description');
let deleteButton = document.getElementById('event-delete');
let saveButton = document.getElementById('event-save');
let cancelButton = document.getElementById('event-cancel');
let modalHeading = document.getElementById('event-modal-heading');
let editableFields = [
    titleInput, calendarSelectInput, allDayInput, startDateInput, startTimeInput, endDateInput, endTimeInput,
    locationInput, repeatFreqInput, repeatIntervalInput, repeatEndInput, repeatUntilInput,
    repeatCountInput, statusInput, descriptionInput, repeatMonthlyModeInput
].concat(weekdayToggleButtons);

let scopeModalBackdrop = document.getElementById('scope-modal-backdrop');
let scopeSubtitle = document.getElementById('scope-subtitle');
let scopeConfirmButton = document.getElementById('scope-confirm');
let scopeCancelButton = document.getElementById('scope-cancel');

let popover = document.getElementById('event-popover');
let popoverTitle = document.getElementById('popover-title');
let popoverTimeRow = document.getElementById('popover-time-row');
let popoverTime = document.getElementById('popover-time');
let popoverRepeatRow = document.getElementById('popover-repeat-row');
let popoverRepeat = document.getElementById('popover-repeat');
let popoverLocationRow = document.getElementById('popover-location-row');
let popoverLocation = document.getElementById('popover-location');
let popoverDescriptionRow = document.getElementById('popover-description-row');
let popoverDescription = document.getElementById('popover-description');
let popoverActions = document.getElementById('popover-actions');
let popoverCloseButton = document.getElementById('popover-close');
let popoverEditButton = document.getElementById('popover-edit');
let popoverDuplicateButton = document.getElementById('popover-duplicate');
let popoverExportButton = document.getElementById('popover-export');
let popoverEmailButton = document.getElementById('popover-email');
let popoverDeleteButton = document.getElementById('popover-delete');
let icsFileInput = document.getElementById('ics-file-input');
let overflowMenuButton = document.getElementById('overflow-menu-button');
let overflowMenu = document.getElementById('overflow-menu');
let overflowImportButton = document.getElementById('overflow-import-button');
let overflowMenuVersion = document.getElementById('overflow-menu-version');
let searchBar = document.getElementById('search-bar');
let searchButton = document.getElementById('search-button');
let searchClearButton = document.getElementById('search-clear-button');
let searchInput = document.getElementById('search-input');
let searchResults = document.getElementById('search-results');

let sidebar = document.getElementById('sidebar');
let sidebarBackdrop = document.getElementById('sidebar-backdrop');
let sidebarToggleButton = document.getElementById('sidebar-toggle-button');
let calendarListEl = document.getElementById('calendar-list');
let addCalendarButton = document.getElementById('add-calendar-button');
let calendarModalBackdrop = document.getElementById('calendar-modal-backdrop');
let calendarForm = document.getElementById('calendar-form');
let calendarModalHeading = document.getElementById('calendar-modal-heading');
let calendarNameInput = document.getElementById('calendar-name-input');
let calendarColorSwatches = document.getElementById('calendar-color-swatches');
let calendarDeleteButton = document.getElementById('calendar-delete');
let calendarCancelButton = document.getElementById('calendar-cancel');
let confirmModalBackdrop = document.getElementById('confirm-modal-backdrop');
let confirmModalMessage = document.getElementById('confirm-modal-message');
let confirmCancelButton = document.getElementById('confirm-cancel');
let confirmOkButton = document.getElementById('confirm-ok');
let importSummaryModalBackdrop = document.getElementById('import-summary-modal-backdrop');
let importSummaryMessage = document.getElementById('import-summary-message');
let importSummaryOkButton = document.getElementById('import-summary-ok');

let editingEvent = null;
let editScope = 'all';
let pendingScopeEvent = null;
let pendingScopeAction = 'edit';
let popoverEvent = null;

function setInputMode(allDay) {
    startTimeInput.style.display = allDay ? 'none' : '';
    endTimeInput.style.display = allDay ? 'none' : '';
    startTimeInput.required = !allDay;
    endTimeInput.required = !allDay;
}

let intervalUnitLabels = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };

function selectedWeekdays() {
    return weekdayToggleButtons.filter(function (b) { return b.classList.contains('selected'); }).map(function (b) { return b.dataset.day; });
}

function setSelectedWeekdays(codes) {
    weekdayToggleButtons.forEach(function (b) { b.classList.toggle('selected', codes.indexOf(b.dataset.day) !== -1); });
}

function formStartDate() {
    return new Date(startDateInput.value + 'T00:00');
}

// "Monthly on day 15" / "Monthly on the 3rd Tuesday" - option text is
// computed from the form's own start date (not fixed strings), matching
// Google Calendar's own monthly-repeat picker.
function updateMonthlyModeLabels() {
    let start = formStartDate();
    let dayOfMonthOpt = repeatMonthlyModeInput.querySelector('option[value="dayOfMonth"]');
    let nthWeekdayOpt = repeatMonthlyModeInput.querySelector('option[value="nthWeekday"]');
    dayOfMonthOpt.textContent = 'Monthly on day ' + start.getDate();
    let n = nthWeekdayOfMonth(start);
    nthWeekdayOpt.textContent = 'Monthly on the ' + ORDINAL_LABELS[n] + ' ' + WEEKDAY_LABELS[weekdayCodeOf(start)];
}

function updateRepeatVisibility() {
    let freq = repeatFreqInput.value;
    let repeating = !!freq;
    repeatDetails.style.display = repeating ? '' : 'none';
    repeatIntervalUnit.textContent = intervalUnitLabels[freq] || 'day(s)';
    let endMode = repeatEndInput.value;
    repeatUntilInput.style.display = (repeating && endMode === 'until') ? '' : 'none';
    repeatCountRow.style.display = (repeating && endMode === 'count') ? '' : 'none';
    repeatWeekdayRow.style.display = (freq === 'weekly') ? '' : 'none';
    repeatMonthlyModeInput.style.display = (freq === 'monthly') ? '' : 'none';
    // Nothing checked yet (a fresh event, or freq just switched to
    // weekly) defaults to the form's own start-date weekday, matching
    // Google Calendar's own weekly-repeat picker - editing an existing
    // weekly series already has real selections by this point (set in
    // populateRecurForm before it calls this), so this is a no-op there.
    if (freq === 'weekly' && !selectedWeekdays().length) setSelectedWeekdays([weekdayCodeOf(formStartDate())]);
    if (freq === 'monthly') updateMonthlyModeLabels();
}

function populateRecurForm(recur) {
    repeatFreqInput.value = recur ? recur.freq : '';
    repeatIntervalInput.value = recur ? recur.interval : 1;
    repeatEndInput.value = recur ? recur.end : 'never';
    repeatUntilInput.value = (recur && recur.until) ? recur.until : '';
    repeatCountInput.value = (recur && recur.count) ? recur.count : 10;
    let byday = (recur && recur.byday) || [];
    setSelectedWeekdays(recur && recur.freq === 'weekly' ? byday : []);
    repeatMonthlyModeInput.value = (recur && recur.freq === 'monthly' && byday.length) ? 'nthWeekday' : 'dayOfMonth';
    updateRepeatVisibility();
}

function readRecurFromForm() {
    let freq = repeatFreqInput.value;
    if (!freq) return null;
    let end = repeatEndInput.value;
    let recur = {
        freq: freq,
        interval: parseInt(repeatIntervalInput.value, 10) || 1,
        end: end,
        until: end === 'until' ? repeatUntilInput.value : null,
        count: end === 'count' ? (parseInt(repeatCountInput.value, 10) || 1) : null,
        exdates: []
    };
    if (freq === 'weekly') {
        let days = selectedWeekdays();
        recur.byday = days.length ? days : [weekdayCodeOf(formStartDate())];
    } else if (freq === 'monthly' && repeatMonthlyModeInput.value === 'nthWeekday') {
        let start = formStartDate();
        recur.byday = [nthWeekdayOfMonth(start) + weekdayCodeOf(start)];
    }
    return recur;
}

function nextEventId() {
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// Whole-series editing: the form always shows the SERIES' true original
// start/end, not whichever occurrence was clicked to open it - otherwise
// saving without touching the date fields would silently shift the entire
// series to start from that occurrence. The series' real dtstart is kept
// in extendedProps.recur.dtstart (our own copy, since FullCalendar's Event
// object only exposes the clicked occurrence's own start/end, not the rule
// that generated it). Occurrence duration is constant across a series, so
// the clicked occurrence's own (end - start) is a safe stand-in for it.
function seriesFormRange(ev, recur, allDay) {
    let occurrenceDurationMs = (ev.end || ev.start).getTime() - ev.start.getTime();
    let seriesStart = allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
    let seriesEndExclusive = new Date(seriesStart.getTime() + occurrenceDurationMs);
    return { start: seriesStart, end: toFormEnd(seriesEndExclusive, allDay) };
}

// Populating the form for "this and following": shown starting from the
// clicked occurrence (this becomes a new sub-series), with the remaining
// occurrence count reduced by however many already happened before it -
// otherwise the form would default to showing the ORIGINAL total count.
function adjustRecurForFollowing(ev, masterRecur, allDay) {
    let recur = Object.assign({}, masterRecur);
    if (recur.end === 'count' && recur.count) {
        let consumed = countOccurrencesBefore(masterRecur, allDay, ev.start);
        recur.count = Math.max(1, masterRecur.count - consumed);
    }
    recur.exdates = [];
    return recur;
}

function extraPropsOf(ev) {
    return { location: ev.extendedProps.location, status: ev.extendedProps.status, description: ev.extendedProps.description, calendarId: ev.extendedProps.calendarId };
}

function colorForCalendarId(calendarId) {
    let cal = getCalendarById(calendarId);
    return displayColor(cal ? cal.color : CALENDAR_COLORS[0]);
}

function buildRecurringEventPayload(id, title, allDay, extra, recur, durationMs) {
    let rrule = { freq: recur.freq, interval: recur.interval, dtstart: recur.dtstart };
    if (recur.end === 'until' && recur.until) rrule.until = formatUntil(recur.until, recur.dtstart, allDay);
    if (recur.end === 'count' && recur.count) rrule.count = recur.count;
    if (recur.byday && recur.byday.length) rrule.byweekday = rruleByweekdayFromByday(recur.byday);
    let color = colorForCalendarId(extra.calendarId);
    let data = {
        id: id,
        title: title,
        allDay: allDay,
        rrule: rrule,
        // the plugin's own duration refiner mishandles a bare number for
        // recurring events (verified empirically - results in end == start,
        // invisible in timeGrid views); the {milliseconds: N} object form
        // works correctly, so wrap it rather than pass the number directly
        duration: { milliseconds: durationMs },
        color: color,
        extendedProps: Object.assign({ recur: recur }, extra)
    };
    if (recur.exdates && recur.exdates.length) data.exdate = recur.exdates.slice();
    return data;
}

function buildPlainEventPayload(id, title, allDay, start, end, extra) {
    let color = colorForCalendarId(extra.calendarId);
    return {
        id: id,
        title: title,
        allDay: allDay,
        start: start,
        end: end,
        color: color,
        extendedProps: Object.assign({ recur: null }, extra)
    };
}

// --- .ics (RFC 5545) export/import ---
// Verified against the actual RFC 5545 spec text, not memory, for the
// details most likely to break real-world portability: TEXT escaping
// (section 3.3.11), line folding (section 3.1), and - critically - that
// UNTIL must be floating local time with no "Z" when DTSTART is floating
// local time (section 3.3.10). Getting that last one wrong would silently
// break every recurring event's export despite looking fine in our own UI.

function escapeIcsText(str) {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function unescapeIcsText(str) {
    return str.replace(/\\(\\|;|,|[nN])/g, function (m, c) {
        return (c === 'n' || c === 'N') ? '\n' : c;
    });
}

function foldIcsLine(line) {
    if (line.length <= 75) return line;
    let out = line.slice(0, 75);
    let rest = line.slice(75);
    while (rest.length > 0) {
        out += '\r\n ' + rest.slice(0, 74);
        rest = rest.slice(74);
    }
    return out;
}

function icsDateStamp(date) {
    return toDateInputValue(date).replace(/-/g, '');
}

function icsDateTimeStamp(date) {
    return icsDateStamp(date) + 'T' + toTimeInputValue(date).replace(':', '') + '00';
}

function icsUtcNow() {
    return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function icsDtLine(name, date, allDay) {
    return allDay ? (name + ';VALUE=DATE:' + icsDateStamp(date)) : (name + ':' + icsDateTimeStamp(date));
}

// Converts our internal dash/colon date strings ("2026-08-15" or
// "2026-08-15T07:00") to RFC 5545's compact form ("20260815" /
// "20260815T070000").
function toIcsCompact(dashColonStr, allDay) {
    if (allDay) return dashColonStr.replace(/-/g, '');
    let parts = dashColonStr.split('T');
    return parts[0].replace(/-/g, '') + 'T' + parts[1].replace(':', '') + '00';
}

function recurToIcsRRuleLine(recur, allDay) {
    let freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
    let parts = ['FREQ=' + freqMap[recur.freq]];
    if (recur.interval > 1) parts.push('INTERVAL=' + recur.interval);
    // recur.byday is already RRULE-text shape (plain 'MO' or ordinal
    // '2TU'/'-1FR') - see rruleByweekdayFromByday()'s own comment - so it
    // joins directly, no translation needed here.
    if (recur.byday && recur.byday.length) parts.push('BYDAY=' + recur.byday.join(','));
    if (recur.end === 'count' && recur.count) {
        parts.push('COUNT=' + recur.count);
    } else if (recur.end === 'until' && recur.until) {
        parts.push('UNTIL=' + toIcsCompact(formatUntil(recur.until, recur.dtstart, allDay), allDay));
    }
    return 'RRULE:' + parts.join(';');
}

function recurToIcsExdateLine(recur, allDay) {
    if (!recur.exdates || !recur.exdates.length) return null;
    let values = recur.exdates.map(function (s) { return toIcsCompact(s, allDay); });
    return (allDay ? 'EXDATE;VALUE=DATE:' : 'EXDATE:') + values.join(',');
}

// Inverse of the `UID:<id>@peergos.org` export format below - lets a
// re-imported file we exported ourselves resolve back to the same event
// id, which is what makes duplicate detection on import possible at all.
// An externally-sourced UID (any other shape) is used as-is; FullCalendar
// ids are opaque strings, so there's nothing to unpack for those.
let PEERGOS_UID_SUFFIX = '@peergos.org';

function idFromIcsUid(uid) {
    return uid.endsWith(PEERGOS_UID_SUFFIX) ? uid.slice(0, -PEERGOS_UID_SUFFIX.length) : uid;
}

// Only ids we minted ourselves (nextEventId()'s own "evt-<ts>-<rand>"
// shape) get a Peergos UID - RFC 5545's UID is meant to be a stable
// identity for that event across every system it passes through, not
// something to rewrite just because it was imported here. Re-exporting a
// foreign event (Google, Outlook, ...) keeps its original UID untouched,
// so re-importing that file back into its source app is still recognized
// as the same event rather than a new duplicate.
function isNativeEventId(id) {
    return /^evt-\d+-[a-z0-9]+$/.test(id);
}

// A recurring event with no occurrence in the currently rendered date
// range has ev.start === null on its EventApi (same quirk documented for
// getSearchableEvents() above) - duration can't be derived from start/end
// in that case. Every recurring event this app creates always has a
// `{ milliseconds: N }` duration (buildRecurringEventPayload never uses
// years/months/days), so reading it straight off the internal event-store
// def is exact, not an approximation.
function recurringDurationMs(eventId) {
    let defs = calendar.getCurrentData().eventStore.defs;
    let key = Object.keys(defs).find(function (k) { return defs[k].publicId === eventId; });
    let dur = key && defs[key].recurringDef && defs[key].recurringDef.duration;
    return dur ? dur.milliseconds : 0;
}

function eventToIcsLines(ev) {
    let uid = isNativeEventId(ev.id) ? ev.id + PEERGOS_UID_SUFFIX : ev.id;
    let lines = ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + icsUtcNow()];
    let recur = ev.extendedProps.recur;

    if (recur) {
        let dtstart = ev.allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
        let durationMs = ev.start ? (ev.end || ev.start).getTime() - ev.start.getTime() : recurringDurationMs(ev.id);
        lines.push(icsDtLine('DTSTART', dtstart, ev.allDay));
        lines.push(icsDtLine('DTEND', new Date(dtstart.getTime() + durationMs), ev.allDay));
        lines.push(recurToIcsRRuleLine(recur, ev.allDay));
        let exdateLine = recurToIcsExdateLine(recur, ev.allDay);
        if (exdateLine) lines.push(exdateLine);
    } else {
        lines.push(icsDtLine('DTSTART', ev.start, ev.allDay));
        lines.push(icsDtLine('DTEND', ev.end || ev.start, ev.allDay));
    }

    lines.push('SUMMARY:' + escapeIcsText(ev.title));
    if (ev.extendedProps.location) lines.push('LOCATION:' + escapeIcsText(ev.extendedProps.location));
    if (ev.extendedProps.description) lines.push('DESCRIPTION:' + escapeIcsText(ev.extendedProps.description));
    lines.push('STATUS:' + (ev.extendedProps.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'));
    lines.push('END:VEVENT');
    return lines;
}

function icsFileNameFor(name) {
    return (name || 'calendar').replace(/[^a-z0-9-_]+/gi, '_') + '.ics';
}

function downloadIcsFile(filename, veventLines) {
    let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peergos//Calendar 0.0.1//EN', 'CALSCALE:GREGORIAN']
        .concat(veventLines)
        .concat(['END:VCALENDAR']);
    let text = lines.map(foldIcsLine).join('\r\n') + '\r\n';
    let blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportEventAsIcs(ev) {
    downloadIcsFile(icsFileNameFor(ev.title), eventToIcsLines(ev));
}

// mailto: (RFC 6068) can only prefill subject/body text, never an
// attachment - so this sends a plain-text summary rather than the .ics
// file itself, reusing the same formatting the popover already shows.
function emailEventBody(ev) {
    let lines = [formatPopoverTime(ev)];
    if (ev.extendedProps.recur) lines.push(describeRecur(ev.extendedProps.recur));
    if (ev.extendedProps.location) lines.push(ev.extendedProps.location);
    if (ev.extendedProps.description) lines.push('', ev.extendedProps.description);
    return lines.join('\n');
}

function emailEventAsMailto(ev) {
    let url = 'mailto:?subject=' + encodeURIComponent(ev.title) + '&body=' + encodeURIComponent(emailEventBody(ev));
    let a = document.createElement('a');
    a.href = url;
    a.click();
}

// Walks the event store's *defs* rather than calendar.getEvents(), same
// reasoning as getSearchableEvents() above - a recurring series with no
// occurrence in the currently rendered view still has a def, and would
// otherwise vanish from the export entirely depending on which month
// happens to be on screen when you click Export.
function exportCalendarAsIcs(calendarId) {
    let cal = getCalendarById(calendarId);
    if (!cal) return;
    let defs = calendar.getCurrentData().eventStore.defs;
    let seen = {};
    let veventLines = [];
    Object.keys(defs).forEach(function (key) {
        let publicId = defs[key].publicId;
        if (!publicId || seen[publicId]) return;
        seen[publicId] = true;
        let ev = calendar.getEventById(publicId);
        if (!ev || ev.extendedProps.calendarId !== calendarId) return;
        veventLines = veventLines.concat(eventToIcsLines(ev));
    });
    downloadIcsFile(icsFileNameFor(cal.name), veventLines);
}

function unfoldIcsLines(text) {
    let raw = text.split(/\r\n|\n|\r/);
    let lines = [];
    for (let i = 0; i < raw.length; i++) {
        if (lines.length && (raw[i][0] === ' ' || raw[i][0] === '\t')) {
            lines[lines.length - 1] += raw[i].slice(1);
        } else if (raw[i].length) {
            lines.push(raw[i]);
        }
    }
    return lines;
}

function parseIcsPropertyLine(line) {
    let colonIdx = line.indexOf(':');
    if (colonIdx === -1) return null;
    let head = line.slice(0, colonIdx);
    let value = line.slice(colonIdx + 1);
    let headParts = head.split(';');
    let params = {};
    for (let i = 1; i < headParts.length; i++) {
        let eq = headParts[i].indexOf('=');
        if (eq !== -1) params[headParts[i].slice(0, eq).toUpperCase()] = headParts[i].slice(eq + 1);
    }
    return { name: headParts[0].toUpperCase(), params: params, value: value };
}

// TZID-qualified values (a named zone, not floating/UTC) are read as
// floating local time - i.e. the wall-clock numbers are kept but the zone
// itself isn't converted. Full IANA timezone conversion is a much bigger
// undertaking than this pass covers; documented as a known limitation.
function parseIcsDateValue(value, params) {
    let m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    let y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (params.VALUE === 'DATE' || !m[4]) {
        return { date: new Date(y, mo, d), allDay: true };
    }
    let hh = +m[4], mi = +m[5], ss = +m[6];
    if (m[7]) return { date: new Date(Date.UTC(y, mo, d, hh, mi, ss)), allDay: false };
    return { date: new Date(y, mo, d, hh, mi, ss), allDay: false };
}

function parseIcsRRuleValue(value) {
    let freqMap = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
    let props = {};
    value.split(';').forEach(function (p) {
        let eq = p.indexOf('=');
        if (eq !== -1) props[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    });
    let freq = freqMap[props.FREQ];
    if (!freq) return null; // HOURLY/MINUTELY/SECONDLY - not in our UI's scope

    let recur = { freq: freq, interval: props.INTERVAL ? parseInt(props.INTERVAL, 10) : 1, end: 'never', until: null, count: null, exdates: [] };

    // Two BYDAY shapes match what this app's UI can express: any number
    // of plain weekday codes on a WEEKLY series ("every Mon/Wed/Fri"), or
    // exactly one ordinal-prefixed code on a MONTHLY series ("the 2nd
    // Tuesday"). Anything else - BYMONTHDAY/BYMONTH/BYYEARDAY/BYWEEKNO/
    // BYSETPOS, mixed/multiple ordinals, BYDAY on a DAILY/YEARLY series -
    // isn't representable by the UI, so it's dropped with a warning
    // rather than silently discarded.
    let codes = props.BYDAY ? props.BYDAY.split(',') : [];
    let isPlainCode = function (c) { return /^(SU|MO|TU|WE|TH|FR|SA)$/.test(c); };
    let isOrdinalCode = function (c) { return /^-?\d+(SU|MO|TU|WE|TH|FR|SA)$/.test(c); };
    let bydaySupported =
        (freq === 'weekly' && codes.length && codes.every(isPlainCode)) ||
        (freq === 'monthly' && codes.length === 1 && isOrdinalCode(codes[0]));
    let hasOtherByParts = props.BYMONTHDAY || props.BYMONTH || props.BYYEARDAY || props.BYWEEKNO || props.BYSETPOS;

    if ((props.BYDAY && !bydaySupported) || hasOtherByParts) {
        console.warn('Imported RRULE uses BY* parts not supported by this app\'s UI - simplified to plain ' + freq + ' recurrence: ' + value);
    } else if (bydaySupported) {
        recur.byday = codes;
    }

    if (props.COUNT) {
        recur.end = 'count';
        recur.count = parseInt(props.COUNT, 10);
    } else if (props.UNTIL) {
        let parsed = parseIcsDateValue(props.UNTIL, {});
        if (parsed) {
            recur.end = 'until';
            recur.until = toDateInputValue(parsed.date);
        }
    }
    return recur;
}

function parseIcsVevent(rawLines) {
    let props = rawLines.map(parseIcsPropertyLine).filter(Boolean);
    let find = function (name) { return props.find(function (p) { return p.name === name; }); };
    let findAll = function (name) { return props.filter(function (p) { return p.name === name; }); };

    let dtstartLine = find('DTSTART');
    if (!dtstartLine) return null;
    let startParsed = parseIcsDateValue(dtstartLine.value, dtstartLine.params);
    if (!startParsed) return null;
    let allDay = startParsed.allDay;
    let start = startParsed.date;

    let dtendLine = find('DTEND');
    let end;
    if (dtendLine) {
        let endParsed = parseIcsDateValue(dtendLine.value, dtendLine.params);
        end = endParsed ? endParsed.date : start;
    } else {
        end = allDay ? addDays(start, 1) : new Date(start.getTime() + 3600000);
    }

    let rruleLine = find('RRULE');
    let recur = rruleLine ? parseIcsRRuleValue(rruleLine.value) : null;
    if (recur) {
        recur.dtstart = allDay ? toDateInputValue(start) : (toDateInputValue(start) + 'T' + toTimeInputValue(start));
        findAll('EXDATE').forEach(function (l) {
            l.value.split(',').forEach(function (v) {
                let parsed = parseIcsDateValue(v.trim(), l.params);
                if (parsed) recur.exdates.push(allDay ? toDateInputValue(parsed.date) : (toDateInputValue(parsed.date) + 'T' + toTimeInputValue(parsed.date)));
            });
        });
    }

    let summaryLine = find('SUMMARY');
    let locationLine = find('LOCATION');
    let descLine = find('DESCRIPTION');
    let statusLine = find('STATUS');
    let title = summaryLine ? unescapeIcsText(summaryLine.value) : '(untitled)';
    let extra = {
        location: locationLine ? unescapeIcsText(locationLine.value) : '',
        status: (statusLine && statusLine.value.toUpperCase() === 'CANCELLED') ? 'cancelled' : 'active',
        description: descLine ? unescapeIcsText(descLine.value) : '',
        // Imported files don't know about our calendars - land in the
        // first one, same as any other calendar-unaware external source.
        calendarId: mockCalendars[0].id
    };

    let uidLine = find('UID');
    let id = uidLine ? idFromIcsUid(uidLine.value) : nextEventId();
    if (recur) return buildRecurringEventPayload(id, title, allDay, extra, recur, end.getTime() - start.getTime());
    return buildPlainEventPayload(id, title, allDay, start, end, extra);
}

// `failed` counts VEVENT blocks that didn't produce a usable event (e.g.
// missing/unparseable DTSTART) - parseIcsVevent() returning null was
// previously a silent drop with no way for the caller to report it.
function parseIcsFile(text) {
    let lines = unfoldIcsLines(text);
    let events = [];
    let failed = 0;
    let current = null;
    lines.forEach(function (line) {
        if (line === 'BEGIN:VEVENT') {
            current = [];
        } else if (line === 'END:VEVENT') {
            if (current) {
                let ev = parseIcsVevent(current);
                if (ev) events.push(ev); else failed++;
            }
            current = null;
        } else if (current) {
            current.push(line);
        }
    });
    return { events: events, failed: failed };
}

// Shared by "delete this occurrence" and "edit this occurrence" (the
// latter also adds a standalone replacement event for the edited data).
function excludeOccurrenceFromMaster(master) {
    let masterRecur = Object.assign({}, master.extendedProps.recur);
    let occurrenceStr = master.allDay ? toDateInputValue(master.start) : (toDateInputValue(master.start) + 'T' + toTimeInputValue(master.start));
    masterRecur.exdates = (masterRecur.exdates || []).concat([occurrenceStr]);
    let durationMs = (master.end || master.start).getTime() - master.start.getTime();
    let payload = buildRecurringEventPayload(master.id, master.title, master.allDay, extraPropsOf(master), masterRecur, durationMs);
    master.remove();
    calendar.addEvent(payload);
}

// Shared by "delete this and following" and "edit this and following" (the
// latter also adds a new continuation sub-series starting at this point).
// Ends the original series the occurrence immediately before the split
// point. If the split point IS the series' first occurrence, nothing of
// the original series remains before it, so it's just removed outright
// rather than left as a degenerate until-before-dtstart rule.
function truncateMasterSeries(master) {
    let masterRecur = Object.assign({}, master.extendedProps.recur);
    let untilBoundary = previousOccurrenceBoundary(masterRecur, master.allDay, master.start);
    if (!untilBoundary) {
        master.remove();
        return;
    }
    masterRecur.end = 'until';
    masterRecur.until = toDateInputValue(untilBoundary);
    masterRecur.count = null;
    let durationMs = (master.end || master.start).getTime() - master.start.getTime();
    let payload = buildRecurringEventPayload(master.id, master.title, master.allDay, extraPropsOf(master), masterRecur, durationMs);
    master.remove();
    calendar.addEvent(payload);
}

let recurFreqLabels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
let recurIntervalUnits = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' };

function describeRecur(recur) {
    let text = recur.interval > 1
        ? 'Every ' + recur.interval + ' ' + recurIntervalUnits[recur.freq]
        : recurFreqLabels[recur.freq];
    if (recur.end === 'until' && recur.until) text += ', until ' + recur.until;
    else if (recur.end === 'count' && recur.count) text += ', ' + recur.count + ' times';
    return text;
}

function formatPopoverTime(ev) {
    let dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (ev.allDay) {
        let lastDay = toFormEnd(ev.end || ev.start, true);
        if (toDateInputValue(lastDay) === toDateInputValue(ev.start)) {
            return dateFmt.format(ev.start) + ' · All day';
        }
        return dateFmt.format(ev.start) + ' – ' + dateFmt.format(lastDay) + ' · All day';
    }
    let timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    return dateFmt.format(ev.start) + ' · ' + timeFmt.format(ev.start) + ' – ' + timeFmt.format(ev.end || ev.start);
}

// Finds an event's current DOM element by id - eventDidMount (below)
// stamps every rendered event with data-search-event-id, not just for
// search.
function findEventAnchorEl(id) {
    return document.querySelector('[data-search-event-id="' + CSS.escape(id) + '"]');
}

function positionPopover(anchorEl) {
    let anchorRect = anchorEl.getBoundingClientRect();
    let popRect = popover.getBoundingClientRect();
    let left = Math.min(anchorRect.left, window.innerWidth - popRect.width - 8);
    left = Math.max(8, left);
    // Prefer below; flip above only if below doesn't fit and above does
    // fit without clamping - clamping "above" on a short window would
    // otherwise slide the popover back down over the anchor it describes.
    let below = anchorRect.bottom + 8;
    let fitsBelow = below + popRect.height <= window.innerHeight - 8;
    let above = anchorRect.top - popRect.height - 8;
    let fitsAbove = above >= 8;
    let top = fitsBelow ? below : (fitsAbove ? above : below);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
}

function showEventPopover(ev, anchorEl) {
    popoverEvent = ev;
    popoverTitle.textContent = ev.title;
    popoverTime.textContent = formatPopoverTime(ev);

    let recur = ev.extendedProps.recur;
    popoverRepeatRow.style.display = recur ? '' : 'none';
    if (recur) popoverRepeat.textContent = describeRecur(recur);

    let location = ev.extendedProps.location;
    popoverLocationRow.style.display = location ? '' : 'none';
    if (location) popoverLocation.textContent = location;

    let description = ev.extendedProps.description;
    popoverDescriptionRow.style.display = description ? '' : 'none';
    if (description) popoverDescription.textContent = description;

    popoverActions.style.display = isWritable ? '' : 'none';

    popover.classList.add('open');
    positionPopover(anchorEl);
    // Re-position once more shortly after - FullCalendar's day-grid
    // row-height pass can still settle the anchor into its final position
    // after this synchronous call (a plain setTimeout observes it; nested
    // requestAnimationFrame calls don't, at least in this environment).
    // Prefers the original anchorEl if still attached, since it's the
    // exact segment/occurrence clicked - a multi-day event's row segments
    // and a recurring series' occurrences all share the same
    // data-search-event-id, so an id-based re-lookup alone would always
    // land on the first one rather than whichever was actually clicked.
    setTimeout(function () {
        if (!popover.classList.contains('open')) return;
        positionPopover(anchorEl.isConnected ? anchorEl : (findEventAnchorEl(ev.id) || anchorEl));
    }, 0);
}

function hideEventPopover() {
    popoverEvent = null;
    popover.classList.remove('open');
}

// Client-side only (no backend search API yet, per ianopolous on
// Peergos/web-ui#757) - kept behind this one function so swapping to a
// real endpoint later is a data-source change, not a UI rewrite. Walks
// the event store's defs rather than calendar.getEvents(), which for a
// recurring series only returns occurrences within the currently
// rendered range - defs keep a series searchable from any month.
// getEventById() on a def with no active instance still returns a full
// EventApi, just with .start === null, hence nearestRecurOccurrenceDate()
// below. Requires MIN_SEARCH_QUERY_LENGTH chars, since matching
// title/location/description means a 1-char query matches almost
// everything through some field or other.
let MIN_SEARCH_QUERY_LENGTH = 2;

function getSearchableEvents(query) {
    let q = query.trim().toLowerCase();
    if (q.length < MIN_SEARCH_QUERY_LENGTH) return [];
    let defs = calendar.getCurrentData().eventStore.defs;
    let seen = {};
    let results = [];
    Object.keys(defs).forEach(function (key) {
        let publicId = defs[key].publicId;
        if (!publicId || seen[publicId]) return;
        seen[publicId] = true;
        let ev = calendar.getEventById(publicId);
        if (!ev) return;
        let title = (ev.title || '').toLowerCase();
        let location = (ev.extendedProps.location || '').toLowerCase();
        let description = (ev.extendedProps.description || '').toLowerCase();
        if (title.indexOf(q) === -1 && location.indexOf(q) === -1 && description.indexOf(q) === -1) return;
        let jumpDate = ev.start || nearestRecurOccurrenceDate(ev.extendedProps.recur, ev.allDay, new Date());
        results.push({ event: ev, jumpDate: jumpDate });
    });
    results.sort(function (a, b) { return a.jumpDate - b.jumpDate; });
    return results;
}

function formatSearchResultMeta(ev, jumpDate) {
    let dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    let text = dateFmt.format(jumpDate);
    if (!ev.allDay) {
        let timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
        text += ' · ' + timeFmt.format(jumpDate);
    }
    if (ev.extendedProps.location) text += ' · ' + ev.extendedProps.location;
    return text;
}

function renderSearchResults(query) {
    searchResults.innerHTML = '';
    let trimmed = query.trim();
    if (!trimmed) {
        closeSearchResults();
        return;
    }
    searchResults.classList.add('open');
    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
        let hint = document.createElement('div');
        hint.className = 'search-empty';
        hint.textContent = 'Keep typing (' + MIN_SEARCH_QUERY_LENGTH + '+ characters)…';
        searchResults.appendChild(hint);
        return;
    }
    let matches = getSearchableEvents(query);
    if (!matches.length) {
        let empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = 'No matching events';
        searchResults.appendChild(empty);
        return;
    }
    matches.slice(0, 20).forEach(function (match) {
        let ev = match.event;
        let item = document.createElement('button');
        item.type = 'button';
        item.className = 'search-result-item';

        let titleRow = document.createElement('div');
        titleRow.className = 'search-result-title-row';
        let titleSpan = document.createElement('span');
        titleSpan.className = 'search-result-title';
        if (ev.extendedProps.status === 'cancelled') titleSpan.classList.add('search-result-cancelled');
        titleSpan.textContent = ev.title;
        titleRow.appendChild(titleSpan);
        if (ev.extendedProps.recur) {
            let badge = document.createElement('span');
            badge.className = 'search-result-badge';
            badge.title = 'Recurring';
            badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3"/><path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"/></svg>';
            titleRow.appendChild(badge);
        }

        let metaRow = document.createElement('div');
        metaRow.className = 'search-result-meta';
        metaRow.textContent = formatSearchResultMeta(ev, match.jumpDate);

        item.appendChild(titleRow);
        item.appendChild(metaRow);
        // Without this, the click also reaches the document-level "click
        // outside closes popover" listener after jumpToSearchResult() has
        // already opened it, closing it again in the same event.
        item.addEventListener('click', function (e) {
            e.stopPropagation();
            jumpToSearchResult(ev, match.jumpDate);
        });
        searchResults.appendChild(item);
    });
}

// Navigates then opens the event's popover, matching Google Calendar's
// own search-result behavior rather than a transient highlight. `ev` can
// be a recurring series' master with no real instance (.start === null)
// if it wasn't previously rendered, so re-resolves to a real instance -
// whichever visible occurrence is closest to jumpDate, since several can
// share the same id - now that gotoDate() has made one exist.
function jumpToSearchResult(ev, jumpDate) {
    closeSearchResults();
    calendar.gotoDate(jumpDate);
    let instance = calendar.getEvents().filter(function (e) { return e.id === ev.id; })
        .reduce(function (best, e) {
            return !best || Math.abs(e.start - jumpDate) < Math.abs(best.start - jumpDate) ? e : best;
        }, null) || ev;
    let anchorEl = findEventAnchorEl(ev.id);
    if (anchorEl) showEventPopover(instance, anchorEl);
}

function closeSearchResults() {
    searchResults.classList.remove('open');
}

function clearSearch() {
    searchInput.value = '';
    searchResults.innerHTML = '';
    closeSearchResults();
    searchClearButton.classList.remove('visible');
}

// --- Multi-calendar: create/rename/recolor/delete, show/hide filtering ---

function getCalendarById(id) {
    return mockCalendars.find(function (c) { return c.id === id; });
}

function isCalendarVisible(calendarId) {
    let cal = getCalendarById(calendarId);
    return !cal || cal.visible;
}

// Uses FullCalendar's own per-event `display` property rather than CSS,
// so a hidden calendar's events are properly excluded from FullCalendar's
// own layout (month view's "+N more" count, row heights) instead of just
// being painted over while still occupying space.
function applyCalendarVisibility() {
    calendar.getEvents().forEach(function (ev) {
        ev.setProp('display', isCalendarVisible(ev.extendedProps.calendarId) ? 'auto' : 'none');
    });
}

function applyCalendarColor(calendarId) {
    let cal = getCalendarById(calendarId);
    if (!cal) return;
    calendar.getEvents().forEach(function (ev) {
        if (ev.extendedProps.calendarId === calendarId) ev.setProp('color', displayColor(cal.color));
    });
}

function renderCalendarSelectOptions(selectedId) {
    calendarSelectInput.innerHTML = '';
    mockCalendars.forEach(function (cal) {
        let option = document.createElement('option');
        option.value = cal.id;
        option.textContent = cal.name;
        calendarSelectInput.appendChild(option);
    });
    calendarSelectInput.value = selectedId || mockCalendars[0].id;
}

function closeAllCalendarMenus() {
    document.querySelectorAll('.calendar-menu.open').forEach(function (menu) { menu.classList.remove('open'); });
}

// The primary calendar's own Delete option isn't even rendered (see
// renderCalendarList() below), so this check is a defensive backstop,
// not the primary way that's enforced.
function deleteCalendar(id) {
    let cal = getCalendarById(id);
    if (!cal || cal.primary) return;
    openConfirmModal('Delete "' + cal.name + '"? All its events will be permanently deleted.', function () {
        calendar.getEvents().forEach(function (ev) {
            if (ev.extendedProps.calendarId === id) ev.remove();
        });
        mockCalendars = mockCalendars.filter(function (c) { return c.id !== id; });
        renderCalendarList();
    });
}

function renderCalendarList() {
    calendarListEl.innerHTML = '';
    mockCalendars.forEach(function (cal) {
        let item = document.createElement('div');
        item.className = 'calendar-list-item';

        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = cal.visible;
        checkbox.style.accentColor = displayColor(cal.color);
        checkbox.setAttribute('aria-label', 'Show ' + cal.name);
        checkbox.addEventListener('change', function () {
            cal.visible = checkbox.checked;
            applyCalendarVisibility();
        });

        let name = document.createElement('span');
        name.className = 'calendar-list-name';
        name.textContent = cal.name;
        name.title = cal.name;

        item.appendChild(checkbox);
        item.appendChild(name);

        // The menu itself is always shown - Export is read-only (same
        // reasoning as Search staying available without write access),
        // so it can't live inside an isWritable-only menu. Edit/Delete
        // (real mutations) are added below only when isWritable.
        let menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'calendar-menu-button';
        menuButton.setAttribute('aria-label', cal.name + ' calendar options');
        menuButton.title = 'Options';
        menuButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/></svg>';

        let menu = document.createElement('div');
        menu.className = 'calendar-menu';

        if (isWritable) {
            let editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg> Edit';
            editBtn.addEventListener('click', function () {
                closeAllCalendarMenus();
                openCalendarModal('edit', cal);
            });
            menu.appendChild(editBtn);
        }

        let exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/></svg> Export';
        exportBtn.addEventListener('click', function () {
            closeAllCalendarMenus();
            exportCalendarAsIcs(cal.id);
        });
        menu.appendChild(exportBtn);

        // Google Calendar/Outlook/Apple Calendar all protect the
        // primary calendar the same way: no Delete option offered
        // for it at all, rather than offering it and then blocking
        // the action after the fact.
        if (isWritable && !cal.primary) {
            let deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'danger';
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg> Delete';
            deleteBtn.addEventListener('click', function () {
                closeAllCalendarMenus();
                deleteCalendar(cal.id);
            });
            menu.appendChild(deleteBtn);
        }

        menuButton.addEventListener('click', function (e) {
            e.stopPropagation();
            let wasOpen = menu.classList.contains('open');
            closeAllCalendarMenus();
            if (!wasOpen) menu.classList.add('open');
        });

        item.appendChild(menuButton);
        item.appendChild(menu);

        calendarListEl.appendChild(item);
    });
}

let editingCalendarId = null;

function renderColorSwatches(selectedColor) {
    calendarColorSwatches.innerHTML = '';
    CALENDAR_COLORS.forEach(function (color) {
        let swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'color-swatch' + (color === selectedColor ? ' selected' : '');
        swatch.style.backgroundColor = displayColor(color);
        swatch.dataset.color = color;
        swatch.setAttribute('aria-label', color);
        // Matches Google Calendar's own color picker: a checkmark marks
        // the selected swatch, not just a border - a border alone is
        // easy to miss against some of these colors.
        swatch.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"/></svg>';
        swatch.addEventListener('click', function () {
            calendarColorSwatches.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('selected'); });
            swatch.classList.add('selected');
        });
        calendarColorSwatches.appendChild(swatch);
    });
}

function openCalendarModal(mode, cal) {
    editingCalendarId = mode === 'edit' ? cal.id : null;
    calendarModalHeading.textContent = mode === 'edit' ? 'Edit calendar' : 'New calendar';
    calendarNameInput.value = mode === 'edit' ? cal.name : '';
    renderColorSwatches(mode === 'edit' ? cal.color : CALENDAR_COLORS[0]);
    calendarDeleteButton.style.display = (mode === 'edit' && !cal.primary) ? '' : 'none';
    calendarModalBackdrop.classList.add('open');
    calendarNameInput.focus();
}

function closeCalendarModal() {
    calendarModalBackdrop.classList.remove('open');
    editingCalendarId = null;
}

// Generic confirm dialog - currently only used for deleting a calendar,
// but not named/scoped to that specifically in case another destructive
// action needs the same "are you sure?" pattern later, matching this
// app's own visual style instead of the browser's native confirm().
let pendingConfirmAction = null;

function openConfirmModal(message, onConfirm) {
    confirmModalMessage.textContent = message;
    pendingConfirmAction = onConfirm;
    confirmModalBackdrop.classList.add('open');
}

function closeConfirmModal() {
    confirmModalBackdrop.classList.remove('open');
    pendingConfirmAction = null;
}

// Purely informational (no onConfirm/Cancel), so it gets its own modal
// rather than reusing openConfirmModal() above - that one's OK button is
// permanently styled/labeled for a destructive action, which doesn't fit
// a post-import summary.
function openImportSummaryModal(message) {
    importSummaryMessage.textContent = message;
    importSummaryModalBackdrop.classList.add('open');
}

function closeImportSummaryModal() {
    importSummaryModalBackdrop.classList.remove('open');
}

function performScopedDelete(ev, scope) {
    if (scope === 'this' && ev.extendedProps.recur) {
        excludeOccurrenceFromMaster(ev);
    } else if (scope === 'following' && ev.extendedProps.recur) {
        truncateMasterSeries(ev);
    } else {
        ev.remove();
    }
}

function openModal(mode, opts) {
    editingEvent = mode === 'edit' ? opts.event : null;
    editScope = opts.scope || 'all';
    modalHeading.textContent = mode === 'edit' ? 'Edit event' : (opts.prefill ? 'Duplicate event' : 'New event');

    editableFields.forEach(el => el.disabled = !isWritable);
    saveButton.style.display = isWritable ? '' : 'none';
    saveButton.disabled = !isWritable;
    deleteButton.style.display = (isWritable && mode === 'edit') ? '' : 'none';
    deleteButton.disabled = !isWritable;
    cancelButton.textContent = isWritable ? 'Cancel' : 'Close';

    let start, end, allDay, recur;
    if (mode === 'edit') {
        let ev = opts.event;
        titleInput.value = ev.title;
        allDay = ev.allDay;
        let masterRecur = ev.extendedProps.recur || null;

        if (masterRecur && editScope === 'all') {
            let range = seriesFormRange(ev, masterRecur, allDay);
            start = range.start;
            end = range.end;
            recur = masterRecur;
        } else if (masterRecur && editScope === 'following') {
            start = ev.start;
            end = toFormEnd(ev.end || ev.start, allDay);
            recur = adjustRecurForFollowing(ev, masterRecur, allDay);
        } else {
            // editScope === 'this', or a plain non-recurring event
            start = ev.start;
            end = toFormEnd(ev.end || ev.start, allDay);
            recur = null;
        }

        locationInput.value = ev.extendedProps.location || '';
        statusInput.value = ev.extendedProps.status || 'active';
        descriptionInput.value = ev.extendedProps.description || '';
        renderCalendarSelectOptions(ev.extendedProps.calendarId);
    } else {
        let prefill = opts.prefill || {};
        titleInput.value = prefill.title || '';
        allDay = opts.allDay || false;
        start = opts.date;
        // opts.endDate is exclusive for an all-day range, same as an
        // edited event's ev.end - needs the same toFormEnd() conversion
        // edit-mode applies below, or a single-day click shows (and saves)
        // as two days.
        end = toFormEnd(opts.endDate, allDay);
        locationInput.value = prefill.location || '';
        statusInput.value = prefill.status || 'active';
        descriptionInput.value = prefill.description || '';
        recur = null;
        renderCalendarSelectOptions(prefill.calendarId);
    }

    allDayInput.checked = allDay;
    setInputMode(allDay);
    startDateInput.value = toDateInputValue(start);
    startTimeInput.value = allDay ? '09:00' : toTimeInputValue(start);
    endDateInput.value = toDateInputValue(end);
    endTimeInput.value = allDay ? '10:00' : toTimeInputValue(end);
    populateRecurForm(recur);
    // editing a single split-off occurrence can't independently repeat
    repeatSection.style.display = (editScope === 'this') ? 'none' : '';

    modalBackdrop.classList.add('open');
}

function closeModal() {
    modalBackdrop.classList.remove('open');
    editingEvent = null;
    editScope = 'all';
    calendar.unselect();
}

function openScopeModal(ev, action) {
    pendingScopeEvent = ev;
    pendingScopeAction = action;
    scopeSubtitle.textContent = 'Which events would you like to ' + (action === 'delete' ? 'delete' : 'change') + '?';
    document.querySelector('input[name="scope"][value="this"]').checked = true;
    scopeModalBackdrop.classList.add('open');
}

function closeScopeModal() {
    pendingScopeEvent = null;
    scopeModalBackdrop.classList.remove('open');
}

allDayInput.addEventListener('change', function () {
    setInputMode(allDayInput.checked);
});

repeatFreqInput.addEventListener('change', updateRepeatVisibility);
repeatEndInput.addEventListener('change', updateRepeatVisibility);

weekdayToggleButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
        btn.classList.toggle('selected');
    });
});

// Keeps "Monthly on the 3rd Tuesday" (computed from the start date, not
// a fixed string) in sync if the date changes while the modal is open -
// matches Google Calendar's own picker, which updates this live too.
startDateInput.addEventListener('change', function () {
    if (repeatFreqInput.value === 'monthly') updateMonthlyModeLabels();
});

cancelButton.addEventListener('click', closeModal);

modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) closeModal();
});

scopeConfirmButton.addEventListener('click', function () {
    let ev = pendingScopeEvent;
    let action = pendingScopeAction;
    let chosen = document.querySelector('input[name="scope"]:checked');
    let scope = chosen ? chosen.value : 'this';
    closeScopeModal();
    if (action === 'delete') {
        performScopedDelete(ev, scope);
    } else {
        openModal('edit', { event: ev, scope: scope });
    }
});
scopeCancelButton.addEventListener('click', closeScopeModal);
scopeModalBackdrop.addEventListener('click', function (e) {
    if (e.target === scopeModalBackdrop) closeScopeModal();
});

popoverCloseButton.addEventListener('click', hideEventPopover);

// Shared by the popover's Edit button and double-clicking an event
// directly - both should go through the same recurring-scope prompt.
function openEditFor(ev) {
    if (isWritable && ev.extendedProps.recur) {
        openScopeModal(ev, 'edit');
    } else {
        openModal('edit', { event: ev, scope: 'all' });
    }
}

popoverEditButton.addEventListener('click', function () {
    let ev = popoverEvent;
    hideEventPopover();
    openEditFor(ev);
});

popoverDeleteButton.addEventListener('click', function () {
    let ev = popoverEvent;
    hideEventPopover();
    if (ev.extendedProps.recur) {
        openScopeModal(ev, 'delete');
    } else {
        ev.remove();
    }
});

// Always duplicates just the clicked occurrence as a standalone
// non-recurring event, even for a recurring series - no scope prompt
// needed, since the result is never itself part of that series.
popoverDuplicateButton.addEventListener('click', function () {
    let ev = popoverEvent;
    hideEventPopover();
    openModal('create', {
        date: ev.start,
        endDate: ev.end || ev.start,
        allDay: ev.allDay,
        prefill: {
            title: ev.title,
            location: ev.extendedProps.location,
            status: ev.extendedProps.status,
            description: ev.extendedProps.description,
            calendarId: ev.extendedProps.calendarId
        }
    });
});

popoverExportButton.addEventListener('click', function () {
    exportEventAsIcs(popoverEvent);
    hideEventPopover();
});

popoverEmailButton.addEventListener('click', function () {
    emailEventAsMailto(popoverEvent);
    hideEventPopover();
});

overflowMenuButton.addEventListener('click', function () {
    overflowMenu.classList.toggle('open');
});

overflowImportButton.addEventListener('click', function () {
    overflowMenu.classList.remove('open');
    icsFileInput.click();
});

overflowMenuVersion.textContent = 'FullCalendar v' + FullCalendar.version;

// Skips (rather than overwrites) an event whose id already exists -
// safest default when we can't know whether the existing copy has local
// edits the re-imported file doesn't know about. Only catches exact id
// matches, which only happens for a file this app itself exported
// (idFromIcsUid() above) or a repeat import of the same external file;
// two different external sources describing "the same" event with
// different UIDs still import as separate events, same as real calendar
// apps.
function formatImportSummary(imported, duplicates, failed) {
    if (imported === 0 && duplicates === 0 && failed === 0) return 'No events found in this file.';
    let parts = [imported === 1 ? 'Imported 1 event.' : 'Imported ' + imported + ' events.'];
    if (duplicates > 0) parts.push(duplicates === 1 ? '1 already existed and was skipped.' : duplicates + ' already existed and were skipped.');
    if (failed > 0) parts.push(failed === 1 ? '1 could not be read and was skipped.' : failed + ' could not be read and were skipped.');
    return parts.join(' ');
}

icsFileInput.addEventListener('change', function () {
    let file = icsFileInput.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function () {
        icsFileInput.value = '';
        // A wrong-file-type pick (e.g. a renamed .txt/.jpg) would otherwise
        // read as "0 events" - the same message an empty-but-valid calendar
        // export gives - which is misleading about what actually went
        // wrong. VCALENDAR is the one thing every RFC5545 file has.
        if (reader.result.indexOf('BEGIN:VCALENDAR') === -1) {
            openImportSummaryModal("This doesn't look like a valid .ics calendar file.");
            return;
        }
        let parsed = parseIcsFile(reader.result);
        let imported = 0;
        let duplicates = 0;
        parsed.events.forEach(function (data) {
            if (calendar.getEventById(data.id)) {
                duplicates++;
            } else {
                calendar.addEvent(data);
                imported++;
            }
        });
        if (imported > 0) applyCalendarVisibility();
        openImportSummaryModal(formatImportSummary(imported, duplicates, parsed.failed));
    };
    reader.onerror = function () {
        icsFileInput.value = '';
        openImportSummaryModal('Could not read that file.');
    };
    reader.readAsText(file);
});

// Always visible in the toolbar, not a click-to-open trigger - matches
// YouTube's own search bar rather than this app's earlier command-palette
// version. Clicking the search button itself just (re)focuses the input;
// results already render live as you type, so there's nothing else for
// it to submit.
searchButton.addEventListener('click', function () {
    searchInput.focus();
});

searchInput.addEventListener('input', function () {
    searchClearButton.classList.toggle('visible', searchInput.value.length > 0);
    renderSearchResults(searchInput.value);
});

// Re-opens the dropdown when refocusing an already-typed query (e.g.
// after clicking away and back), rather than requiring the text to be
// retyped to see results again.
searchInput.addEventListener('focus', function () {
    if (searchInput.value.trim()) renderSearchResults(searchInput.value);
});

searchClearButton.addEventListener('click', function () {
    clearSearch();
    searchInput.focus();
});

// Below MOBILE_BREAKPOINT (matches calendar.css's own `@media (max-width:
// 700px)`), the sidebar is an off-canvas drawer (`.open` + a dimming
// backdrop); above it, it's a persistent column that just collapses to
// zero width in place - same button, different meaning depending on
// how much room there already is, matching how Google Calendar's own
// desktop and mobile web sidebars each behave.
let MOBILE_BREAKPOINT = 700;

sidebarToggleButton.addEventListener('click', function () {
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
        sidebar.classList.toggle('open');
        sidebarBackdrop.classList.toggle('open');
    } else {
        sidebar.classList.toggle('collapsed');
    }
});

sidebarBackdrop.addEventListener('click', function () {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('open');
});

addCalendarButton.addEventListener('click', function () {
    openCalendarModal('create', null);
});

calendarForm.addEventListener('submit', function (e) {
    e.preventDefault();
    let name = calendarNameInput.value.trim();
    if (!name) return;
    let selectedSwatch = calendarColorSwatches.querySelector('.color-swatch.selected');
    let color = selectedSwatch ? selectedSwatch.dataset.color : CALENDAR_COLORS[0];
    if (editingCalendarId) {
        let cal = getCalendarById(editingCalendarId);
        cal.name = name;
        if (cal.color !== color) {
            cal.color = color;
            applyCalendarColor(cal.id);
        }
    } else {
        mockCalendars.push({ id: nextEventId(), name: name, color: color, visible: true });
    }
    renderCalendarList();
    closeCalendarModal();
});

calendarCancelButton.addEventListener('click', closeCalendarModal);

calendarModalBackdrop.addEventListener('click', function (e) {
    if (e.target === calendarModalBackdrop) closeCalendarModal();
});

calendarDeleteButton.addEventListener('click', function () {
    if (!editingCalendarId) return;
    let id = editingCalendarId;
    closeCalendarModal();
    deleteCalendar(id);
});

confirmOkButton.addEventListener('click', function () {
    let action = pendingConfirmAction;
    closeConfirmModal();
    if (action) action();
});

confirmCancelButton.addEventListener('click', closeConfirmModal);

confirmModalBackdrop.addEventListener('click', function (e) {
    if (e.target === confirmModalBackdrop) closeConfirmModal();
});

importSummaryOkButton.addEventListener('click', closeImportSummaryModal);

importSummaryModalBackdrop.addEventListener('click', function (e) {
    if (e.target === importSummaryModalBackdrop) closeImportSummaryModal();
});

// Closes an open calendar "..." menu on any click outside its own
// buttons/trigger and the overflow menu's inert version line. A
// calendar-list menu's own blank space is deliberately NOT exempted,
// since it's tall enough to overlap the row below it and a click meant
// for that row's kebab button would otherwise land on the open menu and
// do nothing, leaving it stuck open - the version line has no such
// row underneath it to protect. Capture phase, not bubble: eventClick's
// own stopPropagation() (below) would otherwise hide clicks on events
// from a bubble-phase listener here.
document.addEventListener('click', function (e) {
    if (!e.target.closest('.calendar-menu button') && !e.target.closest('.calendar-menu-button') && !e.target.closest('#overflow-menu-button') && !e.target.closest('#overflow-menu-version')) {
        closeAllCalendarMenus();
    }
}, true);

// Closes the search results dropdown on any click outside #search-bar.
// Capture phase from the start this time, not bubble - the same
// stopPropagation()-swallows-a-bubble-listener issue fixed twice above
// would otherwise just resurface a third time here (e.g. clicking a
// calendar kebab button while results are open).
document.addEventListener('click', function (e) {
    if (!searchBar.contains(e.target)) closeSearchResults();
}, true);

// Clicking outside the popover closes it and still reaches whatever it
// landed on - switching straight to a different event's popover in one
// click. Capture phase, not bubble, same reason as the calendar-menu
// closer above (just the other direction): a calendar kebab button's own
// stopPropagation() otherwise leaves the popover stuck open. Capture
// doesn't stop propagation itself, so eventClick still fires normally
// afterward.
document.addEventListener('click', function (e) {
    if (popover.classList.contains('open') && !popover.contains(e.target)) {
        hideEventPopover();
    }
}, true);

// The one exception: day-grid `select` (clicking empty space to create a
// new event) - opening the create form as a side effect of dismissing a
// popover reads as broken, so it's swallowed via mousedown/capture-phase
// rather than passed through. Has to be mousedown, not click: select is
// driven by mousedown/mouseup and has already run by the time a
// click-based listener could react. Excludes clicks on an actual event
// so eventClick (which needs a real "click" event to fire) still works.
document.addEventListener('mousedown', function (e) {
    if (!popover.classList.contains('open')) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest('[data-search-event-id]')) return;
    e.stopPropagation();
}, true);

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (confirmModalBackdrop.classList.contains('open')) closeConfirmModal();
    else if (importSummaryModalBackdrop.classList.contains('open')) closeImportSummaryModal();
    else if (modalBackdrop.classList.contains('open')) closeModal();
    else if (scopeModalBackdrop.classList.contains('open')) closeScopeModal();
    else if (calendarModalBackdrop.classList.contains('open')) closeCalendarModal();
    else if (popover.classList.contains('open')) hideEventPopover();
    else if (searchResults.classList.contains('open')) closeSearchResults();
});

form.addEventListener('submit', function (e) {
    e.preventDefault();
    let allDay = allDayInput.checked;
    let start = allDay ? startDateInput.value : new Date(startDateInput.value + 'T' + startTimeInput.value);
    let end = fromFormEnd(allDay);
    let extra = { location: locationInput.value, status: statusInput.value, description: descriptionInput.value, calendarId: calendarSelectInput.value };
    let recur = readRecurFromForm();

    if (editingEvent && editScope === 'this' && editingEvent.extendedProps.recur) {
        excludeOccurrenceFromMaster(editingEvent);
        calendar.addEvent(buildPlainEventPayload(nextEventId(), titleInput.value, allDay, start, end, extra));

    } else if (editingEvent && editScope === 'following' && editingEvent.extendedProps.recur) {
        truncateMasterSeries(editingEvent);
        if (recur) {
            recur.dtstart = allDay ? startDateInput.value : (startDateInput.value + 'T' + startTimeInput.value);
            calendar.addEvent(buildRecurringEventPayload(nextEventId(), titleInput.value, allDay, extra, recur, computeDurationMs(start, end, allDay)));
        } else {
            calendar.addEvent(buildPlainEventPayload(nextEventId(), titleInput.value, allDay, start, end, extra));
        }

    } else {
        // scope 'all', a plain (non-recurring) event, or a brand-new event
        let id = editingEvent ? editingEvent.id : nextEventId();
        let data;
        if (recur) {
            recur.dtstart = allDay ? startDateInput.value : (startDateInput.value + 'T' + startTimeInput.value);
            if (editingEvent && editingEvent.extendedProps.recur) {
                recur.exdates = editingEvent.extendedProps.recur.exdates || [];
            }
            data = buildRecurringEventPayload(id, titleInput.value, allDay, extra, recur, computeDurationMs(start, end, allDay));
        } else {
            data = buildPlainEventPayload(id, titleInput.value, allDay, start, end, extra);
        }
        if (editingEvent) editingEvent.remove();
        calendar.addEvent(data);
    }

    applyCalendarVisibility();
    closeModal();
});

deleteButton.addEventListener('click', function () {
    if (!editingEvent) {
        closeModal();
        return;
    }
    performScopedDelete(editingEvent, editScope);
    closeModal();
});

// Search is read-only and stays available without write permission;
// only Import (which adds data) is hidden.
overflowImportButton.style.display = isWritable ? '' : 'none';
addCalendarButton.style.display = isWritable ? '' : 'none';
renderCalendarList();

// eventClick fires on both clicks of a double-click, so the first
// click's popover is deferred behind a short timer - a second click
// arriving before it fires cancels the popover and opens edit instead.
let eventClickTimer = null;

// Fixes Breezy's day-grid (Month/Year) event rows: no color indicator by
// default (--fc-event-color is set correctly, confirmed via devtools,
// but nothing in that render mode consumes it, unlike Week/Day and List
// which both already work) and the time label right-aligned via
// justify-content:space-between + order:1, rather than flush-left like
// Classic. Idempotent and safe to call repeatedly on the same element -
// re-run on every resize below, not just at mount, since Breezy's own
// responsive logic rebuilds this content on resize (adding/removing the
// time div depending on available width) without re-invoking
// eventDidMount; a one-time fix at mount alone left dot/time/title order
// scrambled after a couple of rotations.
function fixDayGridEventLayout(el) {
    if (el.dataset.eventAllDay === '1') return;
    let wrapper = el.firstElementChild;
    if (!wrapper) return;
    wrapper.style.justifyContent = 'flex-start';
    let existingDot = wrapper.querySelector('.fc-event-color-dot');
    if (existingDot) existingDot.remove();
    let divs = Array.prototype.filter.call(wrapper.children, function (c) { return c.tagName === 'DIV'; });
    if (!divs.length) return;
    let dot = document.createElement('span');
    dot.className = 'fc-event-color-dot';
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;flex:0 0 auto;order:0;background-color:' + el.style.getPropertyValue('--fc-event-color') + ';';
    wrapper.insertBefore(dot, wrapper.firstChild);
    let timeEl = divs.length > 1 ? divs[0] : null;
    let titleEl = divs.length > 1 ? divs[1] : divs[0];
    titleEl.style.order = '2';
    if (timeEl) {
        timeEl.style.order = '1';
        // Space-based, not a fixed width cutoff: keep dot+time+title in
        // that order whenever they actually fit the cell (matching the
        // desktop/web layout), and only drop the time label if they'd
        // overflow - so rotating a phone to landscape, or any width with
        // enough room, shows it again instead of it staying hidden below
        // some hardcoded breakpoint.
        timeEl.style.display = wrapper.scrollWidth > wrapper.clientWidth ? 'none' : '';
    }
}

let calendarEl = document.getElementById('calendar');
let calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'en',
    headerToolbar: {
        left: 'prev,today,next',
        center: 'title',
        right: 'multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    height: '100%',
    firstDay: 1,
    weekNumbers: true,
    navLinks: true,
    nowIndicator: true,
    events: mockEvents,
    eventClass: function (info) {
        return info.event.extendedProps.status === 'cancelled' ? 'fc-event-cancelled' : '';
    },
    eventDidMount: function (info) {
        info.el.dataset.searchEventId = info.event.id;
        info.el.dataset.eventAllDay = info.event.allDay ? '1' : '0';
        if (info.view.type === 'dayGridMonth' || info.view.type === 'multiMonthYear') {
            fixDayGridEventLayout(info.el);
        }
    },
    selectable: isWritable,
    select: function (info) {
        openModal('create', { date: info.start, endDate: info.end, allDay: info.allDay });
    },
    eventClick: function (info) {
        info.jsEvent.stopPropagation();
        if (eventClickTimer) {
            clearTimeout(eventClickTimer);
            eventClickTimer = null;
            hideEventPopover();
            openEditFor(info.event);
            return;
        }
        eventClickTimer = setTimeout(function () {
            eventClickTimer = null;
            showEventPopover(info.event, info.el);
        }, 300);
    }
});
calendar.render();
applyCalendarVisibility();

// Re-applies fixDayGridEventLayout() to every rendered day-grid event on
// resize/rotation, not just at mount - see that function's own comment
// for why a one-time fix isn't enough. Debounced since resize (and
// especially orientation change, which fires a burst of them) can fire
// many times in quick succession.
let dayGridLayoutFixTimer = null;
window.addEventListener('resize', function () {
    clearTimeout(dayGridLayoutFixTimer);
    dayGridLayoutFixTimer = setTimeout(function () {
        if (calendar.view.type !== 'dayGridMonth' && calendar.view.type !== 'multiMonthYear') return;
        document.querySelectorAll('[data-search-event-id]').forEach(function (el) {
            fixDayGridEventLayout(el);
        });
    }, 150);
});
