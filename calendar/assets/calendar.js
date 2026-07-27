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

// The form shows the all-day end date inclusively; FullCalendar stores
// it exclusively.
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

// rrule.js reads Date fields via UTC getters regardless of local
// timezone - build/read dates via UTC fields to work around it.
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
// the final 7 days of the month ("the last <weekday>").
function nthWeekdayOfMonth(date) {
    let day = date.getDate();
    let daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return (day + 7 > daysInMonth) ? -1 : Math.ceil(day / 7);
}

let ORDINAL_LABELS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };
let WEEKDAY_LABELS = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };

// recur.byday holds RRULE-text-style day codes - plain ('MO') or
// ordinal-prefixed ('2TU', '-1FR') for "nth weekday of the month".
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

// Occurrence immediately before `date`, ignoring count/until/exdates -
// the truncation boundary for "this and following" splits. Null if
// `date` is the series' first occurrence.
function previousOccurrenceBoundary(recur, allDay, date) {
    let rr = new rrule.RRule(rruleOptionsFor(recur, allDay));
    let result = rr.before(toFakeUtc(date), false);
    return result ? fromFakeUtc(result) : null;
}

// How many occurrences fall before targetDate - used to shrink a
// remaining COUNT when splitting a series.
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

// Nearest occurrence to referenceDate, clamped to count/until/exdates.
// Compares against the start of referenceDate's day, not its exact time,
// so today's occurrence doesn't look "already past" once its time has
// elapsed.
function nearestRecurOccurrenceDate(recur, allDay, referenceDate) {
    let dayStart = toFakeUtc(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()));
    let set = buildRRuleSet(recur, allDay);
    let result = set.after(dayStart, true) || set.before(dayStart, true);
    return result ? fromFakeUtc(result) : (allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart));
}

// RFC5545 requires UNTIL's precision to match DTSTART's - a date-only
// UNTIL on a timed series would exclude that day's own occurrence.
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
let theme = url.searchParams.get('theme');
let isDarkMode = theme === 'dark-mode';
if (isDarkMode) document.documentElement.setAttribute('data-color-scheme', 'dark');

// Same signal as the .calendar-menu-button fix in calendar.css - turns
// off the double-click-to-edit shortcut on touch devices.
let isTouchDevice = window.matchMedia('(hover: none)').matches;

// Fixed palette, not free-form color picking.
let CALENDAR_COLORS = ['#3788d8', '#8e24aa', '#0b8043', '#e67c73', '#f4511e', '#e53935'];

// Index-matched to CALENDAR_COLORS, for legibility on a dark background -
// display only, `cal.color` itself always stays the light-mode value.
let CALENDAR_COLORS_DARK = ['#60a5fa', '#c084fc', '#4ade80', '#fca5a5', '#fb923c', '#f87171'];

function displayColor(hex) {
    if (!isDarkMode) return hex;
    let idx = CALENDAR_COLORS.indexOf(hex);
    return idx >= 0 ? CALENDAR_COLORS_DARK[idx] : hex;
}

// `primary: true` can't be deleted. `readOnly: true` marks a calendar
// shared *with* you - see isCalendarWritable().
let mockCalendars = [
    { id: 'cal-personal', name: 'Personal', color: CALENDAR_COLORS[0], visible: true, primary: true },
    { id: 'cal-work', name: 'Work', color: CALENDAR_COLORS[1], visible: true },
    { id: 'cal-team', name: 'Team events', color: CALENDAR_COLORS[2], visible: true, readOnly: true }
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
    },
    {
        id: 'mock-5',
        title: 'All-hands',
        start: mockDate(2, 14, 0),
        end: mockDate(2, 15, 0),
        allDay: false,
        color: displayColor(CALENDAR_COLORS[2]),
        extendedProps: { location: '', description: '', status: 'active', recur: null, calendarId: 'cal-team' }
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

let shareModalBackdrop = document.getElementById('share-modal-backdrop');
let shareModalHeading = document.getElementById('share-modal-heading');
let shareUserList = document.getElementById('share-user-list');
let shareUsernameInput = document.getElementById('share-username-input');
let shareAddButton = document.getElementById('share-add-button');
let shareCreateLinkButton = document.getElementById('share-create-link-button');
let shareLinkRow = document.getElementById('share-link-row');
let shareLinkInput = document.getElementById('share-link-input');
let shareLinkCopyButton = document.getElementById('share-link-copy-button');
let shareCloseButton = document.getElementById('share-close-button');

let popover = document.getElementById('event-popover');
let popoverTitle = document.getElementById('popover-title');
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
let popoverShareButton = document.getElementById('popover-share');
let popoverDeleteButton = document.getElementById('popover-delete');
let icsFileInput = document.getElementById('ics-file-input');
let toolbarAddButton = document.getElementById('toolbar-add-button');
let gotoDateMenu = document.getElementById('goto-date-menu');
let gotoDateMonthInput = document.getElementById('goto-date-month');
let gotoDateYearInput = document.getElementById('goto-date-year');
let gotoDateYearDownButton = document.getElementById('goto-date-year-down');
let gotoDateYearUpButton = document.getElementById('goto-date-year-up');
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
// computed from the form's own start date, not fixed strings.
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
    // Nothing checked yet defaults to the form's start-date weekday.
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

// Whole-series editing shows the SERIES' true original start/end, not
// whichever occurrence was clicked - otherwise saving would shift the
// whole series. Real dtstart lives in extendedProps.recur.dtstart.
function seriesFormRange(ev, recur, allDay) {
    let occurrenceDurationMs = (ev.end || ev.start).getTime() - ev.start.getTime();
    let seriesStart = allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
    let seriesEndExclusive = new Date(seriesStart.getTime() + occurrenceDurationMs);
    return { start: seriesStart, end: toFormEnd(seriesEndExclusive, allDay) };
}

// "This and following": remaining count reduced by occurrences already
// past, so the form doesn't show the original total.
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
        // bare-number duration silently produces end == start on a
        // recurring event - object form works correctly (see README)
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

// --- Timezone conversion (IANA, via the browser's own Intl tz database -
// no hand-maintained offset/DST rule table) ---

let LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let ianaZoneValidityCache = {};
function isRecognizedIanaZone(zone) {
    if (zone in ianaZoneValidityCache) return ianaZoneValidityCache[zone];
    let valid;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        valid = true;
    } catch (e) {
        valid = false;
    }
    ianaZoneValidityCache[zone] = valid;
    return valid;
}

