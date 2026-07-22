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

// Only exact for simple FREQ+INTERVAL series (no BYDAY/BYMONTHDAY), which
// matches everything the Repeat UI can currently produce.
function stepOccurrence(date, freq, interval, direction) {
    let d = new Date(date);
    let n = interval * direction;
    if (freq === 'daily') d.setDate(d.getDate() + n);
    else if (freq === 'weekly') d.setDate(d.getDate() + n * 7);
    else if (freq === 'monthly') d.setMonth(d.getMonth() + n);
    else if (freq === 'yearly') d.setFullYear(d.getFullYear() + n);
    return d;
}

function previousOccurrenceBoundary(date, freq, interval) {
    return stepOccurrence(date, freq, interval, -1);
}

function countOccurrencesBefore(dtstart, freq, interval, targetDate) {
    let cursor = dtstart;
    let count = 0;
    while (cursor.getTime() < targetDate.getTime()) {
        cursor = stepOccurrence(cursor, freq, interval, 1);
        count++;
    }
    return count;
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

let mockEvents = [
    {
        id: 'mock-1',
        title: 'Team sync',
        start: mockDate(1, 10, 0),
        end: mockDate(1, 11, 0),
        allDay: false,
        extendedProps: { location: 'Meeting room 2', description: 'Weekly planning call', status: 'active', recur: null }
    },
    {
        id: 'mock-2',
        title: 'Company retreat',
        start: mockDate(3),
        end: mockDate(6),
        allDay: true,
        extendedProps: { location: 'Lake house', description: '', status: 'active', recur: null }
    },
    {
        id: 'mock-3',
        title: 'Dentist',
        start: mockDate(-2, 9, 30),
        end: mockDate(-2, 10, 0),
        allDay: false,
        extendedProps: { location: '', description: '', status: 'cancelled', recur: null }
    },
    {
        id: 'mock-4',
        title: 'Gym',
        allDay: false,
        rrule: { freq: 'daily', interval: 1, dtstart: toDateInputValue(gymStart) + 'T' + toTimeInputValue(gymStart), count: 10 },
        duration: { minutes: 45 },
        extendedProps: {
            location: 'Downtown gym', description: '', status: 'active',
            recur: {
                freq: 'daily', interval: 1, end: 'count', until: null, count: 10,
                dtstart: toDateInputValue(gymStart) + 'T' + toTimeInputValue(gymStart), exdates: []
            }
        }
    }
];

let url = new URL(window.location.href);
let filePath = url.searchParams.get('path');
let isWritable = url.searchParams.get('isPathWritable') == 'true';
let theme = url.searchParams.get('theme');

let modalBackdrop = document.getElementById('event-modal-backdrop');
let form = document.getElementById('event-form');
let titleInput = document.getElementById('event-title');
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
let statusInput = document.getElementById('event-status');
let descriptionInput = document.getElementById('event-description');
let deleteButton = document.getElementById('event-delete');
let saveButton = document.getElementById('event-save');
let cancelButton = document.getElementById('event-cancel');
let modalHeading = document.getElementById('event-modal-heading');
let editableFields = [
    titleInput, allDayInput, startDateInput, startTimeInput, endDateInput, endTimeInput,
    locationInput, repeatFreqInput, repeatIntervalInput, repeatEndInput, repeatUntilInput,
    repeatCountInput, statusInput, descriptionInput
];

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
let popoverDeleteButton = document.getElementById('popover-delete');
let importButton = document.getElementById('import-button');
let icsFileInput = document.getElementById('ics-file-input');

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

function updateRepeatVisibility() {
    let freq = repeatFreqInput.value;
    let repeating = !!freq;
    repeatDetails.style.display = repeating ? '' : 'none';
    repeatIntervalUnit.textContent = intervalUnitLabels[freq] || 'day(s)';
    let endMode = repeatEndInput.value;
    repeatUntilInput.style.display = (repeating && endMode === 'until') ? '' : 'none';
    repeatCountRow.style.display = (repeating && endMode === 'count') ? '' : 'none';
}

function populateRecurForm(recur) {
    repeatFreqInput.value = recur ? recur.freq : '';
    repeatIntervalInput.value = recur ? recur.interval : 1;
    repeatEndInput.value = recur ? recur.end : 'never';
    repeatUntilInput.value = (recur && recur.until) ? recur.until : '';
    repeatCountInput.value = (recur && recur.count) ? recur.count : 10;
    updateRepeatVisibility();
}

function readRecurFromForm() {
    let freq = repeatFreqInput.value;
    if (!freq) return null;
    let end = repeatEndInput.value;
    return {
        freq: freq,
        interval: parseInt(repeatIntervalInput.value, 10) || 1,
        end: end,
        until: end === 'until' ? repeatUntilInput.value : null,
        count: end === 'count' ? (parseInt(repeatCountInput.value, 10) || 1) : null,
        exdates: []
    };
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
        let dtstart = allDay ? new Date(masterRecur.dtstart + 'T00:00') : new Date(masterRecur.dtstart);
        let consumed = countOccurrencesBefore(dtstart, masterRecur.freq, masterRecur.interval, ev.start);
        recur.count = Math.max(1, masterRecur.count - consumed);
    }
    recur.exdates = [];
    return recur;
}

