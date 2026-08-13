// ==UserScript==
// @name         Google Calendar - Drag & Drop ICS Import
// @namespace    https://github.com/samlroberts/userscripts
// @version      2.1
// @description  Drop an .ics file anywhere in Google Calendar to open it as a new event.
// @author       You
// @match        https://calendar.google.com/calendar/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/samlroberts/userscripts/main/Google%20Calendar%20-%20Drag%20%26%20Drop%20ICS%20Import.user.js
// @downloadURL  https://raw.githubusercontent.com/samlroberts/userscripts/main/Google%20Calendar%20-%20Drag%20%26%20Drop%20ICS%20Import.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function init() {
        // Prevent duplicate initialization if Google Calendar updates the DOM.
        if (document.getElementById('ics-drop-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'ics-drop-overlay';

        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            background-color: rgba(26, 115, 232, 0.4);
            z-index: 999999;
            display: none;
            justify-content: center;
            align-items: center;
            pointer-events: none;
        `;

        const overlayText = document.createElement('div');
        overlayText.innerText = 'Drop .ics file to create event';

        overlayText.style.cssText = `
            color: white;
            font-size: 24px;
            font-weight: bold;
            font-family: Roboto, sans-serif;
            background: #1a73e8;
            padding: 20px 40px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;

        overlay.appendChild(overlayText);
        document.body.appendChild(overlay);

        let dragCounter = 0;

        window.addEventListener(
            'dragenter',
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                dragCounter++;

                if (dragCounter === 1) {
                    overlay.style.display = 'flex';
                }
            },
            true
        );

        window.addEventListener(
            'dragover',
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
            },
            true
        );

        window.addEventListener(
            'dragleave',
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                dragCounter = Math.max(0, dragCounter - 1);

                if (dragCounter === 0) {
                    overlay.style.display = 'none';
                }
            },
            true
        );

        window.addEventListener(
            'drop',
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                dragCounter = 0;
                overlay.style.display = 'none';

                const files = e.dataTransfer?.files;

                if (!files || files.length === 0) return;

                const file = files[0];

                if (!file.name.toLowerCase().endsWith('.ics')) {
                    alert('Please drop a valid .ics file.');
                    return;
                }

                const reader = new FileReader();

                reader.onload = (event) => {
                    const text = event.target?.result;

                    if (typeof text !== 'string') {
                        alert('Unable to read ICS file.');
                        return;
                    }

                    parseAndRedirectICS(text);
                };

                reader.readAsText(file);
            },
            true
        );
    }

    /**
     * Parse the first VEVENT in an ICS file and open Google's
     * "Create Event" screen with the event information filled in.
     */
    function parseAndRedirectICS(icsText) {
        /*
         * ICS allows long lines to be "folded":
         *
         * DESCRIPTION:This is a really long
         *  description that continues here
         *
         * A continuation line begins with a space or tab.
         */
        const unfolded = icsText.replace(/\r?\n[ \t]/g, '');

        const lines = unfolded.split(/\r?\n/);

        const calendarEvent = {};

        let insideEvent = false;

        for (const rawLine of lines) {
            const line = rawLine.replace(/\r/g, '');

            if (line === 'BEGIN:VEVENT') {
                insideEvent = true;
                continue;
            }

            if (line === 'END:VEVENT') {
                break;
            }

            if (!insideEvent) continue;

            /*
             * ICS property format:
             *
             * SUMMARY:Meeting
             * DTSTART:20260813T140000Z
             * DTSTART;TZID=America/New_York:20260813T140000
             *
             * Split only on the FIRST colon because descriptions,
             * locations, URLs, etc. may themselves contain colons.
             */
            const colonIndex = line.indexOf(':');

            if (colonIndex === -1) continue;

            const propertyPart = line.slice(0, colonIndex);
            const rawValue = line.slice(colonIndex + 1);

            /*
             * DTSTART;TZID=America/New_York
             *
             * becomes:
             * name = DTSTART
             * parameters = ["TZID=America/New_York"]
             */
            const [propertyName, ...parameters] = propertyPart.split(';');

            const name = propertyName.toUpperCase();

            switch (name) {
                case 'SUMMARY':
                    calendarEvent.title = decodeICSValue(rawValue);
                    break;

                case 'DTSTART':
                    calendarEvent.start = cleanICSDate(rawValue);
                    calendarEvent.startTimezone =
                        getICSParameter(parameters, 'TZID');
                    break;

                case 'DTEND':
                    calendarEvent.end = cleanICSDate(rawValue);
                    calendarEvent.endTimezone =
                        getICSParameter(parameters, 'TZID');
                    break;

                case 'LOCATION':
                    calendarEvent.location = decodeICSValue(rawValue);
                    break;

                case 'DESCRIPTION':
                    calendarEvent.description = decodeICSValue(rawValue);
                    break;
            }
        }

        if (!calendarEvent.title || !calendarEvent.start) {
            console.error('Parsed ICS event:', calendarEvent);

            alert(
                'Failed to parse required event details (SUMMARY and DTSTART).'
            );

            return;
        }

        /*
         * DTEND technically isn't mandatory in ICS.
         *
         * If it's absent, use DTSTART as a fallback.
         * Google will still open the event editor where it can be adjusted.
         */
        if (!calendarEvent.end) {
            calendarEvent.end = calendarEvent.start;
        }

        /*
         * Google Calendar's event template URL:
         *
         * https://calendar.google.com/calendar/render
         *     ?action=TEMPLATE
         *     &text=...
         *     &dates=START/END
         *     &details=...
         *     &location=...
         */
        const params = new URLSearchParams({
            action: 'TEMPLATE',
            text: calendarEvent.title,
            dates: `${calendarEvent.start}/${calendarEvent.end}`,
        });

        if (calendarEvent.description) {
            params.set('details', calendarEvent.description);
        }

        if (calendarEvent.location) {
            params.set('location', calendarEvent.location);
        }

        /*
         * Google accepts a ctz parameter specifying the event timezone.
         *
         * Prefer DTSTART's timezone because that's the most meaningful
         * timezone for the event.
         */
        if (calendarEvent.startTimezone) {
            params.set('ctz', calendarEvent.startTimezone);
        }

        const googleCalendarURL =
            `https://calendar.google.com/calendar/render?${params.toString()}`;

        console.log('ICS event:', calendarEvent);
        console.log('Google Calendar URL:', googleCalendarURL);

        /*
         * Since this handler originates from the user's drop action,
         * browsers should generally allow the new tab.
         */
        window.open(googleCalendarURL, '_blank');
    }

    /**
     * Converts an ICS timestamp into the format Google Calendar expects.
     *
     * Examples:
     *
     * 20260813T143000Z
     *      -> 20260813T143000Z
     *
     * 2026-08-13T14:30:00Z
     *      -> 20260813T143000Z
     *
     * 20260813
     *      -> 20260813
     */
    function cleanICSDate(dateStr) {
        if (!dateStr) return '';

        return dateStr
            .trim()
            .replace(/-/g, '')
            .replace(/:/g, '');
    }

    /**
     * Decode standard ICS escaping.
     *
     * \n  -> newline
     * \,  -> comma
     * \;  -> semicolon
     * \\  -> backslash
     */
    function decodeICSValue(value) {
        return value
            .replace(/\\[nN]/g, '\n')
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\\\/g, '\\')
            .trim();
    }

    /**
     * Find an ICS property parameter.
     *
     * Example:
     *
     * ["TZID=America/New_York"]
     *
     * getICSParameter(..., "TZID")
     *      -> "America/New_York"
     */
    function getICSParameter(parameters, wantedName) {
        const prefix = `${wantedName.toUpperCase()}=`;

        const parameter = parameters.find((item) =>
            item.toUpperCase().startsWith(prefix)
        );

        if (!parameter) return null;

        return parameter.slice(parameter.indexOf('=') + 1);
    }

    init();
})();