// UTC offset (minutes, east-positive) a zone observes at a given instant -
// read off Intl's "GMT±HH:MM" longOffset format, so DST and half-hour
// offsets (India, Nepal, ...) are handled without listing them by hand.
function tzOffsetMinutesAt(zone, utcMs) {
    let parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset', hour: '2-digit' }).formatToParts(new Date(utcMs));
    let raw = parts.find(function (p) { return p.type === 'timeZoneName'; }).value;
    let m = raw.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    let sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// Converts a local wall-clock time in `zone` to the UTC instant it
// represents - one correction pass after an initial UTC-literal guess.
// An ambiguous local time (fall-back's repeated hour, spring-forward's
// skipped one) resolves to one side rather than erroring, same as most
// timezone libraries.
function localWallClockToUtcMs(zone, y, mo, d, hh, mi, ss) {
    let guessMs = Date.UTC(y, mo, d, hh, mi, ss || 0);
    let offset = tzOffsetMinutesAt(zone, guessMs);
    let utcMs = guessMs - offset * 60000;
    offset = tzOffsetMinutesAt(zone, utcMs);
    return guessMs - offset * 60000;
}

// Some desktop calendar clients export TZID using a non-IANA name
// ("Eastern Standard Time" instead of "America/New_York") - Intl doesn't
// recognize those directly. Maps the common ones to their IANA
// equivalent (default zone per CLDR territory "001").
let LEGACY_TZID_TO_IANA = {
    'Dateline Standard Time': 'Etc/GMT+12', 'UTC-11': 'Etc/GMT+11',
    'Aleutian Standard Time': 'America/Adak', 'Hawaiian Standard Time': 'Pacific/Honolulu',
    'Marquesas Standard Time': 'Pacific/Marquesas', 'Alaskan Standard Time': 'America/Anchorage',
    'UTC-09': 'Etc/GMT+9', 'Pacific Standard Time (Mexico)': 'America/Tijuana',
    'UTC-08': 'Etc/GMT+8', 'Pacific Standard Time': 'America/Los_Angeles',
    'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time (Mexico)': 'America/Chihuahua',
    'Mountain Standard Time': 'America/Denver', 'Central America Standard Time': 'America/Guatemala',
    'Central Standard Time': 'America/Chicago', 'Easter Island Standard Time': 'Pacific/Easter',
    'Central Standard Time (Mexico)': 'America/Mexico_City', 'Canada Central Standard Time': 'America/Regina',
    'SA Pacific Standard Time': 'America/Bogota', 'Eastern Standard Time (Mexico)': 'America/Cancun',
    'Eastern Standard Time': 'America/New_York', 'Haiti Standard Time': 'America/Port-au-Prince',
    'Cuba Standard Time': 'America/Havana', 'US Eastern Standard Time': 'America/Indianapolis',
    'Turks And Caicos Standard Time': 'America/Grand_Turk', 'Paraguay Standard Time': 'America/Asuncion',
    'Atlantic Standard Time': 'America/Halifax', 'Venezuela Standard Time': 'America/Caracas',
    'Central Brazilian Standard Time': 'America/Cuiaba', 'SA Western Standard Time': 'America/La_Paz',
    'Pacific SA Standard Time': 'America/Santiago', 'Newfoundland Standard Time': 'America/St_Johns',
    'Tocantins Standard Time': 'America/Araguaina', 'E. South America Standard Time': 'America/Sao_Paulo',
    'SA Eastern Standard Time': 'America/Cayenne', 'Argentina Standard Time': 'America/Buenos_Aires',
    'Greenland Standard Time': 'America/Godthab', 'Montevideo Standard Time': 'America/Montevideo',
    'Magallanes Standard Time': 'America/Punta_Arenas', 'Saint Pierre Standard Time': 'America/Miquelon',
    'Bahia Standard Time': 'America/Bahia', 'UTC-02': 'Etc/GMT+2', 'Mid-Atlantic Standard Time': 'Etc/GMT+2',
    'Azores Standard Time': 'Atlantic/Azores', 'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
    'UTC': 'Etc/UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'Sao Tome Standard Time': 'Africa/Sao_Tome', 'Morocco Standard Time': 'Africa/Casablanca',
    'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
    'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw',
    'W. Central Africa Standard Time': 'Africa/Lagos', 'Jordan Standard Time': 'Asia/Amman',
    'GTB Standard Time': 'Europe/Bucharest', 'Middle East Standard Time': 'Asia/Beirut',
    'Egypt Standard Time': 'Africa/Cairo', 'E. Europe Standard Time': 'Europe/Chisinau',
    'Syria Standard Time': 'Asia/Damascus', 'West Bank Standard Time': 'Asia/Hebron',
    'South Africa Standard Time': 'Africa/Johannesburg', 'FLE Standard Time': 'Europe/Kiev',
    'Israel Standard Time': 'Asia/Jerusalem', 'Kaliningrad Standard Time': 'Europe/Kaliningrad',
    'Sudan Standard Time': 'Africa/Khartoum', 'Libya Standard Time': 'Africa/Tripoli',
    'Namibia Standard Time': 'Africa/Windhoek', 'Arabic Standard Time': 'Asia/Baghdad',
    'Turkey Standard Time': 'Europe/Istanbul', 'Arab Standard Time': 'Asia/Riyadh',
    'Belarus Standard Time': 'Europe/Minsk', 'Russian Standard Time': 'Europe/Moscow',
    'E. Africa Standard Time': 'Africa/Nairobi', 'Iran Standard Time': 'Asia/Tehran',
    'Arabian Standard Time': 'Asia/Dubai', 'Astrakhan Standard Time': 'Europe/Astrakhan',
    'Azerbaijan Standard Time': 'Asia/Baku', 'Russia Time Zone 3': 'Europe/Samara',
    'Mauritius Standard Time': 'Indian/Mauritius', 'Saratov Standard Time': 'Europe/Saratov',
    'Georgian Standard Time': 'Asia/Tbilisi', 'Volgograd Standard Time': 'Europe/Volgograd',
    'Caucasus Standard Time': 'Asia/Yerevan', 'Afghanistan Standard Time': 'Asia/Kabul',
    'West Asia Standard Time': 'Asia/Tashkent', 'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
    'Pakistan Standard Time': 'Asia/Karachi', 'Qyzylorda Standard Time': 'Asia/Qyzylorda',
    'India Standard Time': 'Asia/Calcutta', 'Sri Lanka Standard Time': 'Asia/Colombo',
    'Nepal Standard Time': 'Asia/Katmandu', 'Central Asia Standard Time': 'Asia/Almaty',
    'Bangladesh Standard Time': 'Asia/Dhaka', 'Omsk Standard Time': 'Asia/Omsk',
    'Myanmar Standard Time': 'Asia/Rangoon', 'SE Asia Standard Time': 'Asia/Bangkok',
    'Altai Standard Time': 'Asia/Barnaul', 'W. Mongolia Standard Time': 'Asia/Hovd',
    'Novosibirsk Standard Time': 'Asia/Novosibirsk', 'Tomsk Standard Time': 'Asia/Tomsk',
    'China Standard Time': 'Asia/Shanghai', 'North Asia Standard Time': 'Asia/Krasnoyarsk',
    'Singapore Standard Time': 'Asia/Singapore', 'W. Australia Standard Time': 'Australia/Perth',
    'Taipei Standard Time': 'Asia/Taipei', 'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
    'Aus Central W. Standard Time': 'Australia/Eucla', 'Transbaikal Standard Time': 'Asia/Chita',
    'Tokyo Standard Time': 'Asia/Tokyo', 'North Korea Standard Time': 'Asia/Pyongyang',
    'Korea Standard Time': 'Asia/Seoul', 'Yakutsk Standard Time': 'Asia/Yakutsk',
    'Cen. Australia Standard Time': 'Australia/Adelaide', 'AUS Central Standard Time': 'Australia/Darwin',
    'E. Australia Standard Time': 'Australia/Brisbane', 'AUS Eastern Standard Time': 'Australia/Sydney',
    'West Pacific Standard Time': 'Pacific/Port_Moresby', 'Tasmania Standard Time': 'Australia/Hobart',
    'Vladivostok Standard Time': 'Asia/Vladivostok', 'Lord Howe Standard Time': 'Australia/Lord_Howe',
    'Bougainville Standard Time': 'Pacific/Bougainville', 'Russia Time Zone 10': 'Asia/Srednekolymsk',
    'Magadan Standard Time': 'Asia/Magadan', 'Norfolk Standard Time': 'Pacific/Norfolk',
    'Sakhalin Standard Time': 'Asia/Sakhalin', 'Central Pacific Standard Time': 'Pacific/Guadalcanal',
    'Russia Time Zone 11': 'Asia/Kamchatka', 'New Zealand Standard Time': 'Pacific/Auckland',
    'UTC+12': 'Etc/GMT-12', 'Fiji Standard Time': 'Pacific/Fiji', 'Kamchatka Standard Time': 'Asia/Kamchatka',
    'Chatham Islands Standard Time': 'Pacific/Chatham', 'UTC+13': 'Etc/GMT-13',
    'Tonga Standard Time': 'Pacific/Tongatapu', 'Samoa Standard Time': 'Pacific/Apia',
    'Line Islands Standard Time': 'Pacific/Kiritimati'
};

// IANA name straight through if Intl already recognizes it, else the
// legacy-name mapping above, else null - let the caller fall back to
// this file's own embedded VTIMEZONE block (if any), and ultimately to
// floating-local as a last resort.
function resolveTzidToIanaZone(tzid) {
    if (isRecognizedIanaZone(tzid)) return tzid;
    if (LEGACY_TZID_TO_IANA[tzid]) return LEGACY_TZID_TO_IANA[tzid];
    return null;
}

// --- .ics (RFC 5545) export/import ---

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

// Local wall-clock stamp (no Z, no offset) - used for TZID-qualified
// values, where the offset lives in the TZID param instead.
function icsDateTimeStamp(date) {
    return icsDateStamp(date) + 'T' + toTimeInputValue(date).replace(':', '') + '00';
}

function icsUtcStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function icsUtcNow() {
    return icsUtcStamp(new Date());
}

// RFC 5545 UTC-OFFSET ("-0500", "+0530"), not Intl's "GMT-05:00" form.
function formatIcsUtcOffset(minutes) {
    let sign = minutes < 0 ? '-' : '+';
    let abs = Math.abs(minutes);
    return sign + pad(Math.floor(abs / 60)) + pad(abs % 60);
}

function parseIcsUtcOffset(value) {
    let m = String(value).match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
    if (!m) return null;
    let sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// No tzid: a fixed UTC instant (single events - simplest, universally
// interoperable). With tzid: local wall-clock value + TZID param
// (recurring series - keeps occurrences pinned to local time across DST;
// see buildVTimeZoneBlock()).
function icsDtLine(name, date, allDay, tzid) {
    if (allDay) return name + ';VALUE=DATE:' + icsDateStamp(date);
    if (tzid) return name + ';TZID=' + tzid + ':' + icsDateTimeStamp(date);
    return name + ':' + icsUtcStamp(date);
}

// Y/M/D/H/M/S wall-clock reading of a UTC instant in an arbitrary IANA
// zone (not the browser's own) - used to compute VTIMEZONE observance
// DTSTARTs, which must be expressed in that zone's own local time.
function wallClockPartsInZone(zone, utcMs) {
    let parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(utcMs));
    let get = function (type) { return parts.find(function (p) { return p.type === type; }).value; };
    return { y: +get('year'), mo: +get('month') - 1, d: +get('day'), hh: +get('hour'), mi: +get('minute'), ss: +get('second') };
}

// Generates a VTIMEZONE for `zone` covering roughly the last year
// through the next 5 - a coarse monthly scan finds which months have a
// transition, then each is bisected down to the minute. Pure
// compatibility aid for parsers that don't resolve a bare IANA TZID by
// name (most do); this app's own DTSTART/EXDATE/UNTIL values are already
// correct via the TZID string alone.
function buildVTimeZoneBlock(zone) {
    let startYear = new Date().getFullYear() - 1;
    let endYear = startYear + 6;
    let rangeStartMs = Date.UTC(startYear, 0, 1);
    let rangeEndMs = Date.UTC(endYear, 0, 1);

    let samples = [];
    for (let ms = rangeStartMs; ms < rangeEndMs; ms += 30 * 24 * 3600000) {
        samples.push({ ms: ms, offset: tzOffsetMinutesAt(zone, ms) });
    }
    samples.push({ ms: rangeEndMs, offset: tzOffsetMinutesAt(zone, rangeEndMs) });

    let transitions = [];
    for (let i = 1; i < samples.length; i++) {
        if (samples[i].offset === samples[i - 1].offset) continue;
        let lo = samples[i - 1].ms, hi = samples[i].ms;
        let loOffset = samples[i - 1].offset;
        while (hi - lo > 60000) {
            let mid = lo + Math.floor((hi - lo) / 2 / 60000) * 60000;
            if (tzOffsetMinutesAt(zone, mid) === loOffset) lo = mid; else hi = mid;
        }
        transitions.push({ atUtcMs: hi, fromOffset: loOffset, toOffset: tzOffsetMinutesAt(zone, hi) });
    }

    let lines = ['BEGIN:VTIMEZONE', 'TZID:' + zone];
    if (!transitions.length) {
        // No DST in this window - one flat observance covers it all.
        let offset = tzOffsetMinutesAt(zone, rangeStartMs);
        lines.push(
            'BEGIN:STANDARD',
            'DTSTART:' + icsDateTimeStamp(new Date(startYear, 0, 1)),
            'TZOFFSETFROM:' + formatIcsUtcOffset(offset),
            'TZOFFSETTO:' + formatIcsUtcOffset(offset),
            'END:STANDARD'
        );
    } else {
        transitions.forEach(function (t) {
            let wc = wallClockPartsInZone(zone, t.atUtcMs);
            let kind = t.toOffset > t.fromOffset ? 'DAYLIGHT' : 'STANDARD';
            lines.push(
                'BEGIN:' + kind,
                'DTSTART:' + icsDateTimeStamp(new Date(wc.y, wc.mo, wc.d, wc.hh, wc.mi, wc.ss)),
                'TZOFFSETFROM:' + formatIcsUtcOffset(t.fromOffset),
                'TZOFFSETTO:' + formatIcsUtcOffset(t.toOffset),
                'END:' + kind
            );
        });
    }
    lines.push('END:VTIMEZONE');
    return lines;
}

// "2026-08-15"/"2026-08-15T07:00" to RFC 5545's compact form.
function toIcsCompact(dashColonStr, allDay) {
    if (allDay) return dashColonStr.replace(/-/g, '');
    let parts = dashColonStr.split('T');
    return parts[0].replace(/-/g, '') + 'T' + parts[1].replace(':', '') + '00';
}

function recurToIcsRRuleLine(recur, allDay, tzid) {
    let freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
    let parts = ['FREQ=' + freqMap[recur.freq]];
    if (recur.interval > 1) parts.push('INTERVAL=' + recur.interval);
    if (recur.byday && recur.byday.length) parts.push('BYDAY=' + recur.byday.join(','));
    if (recur.end === 'count' && recur.count) {
        parts.push('COUNT=' + recur.count);
    } else if (recur.end === 'until' && recur.until) {
        let untilStr = formatUntil(recur.until, recur.dtstart, allDay);
        if (allDay) {
            parts.push('UNTIL=' + toIcsCompact(untilStr, true));
        } else {
            // UNTIL can't carry a TZID param, and DTSTART has one here -
            // RFC 5545 (and universal real-world practice) says UNTIL
            // must then be UTC.
            let u = new Date(untilStr);
            let utcMs = localWallClockToUtcMs(tzid, u.getFullYear(), u.getMonth(), u.getDate(), u.getHours(), u.getMinutes(), u.getSeconds());
            parts.push('UNTIL=' + icsUtcStamp(new Date(utcMs)));
        }
    }
    return 'RRULE:' + parts.join(';');
}

function recurToIcsExdateLine(recur, allDay, tzid) {
    if (!recur.exdates || !recur.exdates.length) return null;
    let values = recur.exdates.map(function (s) { return toIcsCompact(s, allDay); });
    if (allDay) return 'EXDATE;VALUE=DATE:' + values.join(',');
    return 'EXDATE;TZID=' + tzid + ':' + values.join(',');
}

// Lets a re-imported file we exported ourselves resolve to the same
// event id, for duplicate detection on import.
let PEERGOS_UID_SUFFIX = '@peergos.org';

function idFromIcsUid(uid) {
    return uid.endsWith(PEERGOS_UID_SUFFIX) ? uid.slice(0, -PEERGOS_UID_SUFFIX.length) : uid;
}

// Only ids we minted ourselves get a Peergos UID - a foreign UID stays
// untouched on re-export.
function isNativeEventId(id) {
    return /^evt-\d+-[a-z0-9]+$/.test(id);
}

// A recurring event with no occurrence in the current range has
// ev.start === null, so duration can't be derived from start/end -
// read it off the event-store def instead.
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
        // TZID, not UTC - see icsDtLine().
        let tzid = ev.allDay ? null : LOCAL_TZ;
        let dtstart = ev.allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
        let durationMs = ev.start ? (ev.end || ev.start).getTime() - ev.start.getTime() : recurringDurationMs(ev.id);
        lines.push(icsDtLine('DTSTART', dtstart, ev.allDay, tzid));
        lines.push(icsDtLine('DTEND', new Date(dtstart.getTime() + durationMs), ev.allDay, tzid));
        lines.push(recurToIcsRRuleLine(recur, ev.allDay, tzid));
        let exdateLine = recurToIcsExdateLine(recur, ev.allDay, tzid);
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
    // Every TZID this app emits is LOCAL_TZ (see eventToIcsLines) - one
    // shared VTIMEZONE block, included only if something needs it.
    let usesLocalTz = veventLines.some(function (l) { return l.indexOf(';TZID=' + LOCAL_TZ + ':') !== -1; });
    let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peergos//Calendar 0.0.1//EN', 'CALSCALE:GREGORIAN']
        .concat(usesLocalTz ? buildVTimeZoneBlock(LOCAL_TZ) : [])
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

// mailto: can't carry an attachment - sends a plain-text summary instead
// of the .ics file.
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

// Walks event-store defs, not calendar.getEvents() - a recurring series
// with no occurrence in the current view still has a def.
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

// tzResolver(tzid, y, mo, d, hh, mi, ss) -> UTC ms, or null to fall back
// to floating-local (see makeTzResolver() for the resolution chain).
function parseIcsDateValue(value, params, tzResolver) {
    let m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    let y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (params.VALUE === 'DATE' || !m[4]) {
        return { date: new Date(y, mo, d), allDay: true };
    }
    let hh = +m[4], mi = +m[5], ss = +m[6];
    if (m[7]) return { date: new Date(Date.UTC(y, mo, d, hh, mi, ss)), allDay: false };
    if (params.TZID && tzResolver) {
        let utcMs = tzResolver(params.TZID, y, mo, d, hh, mi, ss);
        if (utcMs !== null) return { date: new Date(utcMs), allDay: false };
    }
    return { date: new Date(y, mo, d, hh, mi, ss), allDay: false };
}

// Parses a file's own VTIMEZONE block into a sorted list of offset
// transitions - the fallback path when a TZID is neither a recognized
// IANA zone nor a known legacy name. STANDARD/DAYLIGHT observances
// defined with a recurring RRULE (the common shape, e.g. "last Sunday of
// March") are expanded with the already-vendored rrule.js rather than a
// hand-written RRULE evaluator.
function parseVTimeZoneOffsets(blockLines) {
    let observances = [];
    let current = null;
    blockLines.forEach(function (line) {
        if (line === 'BEGIN:STANDARD' || line === 'BEGIN:DAYLIGHT') {
            current = [];
        } else if (line === 'END:STANDARD' || line === 'END:DAYLIGHT') {
            if (current) observances.push(current);
            current = null;
        } else if (current) {
            current.push(line);
        }
    });

    let transitions = [];
    observances.forEach(function (obsLines) {
        let props = obsLines.map(parseIcsPropertyLine).filter(Boolean);
        let find = function (name) { return props.find(function (p) { return p.name === name; }); };
        let dtstartLine = find('DTSTART');
        let offsetLine = find('TZOFFSETTO');
        if (!dtstartLine || !offsetLine) return;
        let offsetMinutes = parseIcsUtcOffset(offsetLine.value);
        if (offsetMinutes === null) return;
        let startParsed = parseIcsDateValue(dtstartLine.value, {});
        if (!startParsed) return;

        let rruleLine = find('RRULE');
        if (rruleLine) {
            try {
                let options = rrule.RRule.parseString(rruleLine.value);
                options.dtstart = toFakeUtc(startParsed.date);
                let rr = new rrule.RRule(options);
                // Relative to *now*, not the observance's own DTSTART -
                // real files often anchor these to a placeholder year
                // like 1601, which would otherwise leave a present-day
                // target with no transition nearby.
                let nowYear = new Date().getFullYear();
                let windowStart = toFakeUtc(startParsed.date);
                let tenYearsAgo = toFakeUtc(new Date(nowYear - 10, 0, 1));
                if (tenYearsAgo > windowStart) windowStart = tenYearsAgo;
                let windowEnd = toFakeUtc(new Date(nowYear + 10, 0, 1));
                rr.between(windowStart, windowEnd, true).forEach(function (occ) {
                    transitions.push({ ms: fromFakeUtc(occ).getTime(), offsetMinutes: offsetMinutes });
                });
            } catch (e) {
                transitions.push({ ms: startParsed.date.getTime(), offsetMinutes: offsetMinutes });
            }
        } else {
            transitions.push({ ms: startParsed.date.getTime(), offsetMinutes: offsetMinutes });
            let rdateLine = find('RDATE');
            if (rdateLine) {
                rdateLine.value.split(',').forEach(function (v) {
                    let parsed = parseIcsDateValue(v.trim(), {});
                    if (parsed) transitions.push({ ms: parsed.date.getTime(), offsetMinutes: offsetMinutes });
                });
            }
        }
    });
    transitions.sort(function (a, b) { return a.ms - b.ms; });
    return transitions;
}

// Latest transition at or before naiveMs - both sides use the same
// floating/local interpretation, so their relative order is valid even
// though neither is a real UTC instant on its own.
function offsetAtFromTransitions(transitions, naiveMs) {
    let result = null;
    for (let i = 0; i < transitions.length; i++) {
        if (transitions[i].ms > naiveMs) break;
        result = transitions[i].offsetMinutes;
    }
    return result;
}

// Builds the tzResolver passed to parseIcsDateValue for one file: a
// recognized IANA zone name first, then a mapped legacy zone name, then
// that file's own embedded VTIMEZONE block for this exact TZID, then
// null (caller falls back to floating-local).
function makeTzResolver(fileVTimeZones) {
    return function (tzid, y, mo, d, hh, mi, ss) {
        let zone = resolveTzidToIanaZone(tzid);
        if (zone) return localWallClockToUtcMs(zone, y, mo, d, hh, mi, ss);
        let transitions = fileVTimeZones[tzid];
        if (transitions && transitions.length) {
            let naiveMs = new Date(y, mo, d, hh, mi, ss).getTime();
            let offsetMinutes = offsetAtFromTransitions(transitions, naiveMs);
            if (offsetMinutes !== null) return Date.UTC(y, mo, d, hh, mi, ss) - offsetMinutes * 60000;
        }
        return null;
    };
}

function parseIcsRRuleValue(value, dtstartTzid, tzResolver) {
    let freqMap = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
    let props = {};
    value.split(';').forEach(function (p) {
        let eq = p.indexOf('=');
        if (eq !== -1) props[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    });
    let freq = freqMap[props.FREQ];
    if (!freq) return null; // HOURLY/MINUTELY/SECONDLY - not in our UI's scope

    let recur = { freq: freq, interval: props.INTERVAL ? parseInt(props.INTERVAL, 10) : 1, end: 'never', until: null, count: null, exdates: [] };

    // Only two BYDAY shapes are representable by the UI: plain weekday
    // codes on WEEKLY, or one ordinal code on MONTHLY. Anything else
    // (BYMONTHDAY/BYMONTH/etc, mixed ordinals) is dropped with a warning.
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
        // UNTIL can't carry its own TZID param but is meant to match
        // DTSTART's zone, so that's applied here as if it were one.
        let parsed = parseIcsDateValue(props.UNTIL, dtstartTzid ? { TZID: dtstartTzid } : {}, tzResolver);
        if (parsed) {
            recur.end = 'until';
            recur.until = toDateInputValue(parsed.date);
        }
    }
    return recur;
}

function parseIcsVevent(rawLines, tzResolver) {
    let props = rawLines.map(parseIcsPropertyLine).filter(Boolean);
    let find = function (name) { return props.find(function (p) { return p.name === name; }); };
    let findAll = function (name) { return props.filter(function (p) { return p.name === name; }); };

    let dtstartLine = find('DTSTART');
    if (!dtstartLine) return null;
    let startParsed = parseIcsDateValue(dtstartLine.value, dtstartLine.params, tzResolver);
    if (!startParsed) return null;
    let allDay = startParsed.allDay;
    let start = startParsed.date;

    let dtendLine = find('DTEND');
    let end;
    if (dtendLine) {
        let endParsed = parseIcsDateValue(dtendLine.value, dtendLine.params, tzResolver);
        end = endParsed ? endParsed.date : start;
    } else {
        end = allDay ? addDays(start, 1) : new Date(start.getTime() + 3600000);
    }

    let rruleLine = find('RRULE');
    let recur = rruleLine ? parseIcsRRuleValue(rruleLine.value, dtstartLine.params.TZID, tzResolver) : null;
    if (recur) {
        recur.dtstart = allDay ? toDateInputValue(start) : (toDateInputValue(start) + 'T' + toTimeInputValue(start));
        findAll('EXDATE').forEach(function (l) {
            l.value.split(',').forEach(function (v) {
                let parsed = parseIcsDateValue(v.trim(), l.params, tzResolver);
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

// `failed` counts VEVENT blocks that didn't produce a usable event.
// VTIMEZONE blocks are siblings of VEVENT (not nested inside one), so
// they're collected in a first pass and turned into a per-TZID offset
// resolver before any VEVENT is actually parsed.
function parseIcsFile(text) {
    let lines = unfoldIcsLines(text);
    let vtimezoneBlocks = [];
    let veventBlocks = [];
    let current = null;
    let currentKind = null;
    lines.forEach(function (line) {
        if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTIMEZONE') {
            current = [];
            currentKind = line.slice('BEGIN:'.length);
        } else if (line === 'END:VEVENT' || line === 'END:VTIMEZONE') {
            if (current) (currentKind === 'VEVENT' ? veventBlocks : vtimezoneBlocks).push(current);
            current = null;
            currentKind = null;
        } else if (current) {
            current.push(line);
        }
    });

    let fileVTimeZones = {};
    vtimezoneBlocks.forEach(function (blockLines) {
        let tzidLine = blockLines.map(parseIcsPropertyLine).filter(Boolean).find(function (p) { return p.name === 'TZID'; });
        if (tzidLine) fileVTimeZones[tzidLine.value] = parseVTimeZoneOffsets(blockLines);
    });
    let tzResolver = makeTzResolver(fileVTimeZones);

    let events = [];
    let failed = 0;
    veventBlocks.forEach(function (blockLines) {
        let ev = parseIcsVevent(blockLines, tzResolver);
        if (ev) events.push(ev); else failed++;
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

// Shared by "delete this and following" and "edit this and following".
// Ends the series at the occurrence before the split point, or removes
// it outright if the split point is the first occurrence.
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

// Finds an event's current DOM element by id (data-search-event-id, set
// in eventDidMount below).
function findEventAnchorEl(id) {
    return document.querySelector('[data-search-event-id="' + CSS.escape(id) + '"]');
}

function positionPopover(anchorEl) {
    let anchorRect = anchorEl.getBoundingClientRect();
    let popRect = popover.getBoundingClientRect();
    let left = Math.min(anchorRect.left, window.innerWidth - popRect.width - 8);
    left = Math.max(8, left);
    // Prefer below; flip above only if below doesn't fit and above does.
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

    let writable = isCalendarWritable(ev.extendedProps.calendarId);
    popoverActions.style.display = writable ? '' : 'none';
    // See .event-popover.has-actions in calendar.css
    popover.classList.toggle('has-actions', writable);

    anchorEl.classList.add('fc-event-selected');
    popover.classList.add('open');
    positionPopover(anchorEl);
    // Re-position shortly after - FullCalendar's own row-height pass can
    // still settle the anchor after this synchronous call.
    setTimeout(function () {
        if (!popover.classList.contains('open')) return;
        positionPopover(anchorEl.isConnected ? anchorEl : (findEventAnchorEl(ev.id) || anchorEl));
    }, 0);
}

function hideEventPopover() {
    popoverEvent = null;
    let selected = document.querySelector('.fc-event-selected');
    if (selected) selected.classList.remove('fc-event-selected');
    popover.classList.remove('open');
}

// Client-side only, behind one function so a real backend API can swap
// in later. Walks event-store defs, not calendar.getEvents(), so a
// recurring series stays searchable from any month.
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

function formatSearchResultMeta(ev, jumpDate, cal) {
    let dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    let text = dateFmt.format(jumpDate);
    if (!ev.allDay) {
        let timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
        text += ' · ' + timeFmt.format(jumpDate);
    }
    if (ev.extendedProps.location) text += ' · ' + ev.extendedProps.location;
    if (cal) text += ' · ' + cal.name;
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
        let cal = getCalendarById(ev.extendedProps.calendarId);
        if (cal) {
            let dot = document.createElement('span');
            dot.className = 'search-result-dot';
            dot.style.backgroundColor = displayColor(cal.color);
            titleRow.appendChild(dot);
        }
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
        metaRow.textContent = formatSearchResultMeta(ev, match.jumpDate, cal);

        item.appendChild(titleRow);
        item.appendChild(metaRow);
        // Otherwise the "click outside closes popover" listener closes
        // the popover jumpToSearchResult() just opened, same event.
        item.addEventListener('click', function (e) {
            e.stopPropagation();
            jumpToSearchResult(ev, match.jumpDate);
        });
        searchResults.appendChild(item);
    });
}

// Navigates then opens the event's popover, then re-resolves to the
// nearest real instance (ev may be a recurring master with .start ===
// null before gotoDate() makes an occurrence exist).
function jumpToSearchResult(ev, jumpDate) {
    closeSearchResults();
    // A hidden calendar's events aren't in the DOM at all - re-enable so
    // findEventAnchorEl() below has something to find.
    if (!isCalendarVisible(ev.extendedProps.calendarId)) {
        getCalendarById(ev.extendedProps.calendarId).visible = true;
        applyCalendarVisibility();
        renderCalendarList();
    }
    // Same slide transition as swipe/Previous/Next/Today - only if the
    // view actually changes.
    let viewChanging = jumpDate < calendar.view.activeStart || jumpDate >= calendar.view.activeEnd;
    if (viewChanging) freezeForViewTransition(jumpDate < calendar.view.activeStart ? 'prev' : 'next');
    calendar.gotoDate(jumpDate);
    if (viewChanging) settleViewTransition();
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

function isCalendarWritable(calendarId) {
    let cal = getCalendarById(calendarId);
    return !cal || !cal.readOnly;
}

function isCalendarVisible(calendarId) {
    let cal = getCalendarById(calendarId);
    return !cal || cal.visible;
}

// Uses FullCalendar's own per-event `display` property, not CSS, so
// hidden events are excluded from layout (e.g. "+N more" counts).
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
        // Read-only calendars aren't a valid save target, except the
        // event's own current one (so its name still shows while editing).
        if (cal.readOnly && cal.id !== selectedId) return;
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

// Defensive backstop - Delete isn't even rendered for these (see
// renderCalendarList()).
function deleteCalendar(id) {
    let cal = getCalendarById(id);
    if (!cal || cal.primary || cal.readOnly) return;
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

        if (cal.readOnly) {
            let badge = document.createElement('span');
            badge.className = 'calendar-readonly-badge';
            badge.title = 'Shared with you (read-only)';
            badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/></svg>';
            item.appendChild(badge);
        }

        // Menu is always shown (Export is read-only); Edit/Share/Delete
        // are added below only when this specific calendar is writable.
        let menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'calendar-menu-button';
        menuButton.setAttribute('aria-label', cal.name + ' calendar options');
        menuButton.title = 'Options';
        menuButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/></svg>';

        let menu = document.createElement('div');
        menu.className = 'calendar-menu';

        if (isCalendarWritable(cal.id)) {
            let editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg> Edit';
            editBtn.addEventListener('click', function () {
                closeAllCalendarMenus();
                openCalendarModal('edit', cal);
            });
            menu.appendChild(editBtn);
        }

        // No Share for the primary calendar (not shared) or a read-only
        // one (can't re-share access you don't own).
        if (isCalendarWritable(cal.id) && !cal.primary) {
            let shareBtn = document.createElement('button');
            shareBtn.type = 'button';
            shareBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M8.7 10.7l6.6 -3.4"/><path d="M8.7 13.3l6.6 3.4"/></svg> Share';
            shareBtn.addEventListener('click', function () {
                closeAllCalendarMenus();
                openShareModal('calendar:' + cal.id, cal.name);
            });
            menu.appendChild(shareBtn);
        }

        let exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/></svg> Export';
        exportBtn.addEventListener('click', function () {
            closeAllCalendarMenus();
            exportCalendarAsIcs(cal.id);
        });
        menu.appendChild(exportBtn);

        if (isCalendarWritable(cal.id) && !cal.primary) {
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

        // Clicking anywhere in the row toggles visibility, not just the
        // checkbox - a bigger target for something done often.
        // menuButton's own handler already stops its clicks reaching
        // here; .calendar-menu's buttons don't, hence the explicit guard.
        item.addEventListener('click', function (e) {
            if (e.target === checkbox) return;
            if (e.target.closest('.calendar-menu')) return;
            checkbox.checked = !checkbox.checked;
            cal.visible = checkbox.checked;
            applyCalendarVisibility();
        });

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

// Generic confirm dialog, not scoped to calendar deletion specifically.
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

// Purely informational (no onConfirm/Cancel) - openConfirmModal()'s OK
// button is styled for a destructive action, doesn't fit here.
function openImportSummaryModal(message) {
    importSummaryMessage.textContent = message;
    importSummaryModalBackdrop.classList.add('open');
}

function closeImportSummaryModal() {
    importSummaryModalBackdrop.classList.remove('open');
}

// Mock sharing state, keyed by 'event:<id>'/'calendar:<id>'. Read-only
// per-user sharing and a secret link only - no write-access option.
let mockShares = {};
let shareModalKey = null;

function getShareState(key) {
    if (!mockShares[key]) mockShares[key] = { users: [], secretLink: null };
    return mockShares[key];
}

function renderShareUserList() {
    let state = getShareState(shareModalKey);
    shareUserList.innerHTML = '';
    if (!state.users.length) {
        let empty = document.createElement('div');
        empty.className = 'share-empty';
        empty.textContent = 'Not shared with anyone yet.';
        shareUserList.appendChild(empty);
        return;
    }
    state.users.forEach(function (username) {
        let row = document.createElement('div');
        row.className = 'share-user-row';
        let name = document.createElement('span');
        name.className = 'share-username';
        name.textContent = username;
        let removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove ' + username);
        removeBtn.title = 'Remove';
        removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>';
        removeBtn.addEventListener('click', function () {
            state.users = state.users.filter(function (u) { return u !== username; });
            renderShareUserList();
        });
        row.appendChild(name);
        row.appendChild(removeBtn);
        shareUserList.appendChild(row);
    });
}

function openShareModal(key, displayName) {
    shareModalKey = key;
    let kind = key.indexOf('calendar:') === 0 ? 'calendar' : 'event';
    // Real elements, not innerHTML (displayName is user-entered text) -
    // only the name itself truncates, "Share"/kind stay fully visible.
    shareModalHeading.innerHTML = '';
    let prefix = document.createElement('span');
    prefix.className = 'share-modal-fixed';
    prefix.textContent = 'Share "';
    let nameSpan = document.createElement('span');
    nameSpan.className = 'share-modal-name';
    nameSpan.textContent = displayName;
    let suffix = document.createElement('span');
    suffix.className = 'share-modal-fixed';
    suffix.textContent = '" ' + kind;
    shareModalHeading.appendChild(prefix);
    shareModalHeading.appendChild(nameSpan);
    shareModalHeading.appendChild(suffix);
    shareUsernameInput.value = '';
    let state = getShareState(key);
    shareLinkRow.classList.toggle('open', !!state.secretLink);
    if (state.secretLink) shareLinkInput.value = state.secretLink;
    renderShareUserList();
    shareModalBackdrop.classList.add('open');
}

function closeShareModal() {
    shareModalBackdrop.classList.remove('open');
    shareModalKey = null;
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

    let targetCalendarId = mode === 'edit' ? opts.event.extendedProps.calendarId
        : ((opts.prefill && opts.prefill.calendarId) || mockCalendars[0].id);
    let writable = isCalendarWritable(targetCalendarId);
    editableFields.forEach(el => el.disabled = !writable);
    saveButton.style.display = writable ? '' : 'none';
    saveButton.disabled = !writable;
    deleteButton.style.display = (writable && mode === 'edit') ? '' : 'none';
    deleteButton.disabled = !writable;
    cancelButton.textContent = writable ? 'Cancel' : 'Close';

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
        // opts.endDate is exclusive, same as ev.end - needs the same
        // toFormEnd() conversion.
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
    titleInput.focus();
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
// a fixed string) in sync if the date changes while the modal is open.
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
    if (isCalendarWritable(ev.extendedProps.calendarId) && ev.extendedProps.recur) {
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
    // Defensive backstop - button is already absent when not writable.
    if (!isCalendarWritable(ev.extendedProps.calendarId)) return;
    hideEventPopover();
    if (ev.extendedProps.recur) {
        openScopeModal(ev, 'delete');
    } else {
        ev.remove();
    }
});

// Duplicates just the clicked occurrence as a standalone non-recurring
// event, even for a recurring series.
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

popoverShareButton.addEventListener('click', function () {
    let ev = popoverEvent;
    hideEventPopover();
    openShareModal('event:' + ev.id, ev.title);
});

// Defaults to real "now", not whatever date happens to be in view -
// matches other calendar apps' always-visible create button.
toolbarAddButton.addEventListener('click', function () {
    let now = new Date();
    openModal('create', { date: now, endDate: new Date(now.getTime() + 3600000), allDay: false });
});

// Month <select> (hardcoded English names) + a plain year number input,
// not a year <select> (would need an arbitrary min/max cap) or a native
// date input (renders/positions inconsistently across browsers).
let MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
MONTH_NAMES.forEach(function (name, i) {
    let option = document.createElement('option');
    option.value = i;
    option.textContent = name;
    gotoDateMonthInput.appendChild(option);
});

function openGotoDatePicker(anchorEl) {
    let current = calendar.getDate();
    gotoDateMonthInput.value = current.getMonth();
    gotoDateYearInput.value = current.getFullYear();
    gotoDateMenu.classList.add('open');
    // Below MOBILE_BREAKPOINT it's a full-width bottom sheet (CSS media
    // query) instead of anchored under the title - clear any inline
    // position left over from a wider-window open so the CSS rules
    // apply cleanly.
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
        gotoDateMenu.style.left = '';
        gotoDateMenu.style.top = '';
        return;
    }
    // Width isn't known until rendered with real content, hence
    // measuring only after .open above.
    let rect = anchorEl.getBoundingClientRect();
    let menuWidth = gotoDateMenu.getBoundingClientRect().width;
    let margin = 8;
    let desiredLeft = rect.left + rect.width / 2 - menuWidth / 2;
    gotoDateMenu.style.left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - margin - menuWidth)) + 'px';
    gotoDateMenu.style.top = rect.bottom + 'px';
}

// Preserves the currently-viewed day-of-month where possible, clamped to
// however many days the target month actually has (Jan 31 -> Feb 28/29,
// not an overflow into March).
function navigateToSelectedMonthYear() {
    let year = parseInt(gotoDateYearInput.value, 10);
    if (!year) return; // empty/cleared year field - not a real value yet
    let month = parseInt(gotoDateMonthInput.value, 10);
    let day = Math.min(calendar.getDate().getDate(), new Date(year, month + 1, 0).getDate());
    let jumpDate = new Date(year, month, day);
    let viewChanging = jumpDate < calendar.view.activeStart || jumpDate >= calendar.view.activeEnd;
    if (viewChanging) freezeForViewTransition(jumpDate < calendar.view.activeStart ? 'prev' : 'next');
    calendar.gotoDate(jumpDate);
    if (viewChanging) settleViewTransition();
}

gotoDateMonthInput.addEventListener('change', navigateToSelectedMonthYear);
gotoDateYearInput.addEventListener('change', navigateToSelectedMonthYear);

// 'change' alone (fires on blur) isn't enough on mobile: a numeric
// keyboard often has no Enter/Done key that would blur the field, so
// typing a year and having nothing happen reads as broken. Debounced
// 'input' navigates automatically shortly after the user stops typing,
// without needing an explicit confirm step at all. Only once 4 digits
// are in, though - navigating after "1" or "20" would jump to year 1 or
// 20 mid-type, before the user's actually finished entering the year
// they meant.
let gotoDateYearInputTimer = null;
gotoDateYearInput.addEventListener('input', function () {
    clearTimeout(gotoDateYearInputTimer);
    if (gotoDateYearInput.value.length !== 4) return;
    gotoDateYearInputTimer = setTimeout(navigateToSelectedMonthYear, 600);
});

function stepGotoDateYear(delta) {
    let year = (parseInt(gotoDateYearInput.value, 10) || calendar.getDate().getFullYear()) + delta;
    gotoDateYearInput.value = Math.max(1, Math.min(9999, year));
    navigateToSelectedMonthYear();
}

// Explicit +/- buttons instead of relying on the year field's own
// native spinner arrows - those are notoriously tiny/unreliable to tap
// on a touch screen.
gotoDateYearDownButton.addEventListener('click', function () { stepGotoDateYear(-1); });
gotoDateYearUpButton.addEventListener('click', function () { stepGotoDateYear(1); });

overflowMenuButton.addEventListener('click', function () {
    overflowMenu.classList.toggle('open');
});

overflowImportButton.addEventListener('click', function () {
    overflowMenu.classList.remove('open');
    icsFileInput.click();
});

overflowMenuVersion.textContent = 'FullCalendar v' + FullCalendar.version;

// Skips (rather than overwrites) an event whose id already exists.
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
        // Otherwise a wrong-file-type pick reads as a misleading "0 events".
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

// Always visible, not a click-to-open trigger. Clicking the search
// button just focuses the input - results already render live.
searchButton.addEventListener('click', function () {
    searchInput.focus();
});

searchInput.addEventListener('input', function () {
    searchClearButton.classList.toggle('visible', searchInput.value.length > 0);
    renderSearchResults(searchInput.value);
});

// Re-opens the dropdown when refocusing an already-typed query.
searchInput.addEventListener('focus', function () {
    if (searchInput.value.trim()) renderSearchResults(searchInput.value);
});

searchClearButton.addEventListener('click', function () {
    clearSearch();
    searchInput.focus();
});

// Below MOBILE_BREAKPOINT (matches calendar.css's `@media (max-width:
// 700px)`), sidebar is an off-canvas drawer; above it, a collapsing column.
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

shareAddButton.addEventListener('click', function () {
    let username = shareUsernameInput.value.trim();
    if (!username) return;
    let state = getShareState(shareModalKey);
    if (state.users.indexOf(username) === -1) state.users.push(username);
    shareUsernameInput.value = '';
    renderShareUserList();
});

shareUsernameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        shareAddButton.click();
    }
});

shareCreateLinkButton.addEventListener('click', function () {
    let state = getShareState(shareModalKey);
    if (!state.secretLink) {
        state.secretLink = 'https://peergos.example/s/' + Math.random().toString(36).slice(2, 10);
    }
    shareLinkInput.value = state.secretLink;
    shareLinkRow.classList.add('open');
});

shareLinkCopyButton.addEventListener('click', function () {
    shareLinkInput.select();
    if (navigator.clipboard) navigator.clipboard.writeText(shareLinkInput.value);
});

shareCloseButton.addEventListener('click', closeShareModal);

shareModalBackdrop.addEventListener('click', function (e) {
    if (e.target === shareModalBackdrop) closeShareModal();
});

// Closes an open calendar "..." menu on any click outside it. Capture
// phase, not bubble: eventClick's stopPropagation() would otherwise hide
// clicks on events from a bubble-phase listener here.
document.addEventListener('click', function (e) {
    if (!e.target.closest('.calendar-menu button') && !e.target.closest('.calendar-menu-button') && !e.target.closest('#overflow-menu-button') && !e.target.closest('#overflow-menu-version') && !e.target.closest('#goto-date-menu') && !e.target.closest('.goto-date-trigger')) {
        closeAllCalendarMenus();
    }
}, true);

// Closes the search results dropdown on any click outside #search-bar.
// Capture phase, same stopPropagation() reasoning as above.
document.addEventListener('click', function (e) {
    if (!searchBar.contains(e.target)) closeSearchResults();
}, true);

// Clicking outside the popover closes it without swallowing the click,
// so switching straight to a different event works in one click.
document.addEventListener('click', function (e) {
    if (popover.classList.contains('open') && !popover.contains(e.target)) {
        hideEventPopover();
    }
}, true);

// Exception: dismissing the popover/menu shouldn't also create a new
// event via the click underneath it. On touch, stopPropagation() alone
// doesn't work - it only blocks this touchstart, but the browser still
// synthesizes a trailing click regardless, which is what dateClick
// actually fires from. preventDefault() on touchstart suppresses that
// synthetic click, but the outside-click-closes-menu listeners below
// also depend on that same click - so on touch this handler has to
// close the container itself instead.
function preventClickThrough(container, isTriggerTarget, closeContainer) {
    return function (e) {
        if (!container.classList.contains('open')) return;
        if (container.contains(e.target)) return;
        if (isTriggerTarget(e.target)) return;
        e.stopPropagation();
        if (e.type === 'touchstart') {
            e.preventDefault();
            closeContainer();
        }
    };
}

// { passive: false } is required here, not just { capture: true } - Chrome
// defaults document-level touchstart listeners to passive (a scroll-perf
// intervention), which would otherwise silently ignore preventDefault().
let touchGuardOptions = { capture: true, passive: false };

let preventPopoverClickThrough = preventClickThrough(popover, function (target) {
    return !!target.closest('[data-search-event-id]');
}, hideEventPopover);
document.addEventListener('mousedown', preventPopoverClickThrough, true);
document.addEventListener('touchstart', preventPopoverClickThrough, touchGuardOptions);

// Same reasoning, for the goto-date menu - dismissing it (as a mobile
// bottom sheet, tapping "outside" it often means tapping a day cell
// still visible above it) shouldn't also create a new event underneath.
let preventGotoDateClickThrough = preventClickThrough(gotoDateMenu, function (target) {
    return !!target.closest('.goto-date-trigger');
}, closeAllCalendarMenus);
document.addEventListener('mousedown', preventGotoDateClickThrough, true);
document.addEventListener('touchstart', preventGotoDateClickThrough, touchGuardOptions);

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (confirmModalBackdrop.classList.contains('open')) closeConfirmModal();
    else if (importSummaryModalBackdrop.classList.contains('open')) closeImportSummaryModal();
    else if (shareModalBackdrop.classList.contains('open')) closeShareModal();
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

renderCalendarList();

// eventClick fires on both clicks of a double-click - the first click's
// popover is deferred behind a short timer, a second click cancels it
// and opens edit instead. Desktop-only (see isTouchDevice below).
let eventClickTimer = null;

// Fixes Breezy's day-grid (Month/Year) event rows: no color dot by
// default, and the time label right-aligned instead of flush-left.
// Idempotent - re-run on every resize below, since Breezy rebuilds this
// content on resize without re-firing eventDidMount.
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
        // Space-based, not a fixed breakpoint - only drop the time label
        // if dot+time+title would actually overflow the cell.
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
    // "Agenda" is the more familiar name other calendar apps use for
    // this exact view, vs. FullCalendar's generic default "list".
    // Flat listText, not a nested buttonText: { list: ... } - this
    // vendored v7 build has no such nested option (see README).
    listText: 'Agenda',
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
    // dateClick, not selectable/select - plain click/tap only, no drag.
    // New events get a default duration (1 hour timed, 1 day all-day).
    dateClick: function (info) {
        let endDate = info.allDay ? addDays(info.date, 1) : new Date(info.date.getTime() + 60 * 60 * 1000);
        openModal('create', { date: info.date, endDate: endDate, allDay: info.allDay });
    },
    eventClick: function (info) {
        info.jsEvent.stopPropagation();
        if (isTouchDevice) {
            showEventPopover(info.event, info.el);
            return;
        }
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
    },
    // Replaces the title's (FullCalendar's own role="heading") text with
    // one keyboard-reachable .goto-date-trigger span, on every render.
    // Reads arg.view.title, not heading.textContent - once this handler
    // has replaced the heading's children once, FullCalendar's vdom no
    // longer finds the plain text node it expects there and silently
    // stops updating it (datesSet itself still fires correctly either way).
    datesSet: function (arg) {
        let heading = calendarEl.querySelector('[role="heading"]');
        if (!heading) return;
        let text = arg.view.title;
        heading.innerHTML = '';
        let trigger = document.createElement('span');
        trigger.className = 'goto-date-trigger';
        trigger.textContent = text;
        trigger.setAttribute('role', 'button');
        trigger.tabIndex = 0;
        trigger.setAttribute('aria-label', text + ', go to date');
        heading.appendChild(trigger);
    }
});
calendar.render();
applyCalendarVisibility();

// Approximates a slide transition: jump #calendar to an offset position
// with the transition disabled, swap in the new view while still offset,
// then re-enable the transition and animate back to rest.
function freezeForViewTransition(direction) {
    calendarEl.style.transition = 'none';
    calendarEl.style.opacity = '.4';
    calendarEl.style.transform = 'translateX(' + (direction === 'next' ? 20 : -20) + 'px)';
    calendarEl.offsetHeight; // force reflow so the jump above isn't itself animated
}

function settleViewTransition() {
    calendarEl.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
    calendarEl.style.opacity = '1';
    calendarEl.style.transform = 'translateX(0)';
}

// Swipe left/right to go to the next/previous view. touchend only, never
// preventDefault, so it doesn't interfere with vertical scrolling.
let touchStartX = null;
let touchStartY = null;
let SWIPE_MIN_DISTANCE = 50;

calendarEl.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}, { passive: true });

