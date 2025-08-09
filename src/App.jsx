import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListTodo,
  LayoutGrid,
  KanbanSquare,
  Sun,
  TimerReset,
  CheckCircle2,
  Calendar as CalendarIcon,
  Flag,
  Search,
  Bell,
  BellRing,
  X,
  Pencil,
  Trash2,
  Save,
  Sunrise,
  Sunset,
  Moon,
} from "lucide-react";
import QRCode from "qrcode";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import {
  saveSnapshot,
  listSnapshots,
  requestPersistentStorage,
  restoreLatest,
} from "@/lib/history";

const STORAGE_KEY = "best_todo_app_v2";

// ---------- Utils ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};
const addMonths = (d, n) => {
  const dt = new Date(d);
  dt.setMonth(dt.getMonth() + n);
  return dt.toISOString().slice(0, 10);
};
const addWeeks = (d, n) => addDays(d, n * 7);
const isSameDay = (a, b) => a === b;
const isBefore = (a, b) => new Date(a) < new Date(b);
const isAfter = (a, b) => new Date(a) > new Date(b);
const daysDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const uuid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Light haptic feedback on supported devices
function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

/**
 * Parse quick-capture syntax:
 *  - #tag adds tag
 *  - !p1|!p2|!p3|!p4 or !low/medium/high/urgent sets priority
 *  - ^YYYY-MM-DD sets due date
 *  - words: today / tomorrow / nextweek set due date
 */
function parseQuick(text) {
  const out = {
    title: text,
    tags: [],
    due: null,
    priority: /** @type {Priority} */ ("medium"),
  };
  const tokens = text.trim().split(" ").filter(Boolean);
  const rest = [];
  for (const t of tokens) {
    if (t.startsWith("#") && t.length > 1) {
      out.tags.push(t.slice(1).toLowerCase());
      continue;
    }
    if (t.startsWith("!")) {
      const v = t.slice(1).toLowerCase();
      const map = {
        p1: "low",
        p2: "medium",
        p3: "high",
        p4: "urgent",
        low: "low",
        medium: "medium",
        high: "high",
        urgent: "urgent",
      };
      if (map[v]) out.priority = /** @type {Priority} */ (map[v]);
      else rest.push(t);
      continue;
    }
    if (t.startsWith("^")) {
      const v = t.slice(1);
      const valid = v.length === 10 && !Number.isNaN(new Date(v).getTime());
      if (valid) out.due = v;
      else rest.push(t);
      continue;
    }
    const word = t.toLowerCase();
    if (word === "today") {
      out.due = todayISO();
      continue;
    }
    if (word === "tomorrow") {
      out.due = addDays(todayISO(), 1);
      continue;
    }
    if (word === "nextweek" || word === "next-week") {
      out.due = addDays(todayISO(), 7);
      continue;
    }
    rest.push(t);
  }
  out.title = rest.join(" ").trim() || text;
  return out;
}

function priorityTone(p /** @type {Priority} */) {
  return {
    low: "bg-emerald-100 text-emerald-700 border-emerald-200",
    medium: "bg-sky-100 text-sky-700 border-sky-200",
    high: "bg-amber-100 text-amber-700 border-amber-200",
    urgent: "bg-rose-100 text-rose-700 border-rose-200",
  }[p];
}

function dueBadge(due) {
  if (!due)
    return (
      <Badge variant="outline" className="rounded-full">
        No due
      </Badge>
    );
  const t = todayISO();
  if (isSameDay(due, t))
    return (
      <Badge variant="outline" className="rounded-full">
        Today
      </Badge>
    );
  if (isBefore(due, t))
    return (
      <Badge variant="outline" className="rounded-full">
        Overdue {Math.abs(daysDiff(due, t))}d
      </Badge>
    );
  const delta = daysDiff(due, t);
  return (
    <Badge className="rounded-full" variant="outline">
      in {delta}d
    </Badge>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 text-xl font-semibold">
      <Icon className="h-5 w-5" />
      <span>{children}</span>
    </div>
  );
}

// ---------- Notifications (SW registration) ----------
let swReady = null;
async function ensureSW() {
  if (!("serviceWorker" in navigator)) return null;
  if (swReady) return swReady;
  // vite-plugin-pwa registers at runtime; ensure ready when available
  if (navigator.serviceWorker.controller) {
    swReady = await navigator.serviceWorker.ready;
    return swReady;
  }
  // Fallback registration if not auto-registered (dev mode)
  const reg = await navigator.serviceWorker.register("/sw.js");
  swReady = reg;
  return reg;
}
async function notifyViaSW(title, options) {
  try {
    const reg = await ensureSW();
    if (reg?.active) reg.active.postMessage({ title, options });
    else if ("Notification" in window && Notification.permission === "granted")
      new Notification(title, options);
  } catch (e) {
    console.warn("notify error", e);
  }
}

