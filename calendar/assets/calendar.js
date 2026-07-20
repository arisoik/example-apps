function mockDate(dayOffset, hour, minute) {
    let d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour || 0, minute || 0, 0, 0);
    return d;
}

let mockEvents = [
    {
        id: 'mock-1',
        title: 'Team sync',
        start: mockDate(1, 10, 0),
        end: mockDate(1, 11, 0),
        allDay: false,
        extendedProps: { location: 'Meeting room 2', description: 'Weekly planning call', status: 'active' }
    },
    {
        id: 'mock-2',
        title: 'Company retreat',
        start: mockDate(3),
        end: mockDate(6),
        allDay: true,
        extendedProps: { location: 'Lake house', description: '', status: 'active' }
    },
    {
        id: 'mock-3',
        title: 'Dentist',
        start: mockDate(-2, 9, 30),
        end: mockDate(-2, 10, 0),
        allDay: false,
        extendedProps: { location: '', description: '', status: 'cancelled' }
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
let statusInput = document.getElementById('event-status');
let descriptionInput = document.getElementById('event-description');
let deleteButton = document.getElementById('event-delete');
let saveButton = document.getElementById('event-save');
let cancelButton = document.getElementById('event-cancel');
let modalHeading = document.getElementById('event-modal-heading');
let editableFields = [titleInput, allDayInput, startDateInput, startTimeInput, endDateInput, endTimeInput, locationInput, statusInput, descriptionInput];

let editingEvent = null;

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

function setInputMode(allDay) {
    startTimeInput.style.display = allDay ? 'none' : '';
    endTimeInput.style.display = allDay ? 'none' : '';
    startTimeInput.required = !allDay;
    endTimeInput.required = !allDay;
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

    let start, end, allDay;
    if (mode === 'edit') {
        let ev = opts.event;
        titleInput.value = ev.title;
        allDay = ev.allDay;
        start = ev.start;
        end = toFormEnd(ev.end || ev.start, allDay);
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
    }

    allDayInput.checked = allDay;
    setInputMode(allDay);
    startDateInput.value = toDateInputValue(start);
    startTimeInput.value = allDay ? '09:00' : toTimeInputValue(start);
    endDateInput.value = toDateInputValue(end);
    endTimeInput.value = allDay ? '10:00' : toTimeInputValue(end);

    modalBackdrop.classList.add('open');
}

function closeModal() {
    modalBackdrop.classList.remove('open');
    editingEvent = null;
}

allDayInput.addEventListener('change', function () {
    setInputMode(allDayInput.checked);
});

cancelButton.addEventListener('click', closeModal);

modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) closeModal();
});

form.addEventListener('submit', function (e) {
    e.preventDefault();
    let allDay = allDayInput.checked;
    let start = allDay ? startDateInput.value : new Date(startDateInput.value + 'T' + startTimeInput.value);
    let end = fromFormEnd(allDay);

    if (editingEvent) {
        editingEvent.setProp('title', titleInput.value);
        editingEvent.setDates(start, end, { allDay: allDay });
        editingEvent.setExtendedProp('location', locationInput.value);
        editingEvent.setExtendedProp('status', statusInput.value);
        editingEvent.setExtendedProp('description', descriptionInput.value);
    } else {
        calendar.addEvent({
            title: titleInput.value,
            start: start,
            end: end,
            allDay: allDay,
            extendedProps: { location: locationInput.value, status: statusInput.value, description: descriptionInput.value }
        });
    }
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
