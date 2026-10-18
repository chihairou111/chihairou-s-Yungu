# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner, a Grade 10 student at Hangzhou Yungu School (task.yungu.org account). Personal tool, not shared with classmates or offered publicly. Opened mainly in a laptop browser, typically to check what is due and where the next class is.

## Product Purpose

A faster, cleaner front end for the school's task.yungu.org (云谷课堂) data: assignments and the class timetable. Success means the owner checks this instead of the school site because it shows the same information quicker and with less friction.

## Positioning

Same data as task.yungu.org, read through its own API, but organized around what the owner needs right now: assignments sorted by urgency (overdue / nearly overdue / upcoming) and a plain weekly timetable, without the school site's clutter and slow loading.

## Operating Context

- Data source: task.yungu.org and login.yungu.org (CAS). A Python client that reproduces the site's requests lives in `../api/` (`yungu_task.py`, documented in `../api/NOTES.md`).
- Login with the student's Yungu ID and password; the session is kept in a cookie so the owner stays signed in between visits.
- Times are China time (UTC+8). Assignment titles and course names are often Chinese; the interface itself is English.
- Status in the school system: To submit / Submitted / Archived; school marks late work as "Delayed".

## Capabilities and Constraints

- Two areas: Assignments (default view) and Calendar.
- Assignments: each task is a card; to-do tasks separated by priority into Overdue, Nearly overdue, Upcoming; a separate view for already-submitted tasks.
- Calendar: one week view; each class shows only name, location (room) and time.
- Stack: Next.js 16 (App Router) + MUI 9 in this folder; English UI.
- First phase is interface only (mock data); wiring to the real API comes later.
- Undecided: exact "nearly overdue" threshold (working assumption 24 h); whether submitting files from this UI is ever in scope (the API supports it).

## Brand Commitments

None. No logo or name beyond "Yungu LMS" (folder name) so far.

## Evidence on Hand

Real data shapes from the live account are recorded in `../api/NOTES.md` (assignment fields, calendar event fields). No testimonials or external content; none should be invented.

## Product Principles

1. Urgency first: what is late or due soon is visible before anything else.
2. Faster than the school site: fewer clicks, no clutter, quick load.
3. Show only what is needed: class = name, room, time; card = course, title, due.
4. Faithful to the source: never contradict what task.yungu.org says about a task's status.
