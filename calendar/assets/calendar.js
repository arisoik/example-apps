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
                dtstart: toDateInputValue(gymStart) + 'T' + toTimeInputValue(gymStart)
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

let editingEvent = null;

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
        count: end === 'count' ? (parseInt(repeatCountInput.value, 10) || 1) : null
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

function openModal(mode, opts) {
    editingEvent = mode === 'edit' ? opts.event : null;
    modalHeading.textContent = mode === 'edit' ? 'Edit event' : 'New event';

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
        recur = ev.extendedProps.recur || null;
        if (recur) {
            let range = seriesFormRange(ev, recur, allDay);
            start = range.start;
            end = range.end;
        } else {
            start = ev.start;
            end = toFormEnd(ev.end || ev.start, allDay);
        }
        locationInput.value = ev.extendedProps.location || '';
        statusInput.value = ev.extendedProps.status || 'active';
        descriptionInput.value = ev.extendedProps.description || '';
    } else {
        titleInput.value = '';
        allDay = opts.allDay || false;
        start = opts.date;
        end = allDay ? opts.date : new Date(opts.date.getTime() + 3600000);
        locationInput.value = '';
        statusInput.value = 'active';
        descriptionInput.value = '';
        recur = null;
    }

    allDayInput.checked = allDay;
    setInputMode(allDay);
    startDateInput.value = toDateInputValue(start);
    startTimeInput.value = allDay ? '09:00' : toTimeInputValue(start);
    endDateInput.value = toDateInputValue(end);
    endTimeInput.value = allDay ? '10:00' : toTimeInputValue(end);
    populateRecurForm(recur);

    modalBackdrop.classList.add('open');
}

function closeModal() {
    modalBackdrop.classList.remove('open');
    editingEvent = null;
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

form.addEventListener('submit', function (e) {
    e.preventDefault();
    let allDay = allDayInput.checked;
    let start = allDay ? startDateInput.value : new Date(startDateInput.value + 'T' + startTimeInput.value);
    let end = fromFormEnd(allDay);
    let recur = readRecurFromForm();

    let data = {
        id: editingEvent ? editingEvent.id : nextEventId(),
        title: titleInput.value,
        allDay: allDay,
        extendedProps: {
            location: locationInput.value,
            status: statusInput.value,
            description: descriptionInput.value,
            recur: recur
        }
    };

    if (recur) {
        recur.dtstart = allDay ? startDateInput.value : (startDateInput.value + 'T' + startTimeInput.value);
        let rrule = { freq: recur.freq, interval: recur.interval, dtstart: recur.dtstart };
        if (recur.end === 'until' && recur.until) rrule.until = recur.until;
        if (recur.end === 'count' && recur.count) rrule.count = recur.count;
        data.rrule = rrule;
        // the plugin's own duration refiner mishandles a bare number for
        // recurring events (verified empirically - results in end == start,
        // invisible in timeGrid views); the {milliseconds: N} object form
        // works correctly, so wrap it rather than pass the number directly
        data.duration = { milliseconds: computeDurationMs(start, end, allDay) };
    } else {
        data.start = start;
        data.end = end;
    }

    if (editingEvent) editingEvent.remove();
    calendar.addEvent(data);
    closeModal();
});

deleteButton.addEventListener('click', function () {
    if (editingEvent) editingEvent.remove();
    closeModal();
});

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
    dateClick: function (info) {
        if (!isWritable) return;
        openModal('create', { date: info.date, allDay: info.allDay });
    },
    eventClick: function (info) {
        openModal('edit', { event: info.event });
    }
});
calendar.render();