// ---------- Main App ----------
export default function BestTodoApp() {
  /** @type {[Task[], any]} */
  const [tasks, setTasks] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("today"); // today | upcoming | overdue | all | completed
  const [showDone, setShowDone] = useState(false);
  const [tagFilter, setTagFilter] = useState(/** @type {string|null} */ (null));
  const [quick, setQuick] = useState("");
  const [view, setView] = useState(
    /** @type {"list"|"kanban"|"planner"|"pomodoro"} */ ("list")
  );
  const [notifReady, setNotifReady] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  const inputRef = useRef(null);
  const timersRef = useRef(/** @type {Record<string,number>} */ ({}));
  const [toast, setToast] = useState(
    /** @type {null | { id:number, msg:string, actionLabel?:string, onAction?:() => void }} */ (
      null
    )
  );
  const toastTimer = useRef(/** @type {number|undefined} */ (undefined));

  useEffect(() => {
    const id = setTimeout(() => {
      const serialized = JSON.stringify(tasks);
      localStorage.setItem(STORAGE_KEY, serialized);
      saveSnapshot({ tasks });
  // live sync removed
    }, 200);
    return () => clearTimeout(id);
  }, [tasks]);

  function showToast(msg, actionLabel, onAction) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), msg, actionLabel, onAction });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  async function undoLastChange() {
    try {
      const snaps = await listSnapshots(5);
      const cur = JSON.stringify(tasks);
      const candidate = snaps.find(
        (s) => JSON.stringify(s?.payload?.tasks || []) !== cur
      )?.payload;
      const prev = candidate ?? snaps?.[1]?.payload;
      if (prev?.tasks && Array.isArray(prev.tasks)) {
        setTasks(prev.tasks);
        haptic();
      }
    } catch {}
  }

  // Theme handling: system + toggle
  useEffect(() => {
    const root = document.documentElement;
    const apply = (mode) => {
      const isDark =
        mode === "dark" ||
        (mode === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", isDark);
      // keep browser UI bars in sync
      try {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", isDark ? "#020617" : "#ffffff");
      } catch {}
    };
    apply(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(theme);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  useEffect(() => {
    // Improve data durability on mobile
    requestPersistentStorage();
  // live sync removed
    try {
      const hasLocal = !!localStorage.getItem(STORAGE_KEY);
      if (!hasLocal) {
        restoreLatest().then((snap) => {
          if (snap?.tasks && Array.isArray(snap.tasks)) {
            setTasks(snap.tasks);
          }
        });
  // live sync removed
      }
    } catch {}

    const handler = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        e.target?.isContentEditable;
      if (isTyping) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Ask notification permission lazily
  async function enableNotifications() {
    try {
      await ensureSW();
      if (!("Notification" in window))
        return alert("Notifications not supported in this browser.");
      const p = await Notification.requestPermission();
      setNotifReady(p === "granted");
      if (p === "granted")
        notifyViaSW("Notifications enabled", {
          body: "I'll remind you when it's time (while the app is open).",
        });
    } catch (e) {
      alert("Failed to enable: " + e.message);
    }
  }

  // Schedule one-shot timeouts for reminders (works while tab is open)
  useEffect(() => {
    for (const id in timersRef.current) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    const now = Date.now();
    tasks.forEach((t) => {
      if (!t.remindAt || t.notified) return;
      const ts = new Date(t.remindAt).getTime();
      if (Number.isNaN(ts) || ts <= now) return;
      const tid = window.setTimeout(() => {
        notifyViaSW("Reminder: " + t.title, {
          body: t.due ? `Due ${t.due}` : undefined,
          tag: t.id,
        });
        setTasks((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, notified: true } : x))
        );
      }, ts - now);
      timersRef.current[t.id] = tid;
    });
    return () => {
      for (const id in timersRef.current) clearTimeout(timersRef.current[id]);
    };
  }, [tasks]);

  const tags = useMemo(() => {
    const set = new Set();
    for (const t of tasks) t.tags.forEach((tg) => set.add(tg));
    return Array.from(set).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    const t = todayISO();
    return tasks
      .filter((tk) => (showDone ? true : tk.status !== "done"))
      .filter((tk) => (tagFilter ? tk.tags.includes(tagFilter) : true))
      .filter((tk) =>
        query
          ? (tk.title + " " + tk.notes + " " + tk.tags.join(" "))
              .toLowerCase()
              .includes(query.toLowerCase())
          : true
      )
      .filter((tk) => {
        if (filter === "all") return true;
        if (filter === "completed") return tk.status === "done";
        if (filter === "overdue")
          return tk.status !== "done" && tk.due && isBefore(tk.due, t);
        if (filter === "upcoming")
          return (
            tk.status !== "done" &&
            tk.due &&
            (isAfter(tk.due, t) || isSameDay(tk.due, addDays(t, 1)))
          );
        if (filter === "today")
          return (
            tk.status !== "done" &&
            ((tk.due && isSameDay(tk.due, t)) || !tk.due)
          );
        return true;
      })
      .sort((a, b) => {
        const order = { urgent: 3, high: 2, medium: 1, low: 0 };
        const doneA = a.status === "done" ? 1 : 0;
        const doneB = b.status === "done" ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        if (a.due && b.due && a.due !== b.due)
          return new Date(a.due).getTime() - new Date(b.due).getTime();
        if (!!a.due !== !!b.due) return a.due ? -1 : 1;
        if (order[b.priority] !== order[a.priority])
          return order[b.priority] - order[a.priority];
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [tasks, query, filter, showDone, tagFilter]);

  const stats = useMemo(() => {
    const t = todayISO();
    const total = tasks.length;
    const done = tasks.filter((x) => x.status === "done").length;
    const overdue = tasks.filter(
      (x) => x.status !== "done" && x.due && isBefore(x.due, t)
    ).length;
    const dueToday = tasks.filter(
      (x) => x.status !== "done" && (x.due ? isSameDay(x.due, t) : true)
    ).length;
    const rate = total ? Math.round((done / total) * 100) : 0;
    return { total, done, overdue, dueToday, rate };
  }, [tasks]);

  function addTaskFromQuick() {
    const raw = quick.trim();
    if (!raw) return;
    const parsed = parseQuick(raw);
    const now = new Date().toISOString();
    /** @type {Task} */
    const task = {
      id: uuid(),
      title: parsed.title,
      notes: "",
      due: parsed.due,
      priority: parsed.priority,
      status: "todo",
      tags: parsed.tags,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      subtasks: [],
      recurrence: { freq: "none", interval: 1 },
      remindAt: null,
      notified: false,
      energy: "medium",
      durationMin: 25,
      slot: "any",
    };
    setTasks((prev) => [task, ...prev]);
    setQuick("");
  }

  function toggleDone(id) {
    // snapshot current state for undo
    saveSnapshot({ tasks });
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const becomingDone = t.status !== "done";
        const patch = {
          status: becomingDone ? "done" : "todo",
          completedAt: becomingDone ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        };
        if (
          becomingDone &&
          t.recurrence?.freq &&
          t.recurrence.freq !== "none" &&
          t.due
        ) {
          const next = nextDueDate(t.due, t.recurrence);
          const copy = {
            ...t,
            id: uuid(),
            status: "todo",
            completedAt: null,
            due: next,
            notified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setTasks((pv) => [copy, ...pv]);
        }
        return { ...t, ...patch };
      })
    );
    showToast("Marked done", "Undo", undoLastChange);
  }

  function nextDueDate(due, rec /** @type {Recurrence} */) {
    const inter = rec.interval || 1;
    if (rec.freq === "daily") return addDays(due, inter);
    if (rec.freq === "weekly") {
      if (rec.byWeekday && rec.byWeekday.length) {
        const start = new Date(due);
        for (let i = 1; i <= 14; i++) {
          const dt = new Date(start);
          dt.setDate(start.getDate() + i);
          if (rec.byWeekday.includes(dt.getDay()))
            return dt.toISOString().slice(0, 10);
        }
      }
      return addWeeks(due, inter);
    }
    if (rec.freq === "monthly") return addMonths(due, inter);
    return due;
  }

  function removeTask(id) {
    // snapshot current state for undo
    saveSnapshot({ tasks });
    setTasks((prev) => prev.filter((t) => t.id !== id));
    showToast("Task deleted", "Undo", undoLastChange);
  }
  function updateTask(id, patch) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, ...patch, updatedAt: new Date().toISOString() }
          : t
      )
    );
  }
  function clearCompleted() {
    setTasks((prev) => prev.filter((t) => t.status !== "done"));
  }

  // Drag & Drop handlers (HTML5 API)
  const dragItem = useRef(/** @type {Task|null} */ (null));
  function onDragStart(task) {
    dragItem.current = task;
  }
  function onDropStatus(status /** @type {Status} */) {
    if (dragItem.current) {
      updateTask(dragItem.current.id, { status });
      dragItem.current = null;
    }
  }
  function onDropSlot(slot /** @type {Slot} */) {
    if (dragItem.current) {
      updateTask(dragItem.current.id, { slot });
      dragItem.current = null;
    }
  }

  return (
    <div className="min-h-screen w-full bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-24 md:pb-8">
        {/* Header */}
        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200 bg-white/80 px-4 pt-safe backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-800 dark:bg-slate-900/80 supports-[backdrop-filter]:dark:bg-slate-900/60 md:static md:mb-0 md:border-none md:bg-transparent md:backdrop-blur-none">
          <div className="mx-auto max-w-5xl py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <ListTodo className="h-5 w-5 text-slate-900 dark:text-slate-100 md:h-6 md:w-6" />
                <h1 className="text-lg font-semibold tracking-tight md:text-xl">
                  FIVE
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="search-input"
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-8"
                    aria-label="Search"
                  />
                </div>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-28 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  aria-label="Theme"
                  title="Theme"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-32 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  aria-label="Filter"
                >
                  <option value="today">Today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="overdue">Overdue</option>
                  <option value="all">All</option>
                  <option value="completed">Completed</option>
                </select>
                <Button
                  variant="secondary"
                  onClick={() => setShowDone((s) => !s)}
                  title="Toggle completed visibility"
                  className="h-10"
                >
                  {showDone ? "Hide done" : "Show done"}
                </Button>
                <QRSyncControl getTasks={() => tasks} setTasks={setTasks} />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (window.__showInstallPrompt) {
                      await window.__showInstallPrompt();
                      if (
                        "Notification" in window &&
                        Notification.permission !== "granted"
                      ) {
                        await Notification.requestPermission();
                      }
                    } else {
                      alert("Install prompt not available in this browser.");
                    }
                  }}
                  className="h-10"
                >
                  Install
                </Button>
                <div className="ml-1 hidden rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900 md:inline-flex">
                  <Tab
                    onClick={() => setView("list")}
                    active={view === "list"}
                    icon={LayoutGrid}
                    label="List"
                  />
                  <Tab
                    onClick={() => setView("kanban")}
                    active={view === "kanban"}
                    icon={KanbanSquare}
                    label="Kanban"
                  />
                  <Tab
                    onClick={() => setView("planner")}
                    active={view === "planner"}
                    icon={Sun}
                    label="Plan"
                  />
                  <Tab
                    onClick={() => setView("pomodoro")}
                    active={view === "pomodoro"}
                    icon={TimerReset}
                    label="Timer"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats - minimal */}
        <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatCard
            label="Done"
            value={`${stats.done}`}
            sub={`/${stats.total}`}
            icon={CheckCircle2}
          />
          <StatCard
            label="Today"
            value={`${stats.dueToday}`}
            icon={CalendarIcon}
          />
          <StatCard label="Overdue" value={`${stats.overdue}`} icon={Flag} />
          <StatCard label="Rate" value={`${stats.rate}%`} icon={ListTodo} />
        </div>

        {/* Quick add */}
        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            ref={inputRef}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTaskFromQuick()}
            placeholder="Add a task… (^date, #tags, !p1-!p4)"
            aria-label="Quick add"
          />
          <div className="flex gap-2">
            <Button onClick={addTaskFromQuick} className="h-10">
              Add
            </Button>
            <Button
              variant={notifReady ? "default" : "secondary"}
              onClick={enableNotifications}
              className="h-10"
            >
              {notifReady ? "Notifications On" : "Enable notifications"}
            </Button>
          </div>
        </div>

        {/* Tag bar - minimal */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge
            onClick={() => setTagFilter(null)}
            variant={!tagFilter ? "default" : "secondary"}
            className="cursor-pointer"
          >
            All
          </Badge>
          {tags.map((t) => (
            <Badge
              key={t}
              onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
              variant={tagFilter === t ? "default" : "secondary"}
              className="cursor-pointer"
            >
              #{t}
            </Badge>
          ))}
        </div>

        {/* Views */}
        {view === "list" && (
          <ListView
            items={filtered}
            onToggle={toggleDone}
            onRemove={removeTask}
            onUpdate={updateTask}
          />
        )}
        {view === "kanban" && (
          <KanbanView
            items={filtered}
            onDragStart={onDragStart}
            onDropStatus={onDropStatus}
            onToggle={toggleDone}
            onRemove={removeTask}
            onUpdate={updateTask}
          />
        )}
        {view === "planner" && (
          <PlannerView
            items={filtered}
            onDragStart={onDragStart}
            onDropSlot={onDropSlot}
            onToggle={toggleDone}
            onRemove={removeTask}
            onUpdate={updateTask}
          />
        )}
        {view === "pomodoro" && (
          <PomodoroView
            tasks={tasks}
            onFinish={() =>
              notifyViaSW("Pomodoro complete", {
                body: "Great job. Take a short break.",
              })
            }
          />
        )}

        {/* Footer actions (desktop) */}
        <div className="mt-8 hidden items-center justify-between md:flex">
          <div className="text-xs text-slate-500">Local-first • PWA-ready</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearCompleted}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear completed
            </Button>
            <ExportImport tasks={tasks} setTasks={setTasks} />
          </div>
        </div>

        {/* Bottom nav (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:hidden pb-safe">
          <div className="mx-auto flex max-w-5xl items-center justify-around px-4 py-2">
            <button
              className={`flex flex-col items-center gap-1 text-xs ${
                view === "list"
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              onClick={() => setView("list")}
            >
              <LayoutGrid className="h-5 w-5" /> List
            </button>
            <button
              className={`flex flex-col items-center gap-1 text-xs ${
                view === "kanban"
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              onClick={() => setView("kanban")}
            >
              <KanbanSquare className="h-5 w-5" /> Kanban
            </button>
            <button
              className={`flex flex-col items-center gap-1 text-xs ${
                showDone
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              title={showDone ? "Hide completed" : "Show completed"}
              onClick={() => setShowDone((s) => !s)}
            >
              <CheckCircle2 className="h-5 w-5" /> {showDone ? "Hide" : "Show"}
            </button>
            <button
              className={`flex flex-col items-center gap-1 text-xs ${
                view === "planner"
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              onClick={() => setView("planner")}
            >
              <Sun className="h-5 w-5" /> Plan
            </button>
            <button
              className={`flex flex-col items-center gap-1 text-xs ${
                view === "pomodoro"
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
              onClick={() => setView("pomodoro")}
            >
              <TimerReset className="h-5 w-5" /> Timer
            </button>
          </div>
        </nav>

        {/* Toast */}
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 md:bottom-4">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto max-w-[92vw] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-3">
                  <span>{toast.msg}</span>
                  {toast.onAction && (
                    <button
                      className="ml-2 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => {
                        toast.onAction?.();
                        setToast(null);
                      }}
                    >
                      {toast.actionLabel || "Undo"}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Tab({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ${
        active
          ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
          : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

// Live sync UI removed

function QRSyncControl({ getTasks, setTasks }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("send"); // send | receive
  const [dataUrl, setDataUrl] = useState("");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanTimer = useRef(null);

  async function genQR() {
    try {
      const payload = { v: 2, tasks: getTasks() };
      const text = compressToEncodedURIComponent(JSON.stringify(payload));
      const url = await QRCode.toDataURL(`tasks:${text}`, { margin: 1, scale: 6 });
      setDataUrl(url);
    } catch (e) {
      alert("Failed to generate QR: " + e.message);
    }
  }

  async function decodeFromImage(imgEl) {
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(imgEl, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = window.jsQR?.(img.data, img.width, img.height);
      if (code?.data?.startsWith("tasks:")) {
        const raw = code.data.slice(6);
        const json = JSON.parse(decompressFromEncodedURIComponent(raw));
        if (json?.tasks && Array.isArray(json.tasks)) {
          setTasks(json.tasks);
          setOpen(false);
          return true;
        }
      }
    } catch (e) {
      alert("Failed to decode QR: " + e.message);
    }
    return false;
  }

  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = async () => {
      await decodeFromImage(img);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      alert("Invalid image file");
    };
    img.src = URL.createObjectURL(f);
  }

  useEffect(() => {
    if (!open) return;
    if (mode === "send") {
      genQR();
      return;
    }
    // receive: start camera
    (async () => {
      try {
        const stream = await navigator.mediaDevices?.getUserMedia?.({ video: { facingMode: "environment" } });
        if (!stream) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const loop = async () => {
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR?.(img.data, img.width, img.height);
            if (code?.data?.startsWith("tasks:")) {
              const raw = code.data.slice(6);
              try {
                const json = JSON.parse(decompressFromEncodedURIComponent(raw));
                if (json?.tasks && Array.isArray(json.tasks)) {
                  setTasks(json.tasks);
                  setOpen(false);
                  // stop camera
                  stream.getTracks().forEach((t) => t.stop());
                  return;
                }
              } catch {}
            }
          }
          scanTimer.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        alert("Camera error: " + e.message);
      }
    })();
    return () => {
      if (scanTimer.current) cancelAnimationFrame(scanTimer.current);
      const v = videoRef.current;
      const s = v?.srcObject;
      if (s?.getTracks) s.getTracks().forEach((t) => t.stop());
    };
  }, [open, mode]);

  return (
    <>
      <Button variant="secondary" className="h-10" onClick={() => setOpen(true)}>
        QR Sync
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>QR Sync</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button variant={mode === "send" ? "default" : "secondary"} onClick={() => setMode("send")}>Send</Button>
              <Button variant={mode === "receive" ? "default" : "secondary"} onClick={() => setMode("receive")}>Receive</Button>
            </div>
            {mode === "send" ? (
              <div className="flex flex-col items-center gap-2">
                {dataUrl ? (
                  <img src={dataUrl} alt="tasks qr" className="h-56 w-56 rounded-lg border border-slate-200 dark:border-slate-700" />
                ) : (
                  <div className="h-56 w-56 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
                )}
                <div className="text-xs text-slate-500 dark:text-slate-400">สแกนจากเครื่องปลายทางเพื่อรับข้อมูล</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <video ref={videoRef} className="h-56 w-56 rounded-lg object-cover" playsInline muted />
                <canvas ref={canvasRef} className="hidden" />
                <label className="text-xs text-slate-500 dark:text-slate-400">
                  สแกน QR จากเครื่องต้นทางเพื่อรับข้อมูล หรืออัพโหลดรูป QR
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
                  <input type="file" accept="image/*" onChange={onFileChange} className="hidden" />
                  เลือกรูป QR
                </label>
              </div>
            )}
          </div>
          <DialogFooter className="sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ListView({ items, onToggle, onRemove, onUpdate }) {
  return (
    <div className="mt-4 space-y-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(e, info) => {
              const x = info.offset.x;
              const threshold = 80; // px
              if (x > threshold) {
                haptic();
                onToggle(t.id);
              } else if (x < -threshold) {
                haptic();
                onRemove(t.id);
              }
            }}
          >
            <TaskRow
              task={t}
              onToggle={() => onToggle(t.id)}
              onRemove={() => onRemove(t.id)}
              onUpdate={(patch) => onUpdate(t.id, patch)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {items.length === 0 && (
        <div className="py-10 text-center text-slate-500 dark:text-slate-400">
          No tasks match your filters. Add something above.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          <span>{label}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold">
          {value}{" "}
          {sub ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {sub}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function KanbanView({
  items,
  onDragStart,
  onDropStatus,
  onToggle,
  onRemove,
  onUpdate,
}) {
  const cols = /** @type {Array<{key:Status,label:string}>} */ ([
    { key: "todo", label: "To-do" },
    { key: "doing", label: "Doing" },
    { key: "done", label: "Done" },
  ]);
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      {cols.map((c) => (
        <div
          key={c.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDropStatus(c.key)}
          className="min-h-[320px] rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {c.label}
            </div>
          </div>
          <div className="space-y-2">
            {items
              .filter((t) => t.status === c.key)
              .map((t) => (
                <div key={t.id} draggable onDragStart={() => onDragStart(t)}>
                  <TaskCard
                    task={t}
                    onToggle={() => onToggle(t.id)}
                    onRemove={() => onRemove(t.id)}
                    onUpdate={(patch) => onUpdate(t.id, patch)}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlannerView({
  items,
  onDragStart,
  onDropSlot,
  onToggle,
  onRemove,
  onUpdate,
}) {
  const cols = /** @type {Array<{key:Slot,label:string,icon:any}>} */ ([
    { key: "morning", label: "Morning", icon: Sunrise },
    { key: "afternoon", label: "Afternoon", icon: Sun },
    { key: "evening", label: "Evening", icon: Sunset },
    { key: "any", label: "Anytime", icon: Moon },
  ]);
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
      {cols.map((c) => (
        <div
          key={c.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDropSlot(c.key)}
          className="min-h-[320px] rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
        >
          {(() => {
            const Icon = c.icon;
            return (
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                <Icon className="h-4 w-4" /> {c.label}
              </div>
            );
          })()}
          <div className="space-y-2">
            {items
              .filter((t) => t.slot === c.key)
              .map((t) => (
                <div key={t.id} draggable onDragStart={() => onDragStart(t)}>
                  <TaskCard
                    task={t}
                    onToggle={() => onToggle(t.id)}
                    onRemove={() => onRemove(t.id)}
                    onUpdate={(patch) => onUpdate(t.id, patch)}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskCard({ task, onToggle, onRemove, onUpdate }) {
  return (
    <Card className="rounded-xl border-slate-200">
      <CardContent className="flex items-start gap-3 p-4">
        <Checkbox
          checked={task.status === "done"}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onUpdate({ _open: true })}
              className={`text-left font-medium leading-tight hover:underline ${
                task.status === "done" ? "text-slate-400 line-through" : ""
              }`}
            >
              {task.title}
            </button>
            <Badge variant="outline" className="rounded-full">
              <Flag className="mr-1 h-3 w-3" /> {task.priority}
            </Badge>
            {dueBadge(task.due)}
            {task.remindAt && (
              <Badge variant="outline" className="rounded-full">
                <BellRing className="mr-1 h-3 w-3" /> reminder
              </Badge>
            )}
            {task.tags.map((tg) => (
              <Badge key={tg} variant="outline" className="rounded-full">
                #{tg}
              </Badge>
            ))}
          </div>
          {task.notes && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {task.notes}
            </p>
          )}
          {task.subtasks?.length > 0 && (
            <div className="mt-2 space-y-1">
              {task.subtasks.map((s, idx) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={s.done}
                    onChange={(e) =>
                      onUpdate({
                        subtasks: task.subtasks.map((x, i) =>
                          i === idx ? { ...x, done: e.target.checked } : x
                        ),
                      })
                    }
                  />{" "}
                  {s.title}
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Updated {new Date(task.updatedAt).toLocaleString()} • Energy{" "}
            {task.energy} • {task.durationMin}m
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onUpdate({ _open: true })}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
      <TaskDialog task={task} onUpdate={onUpdate} />
    </Card>
  );
}

function TaskRow(props) {
  return <TaskCard {...props} />;
}

function TaskDialog({ task, onUpdate }) {
  const open = Boolean(task._open);
  const setOpen = (v) => onUpdate({ _open: v ? true : undefined });

  function addSubtask() {
    const title = prompt("Subtask title");
    if (!title) return;
    const list = [...(task.subtasks || []), { id: uuid(), title, done: false }];
    onUpdate({ subtasks: list });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Title
              </label>
              <Input
                value={task.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Notes
              </label>
              <Textarea
                value={task.notes}
                onChange={(e) => onUpdate({ notes: e.target.value })}
                rows={4}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Subtasks
                </span>
                <Button size="sm" variant="secondary" onClick={addSubtask}>
                  Add subtask
                </Button>
              </div>
              {task.subtasks?.length ? (
                <div className="space-y-2">
                  {task.subtasks.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={s.done}
                        onCheckedChange={(v) =>
                          onUpdate({
                            subtasks: task.subtasks.map((x, idx) =>
                              idx === i ? { ...x, done: !!v } : x
                            ),
                          })
                        }
                      />
                      <Input
                        value={s.title}
                        onChange={(e) =>
                          onUpdate({
                            subtasks: task.subtasks.map((x, idx) =>
                              idx === i ? { ...x, title: e.target.value } : x
                            ),
                          })
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          onUpdate({
                            subtasks: task.subtasks.filter(
                              (_, idx) => idx !== i
                            ),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No subtasks yet.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Due
              </label>
              <Input
                type="date"
                value={task.due ?? ""}
                onChange={(e) => onUpdate({ due: e.target.value || null })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Reminder
              </label>
              <Input
                type="datetime-local"
                value={task.remindAt ?? ""}
                onChange={(e) =>
                  onUpdate({
                    remindAt: e.target.value || null,
                    notified: false,
                  })
                }
              />
              <Button
                className="mt-2 w-full"
                variant="secondary"
                onClick={() =>
                  notifyViaSW("Test notification", { body: "It works!" })
                }
              >
                <Bell className="mr-2 h-4 w-4" /> Test
              </Button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Priority
              </label>
              <select
                value={task.priority}
                onChange={(e) => onUpdate({ priority: e.target.value })}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Energy
              </label>
              <select
                value={task.energy}
                onChange={(e) => onUpdate({ energy: e.target.value })}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Duration (min)
              </label>
              <Input
                type="number"
                min={5}
                step={5}
                value={task.durationMin}
                onChange={(e) =>
                  onUpdate({ durationMin: Number(e.target.value || 0) })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Slot
              </label>
              <select
                value={task.slot}
                onChange={(e) => onUpdate({ slot: e.target.value })}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="any">Anytime</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>
            <RecurrenceEditor
              value={task.recurrence}
              onChange={(rec) => onUpdate({ recurrence: rec })}
            />
            <TagEditor
              tags={task.tags}
              onChange={(tags) => onUpdate({ tags })}
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            <X className="mr-2 h-4 w-4" /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecurrenceEditor({ value, onChange }) {
  const rec = value || { freq: "none", interval: 1 };
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
        Recurring
      </label>
      <select
        value={rec.freq}
        onChange={(e) => onChange({ ...rec, freq: e.target.value })}
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="none">None</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      {rec.freq !== "none" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
              Every
            </label>
            <Input
              type="number"
              min={1}
              value={rec.interval || 1}
              onChange={(e) =>
                onChange({ ...rec, interval: Number(e.target.value || 1) })
              }
            />
          </div>
          {rec.freq === "weekly" && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Weekdays
              </label>
              <WeekdayPicker
                value={rec.byWeekday || []}
                onChange={(v) => onChange({ ...rec, byWeekday: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeekdayPicker({ value, onChange }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="flex flex-wrap gap-1">
      {days.map((d, i) => (
        <button
          key={i}
          onClick={() => {
            const set = new Set(value);
            set.has(i) ? set.delete(i) : set.add(i);
            onChange(Array.from(set).sort());
          }}
          className={`rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 ${
            value.includes(i)
              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
              : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60"
          }`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function TagEditor({ tags, onChange }) {
  const [val, setVal] = useState("");
  function addTag() {
    const t = val.trim().toLowerCase();
    if (!t) return;
    if (!tags.includes(t)) onChange([...tags, t]);
    setVal("");
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">
        Tags
      </label>
      <div className="flex items-center gap-2">
        <Input
          placeholder="#tag"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
        />
        <Button type="button" variant="secondary" onClick={addTag}>
          Add
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.map((tg) => (
          <Badge key={tg} variant="outline" className="rounded-full">
            #{tg}
            <button
              className="ml-1 rounded-full p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => onChange(tags.filter((x) => x !== tg))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ExportImport({ tasks, setTasks }) {
  function doExport() {
    const blob = new Blob([JSON.stringify({ v: 2, tasks }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `best-todo-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data?.tasks && Array.isArray(data.tasks)) {
          setTasks(data.tasks);
        } else {
          alert("Invalid file format");
        }
      } catch (err) {
        alert("Failed to import: " + err.message);
      }
    };
    reader.readAsText(f);
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={doExport}>
        <Save className="mr-2 h-4 w-4" /> Export
      </Button>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
        <input
          type="file"
          accept="application/json"
          onChange={onFile}
          className="hidden"
        />
        Import
      </label>
    </div>
  );
}

// ---------- Pomodoro ----------
function PomodoroView({ tasks, onFinish }) {
  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [longBreakMin, setLongBreakMin] = useState(15);
  const [round, setRound] = useState(0);
  const [running, setRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [remain, setRemain] = useState(25 * 60);
  const [boundTask, setBoundTask] = useState(/** @type {string|null} */ (null));
  const tickRef = useRef(/** @type {number|null} */ (null));

  useEffect(() => {
    setRemain((isBreak ? breakMin : focusMin) * 60);
  }, [focusMin, breakMin, isBreak]);
  useEffect(() => {
    if (!running) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => setRemain((r) => r - 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [running]);
  useEffect(() => {
    if (remain > 0) return;
    setRunning(false);
    if (!isBreak) setRound((r) => r + 1);
    onFinish?.();
    const nextIsBreak = !isBreak;
    const nextLen = nextIsBreak
      ? (round + 1) % 4 === 0
        ? longBreakMin
        : breakMin
      : focusMin;
    setIsBreak(nextIsBreak);
    setRemain(nextLen * 60);
  }, [remain]);

  const mmss = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(
      Math.floor(s % 60)
    ).padStart(2, "0")}`;

  return (
    <div className="mt-6">
      <Card className="mx-auto max-w-2xl rounded-xl p-6 text-center">
        <div className="text-sm tracking-wide text-slate-600">
          {isBreak ? "Break" : "Focus"}
        </div>
        <div className="mt-2 text-6xl font-semibold tabular-nums">
          {mmss(remain)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setRunning((v) => !v)}>
            {running ? "Pause" : "Start"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setRunning(false);
              setIsBreak(false);
              setRemain(focusMin * 60);
              setRound(0);
            }}
          >
            <TimerReset className="mr-2 h-4 w-4" /> Reset
          </Button>
          <select
            value={boundTask ?? ""}
            onChange={(e) => setBoundTask(e.target.value)}
            className="h-9 w-64 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">— None —</option>
            {tasks
              .filter((t) => t.status !== "done")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <NumberSetting
            label="Focus (min)"
            value={focusMin}
            setValue={setFocusMin}
          />
          <NumberSetting
            label="Break (min)"
            value={breakMin}
            setValue={setBreakMin}
          />
          <NumberSetting
            label="Long break (min)"
            value={longBreakMin}
            setValue={setLongBreakMin}
          />
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Every 4th break becomes a long break.
        </div>
      </Card>
    </div>
  );
}

function NumberSetting({ label, value, setValue }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-left dark:border-slate-700">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setValue(Math.max(1, value - 1))}
        >
          -
        </Button>
        <div className="w-16 text-center text-xl font-semibold tabular-nums">
          {value}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setValue(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}

export { Button as UIButton, Card as UICard, Input as UIInput };