function extraPropsOf(ev) {
    return { location: ev.extendedProps.location, status: ev.extendedProps.status, description: ev.extendedProps.description };
}

function buildRecurringEventPayload(id, title, allDay, extra, recur, durationMs) {
    let rrule = { freq: recur.freq, interval: recur.interval, dtstart: recur.dtstart };
    if (recur.end === 'until' && recur.until) rrule.until = formatUntil(recur.until, recur.dtstart, allDay);
    if (recur.end === 'count' && recur.count) rrule.count = recur.count;
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
        extendedProps: Object.assign({ recur: recur }, extra)
    };
    if (recur.exdates && recur.exdates.length) data.exdate = recur.exdates.slice();
    return data;
}

function buildPlainEventPayload(id, title, allDay, start, end, extra) {
    return {
        id: id,
        title: title,
        allDay: allDay,
        start: start,
        end: end,
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

function eventToIcsLines(ev) {
    let lines = ['BEGIN:VEVENT', 'UID:' + ev.id + '@peergos-calendar', 'DTSTAMP:' + icsUtcNow()];
    let recur = ev.extendedProps.recur;

    if (recur) {
        let dtstart = ev.allDay ? new Date(recur.dtstart + 'T00:00') : new Date(recur.dtstart);
        let durationMs = (ev.end || ev.start).getTime() - ev.start.getTime();
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

function exportEventAsIcs(ev) {
    let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peergos//Calendar 0.0.1//EN', 'CALSCALE:GREGORIAN']
        .concat(eventToIcsLines(ev))
        .concat(['END:VCALENDAR']);
    let text = lines.map(foldIcsLine).join('\r\n') + '\r\n';
    let blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = (ev.title || 'event').replace(/[^a-z0-9-_]+/gi, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    if (props.BYDAY || props.BYMONTHDAY || props.BYMONTH || props.BYYEARDAY || props.BYWEEKNO || props.BYSETPOS) {
        console.warn('Imported RRULE uses BY* parts not supported by this app\'s UI - simplified to plain ' + freq + ' recurrence: ' + value);
    }
    let recur = { freq: freq, interval: props.INTERVAL ? parseInt(props.INTERVAL, 10) : 1, end: 'never', until: null, count: null, exdates: [] };
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
        description: descLine ? unescapeIcsText(descLine.value) : ''
    };

    let id = nextEventId();
    if (recur) return buildRecurringEventPayload(id, title, allDay, extra, recur, end.getTime() - start.getTime());
    return buildPlainEventPayload(id, title, allDay, start, end, extra);
}

function parseIcsFile(text) {
    let lines = unfoldIcsLines(text);
    let events = [];
    let current = null;
    lines.forEach(function (line) {
        if (line === 'BEGIN:VEVENT') {
            current = [];
        } else if (line === 'END:VEVENT') {
            if (current) {
                let ev = parseIcsVevent(current);
                if (ev) events.push(ev);
            }
            current = null;
        } else if (current) {
            current.push(line);
        }
    });
    return events;
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
    let dtstart = master.allDay ? new Date(masterRecur.dtstart + 'T00:00') : new Date(masterRecur.dtstart);
    let untilBoundary = previousOccurrenceBoundary(master.start, masterRecur.freq, masterRecur.interval);
    if (untilBoundary.getTime() < dtstart.getTime()) {
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
    let dateFmt = new Intl.DateTimeFormat(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });
    if (ev.allDay) {
        let lastDay = toFormEnd(ev.end || ev.start, true);
        if (toDateInputValue(lastDay) === toDateInputValue(ev.start)) {
            return dateFmt.format(ev.start) + ' · All day';
        }
        return dateFmt.format(ev.start) + ' – ' + dateFmt.format(lastDay) + ' · All day';
    }
    let timeFmt = new Intl.DateTimeFormat(navigator.language, { hour: 'numeric', minute: '2-digit' });
    return dateFmt.format(ev.start) + ' · ' + timeFmt.format(ev.start) + ' – ' + timeFmt.format(ev.end || ev.start);
}

function positionPopover(anchorEl) {
    let anchorRect = anchorEl.getBoundingClientRect();
    let popRect = popover.getBoundingClientRect();
    let left = Math.min(anchorRect.left, window.innerWidth - popRect.width - 8);
    left = Math.max(8, left);
    let top = anchorRect.bottom + 8;
    if (top + popRect.height > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - popRect.height - 8);
    }
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
}

function hideEventPopover() {
    popoverEvent = null;
    popover.classList.remove('open');
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
    } else {
        let prefill = opts.prefill || {};
        titleInput.value = prefill.title || '';
        allDay = opts.allDay || false;
        start = opts.date;
        end = opts.endDate;
        locationInput.value = prefill.location || '';
        statusInput.value = prefill.status || 'active';
        descriptionInput.value = prefill.description || '';
        recur = null;
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

popoverEditButton.addEventListener('click', function () {
    let ev = popoverEvent;
    hideEventPopover();
    if (isWritable && ev.extendedProps.recur) {
        openScopeModal(ev, 'edit');
    } else {
        openModal('edit', { event: ev, scope: 'all' });
    }
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
            description: ev.extendedProps.description
        }
    });
});

popoverExportButton.addEventListener('click', function () {
    exportEventAsIcs(popoverEvent);
    hideEventPopover();
});

importButton.addEventListener('click', function () {
    icsFileInput.click();
});

icsFileInput.addEventListener('change', function () {
    let file = icsFileInput.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function () {
        let events = parseIcsFile(reader.result);
        events.forEach(function (data) { calendar.addEvent(data); });
        icsFileInput.value = '';
    };
    reader.readAsText(file);
});

document.addEventListener('click', function (e) {
    if (popover.classList.contains('open') && !popover.contains(e.target)) {
        hideEventPopover();
    }
});

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modalBackdrop.classList.contains('open')) closeModal();
    else if (scopeModalBackdrop.classList.contains('open')) closeScopeModal();
    else if (popover.classList.contains('open')) hideEventPopover();
});

form.addEventListener('submit', function (e) {
    e.preventDefault();
    let allDay = allDayInput.checked;
    let start = allDay ? startDateInput.value : new Date(startDateInput.value + 'T' + startTimeInput.value);
    let end = fromFormEnd(allDay);
    let extra = { location: locationInput.value, status: statusInput.value, description: descriptionInput.value };
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

document.getElementById('utility-bar').style.display = isWritable ? '' : 'none';

let calendarEl = document.getElementById('calendar');
let calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: navigator.language.toLowerCase(),
    headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    height: '100%',
    firstDay: 1,
    events: mockEvents,
    eventClass: function (info) {
        return info.event.extendedProps.status === 'cancelled' ? 'fc-event-cancelled' : '';
    },
    selectable: isWritable,
    select: function (info) {
        openModal('create', { date: info.start, endDate: info.end, allDay: info.allDay });
    },
    eventClick: function (info) {
        info.jsEvent.stopPropagation();
        showEventPopover(info.event, info.el);
    }
});
calendar.render();