calendarEl.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    let touch = e.changedTouches[0];
    let deltaX = touch.clientX - touchStartX;
    let deltaY = touch.clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY)) return;
    freezeForViewTransition(deltaX < 0 ? 'next' : 'prev');
    if (deltaX < 0) calendar.next(); else calendar.prev();
    settleViewTransition();
}, { passive: true });

// Same slide transition as swipe, for Today/Previous/Next. Breezy hashes
// FullCalendar's own class names, so Today is matched by button text and
// Previous/Next by their aria-label prefix ("Previous <Unit>"/"Next
// <Unit>"). Capture phase: needs to freeze #calendar before FullCalendar's
// own bubble-phase click handler re-renders the view.
calendarEl.addEventListener('click', function (e) {
    let btn = e.target.closest('button');
    if (!btn) return;
    let ariaLabel = btn.getAttribute('aria-label') || '';
    let direction = null;
    if (btn.textContent.trim() === 'Today') {
        let now = new Date();
        if (now < calendar.view.activeStart) direction = 'prev';
        else if (now >= calendar.view.activeEnd) direction = 'next';
    } else if (ariaLabel.indexOf('Previous') === 0) {
        direction = 'prev';
    } else if (ariaLabel.indexOf('Next') === 0) {
        direction = 'next';
    }
    if (!direction) return;
    freezeForViewTransition(direction);
    setTimeout(settleViewTransition, 0);
}, true);

// Delegated (title re-renders on every navigation, see datesSet above) -
// mouse/touch via click, keyboard via Enter/Space since it's a real
// tabbable role="button" now, not a native <button>.
calendarEl.addEventListener('click', function (e) {
    let trigger = e.target.closest('.goto-date-trigger');
    if (trigger) openGotoDatePicker(trigger);
});
calendarEl.addEventListener('keydown', function (e) {
    let trigger = e.target.closest('.goto-date-trigger');
    if ((e.key === 'Enter' || e.key === ' ') && trigger) {
        e.preventDefault();
        openGotoDatePicker(trigger);
    }
});

// Re-applies fixDayGridEventLayout() on resize/rotation, not just at
// mount. Debounced since resize can fire many times in quick succession.
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
