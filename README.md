# Best Todo — Pro

A fast, local-first Todo app built with React, Vite and Tailwind. Includes list, kanban, daily planner slots, recurrence, reminders (while tab open), tags, search, and a simple Pomodoro timer.

## Run locally

1. Install dependencies
2. Start the dev server

```powershell
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173).

## Notes

- Data is stored in localStorage under key `best_todo_app_v2`.
- Notifications fire only while the tab is open (uses a lightweight service worker).
- Use keyboard `/` to focus search and `N` to focus quick-add.
