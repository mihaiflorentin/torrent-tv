// Pure evaluation logic of the TV performance harness: Chrome trace events in,
// per-step main-thread metrics and budget violations out. No browser needed,
// so it is unit tested (analysis.test.mjs).

const MS = 1000; // trace timestamps are microseconds

export const BUDGETS = {
  routeSettleMs: 150, // a menu route change finishes its main-thread work this long after the keypress
  moveBusyMs: 50, // a D-pad move costs less than this much main-thread time...
  moveLongTasks: 0, // ...and contains no long task
};

export const LONG_TASK_MS = 50;
export const QUIET_GAP_MS = 100; // idle gap that ends a step's burst of work
// Chromium wakes the main thread constantly (frame ticks, timers) with sub-millisecond tasks;
// only tasks at least this long keep a burst alive, so the background hum never stretches a step.
export const SIGNIFICANT_TASK_MS = 2;
const MARK_PREFIX = 'tvperf:key:';

const SCRIPT = new Set(['FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.run', 'TimerFire', 'FireAnimationFrame', 'FireIdleCallback', 'EventDispatch', 'RunMicrotasks', 'MinorGC', 'MajorGC', 'V8.GC_MC_BACKGROUND_MARKING', 'ParseHTML', 'XHRReadyStateChange', 'ResourceFinish', 'v8.callFunction']);
const STYLE = new Set(['UpdateLayoutTree', 'RecalculateStyles', 'ScheduleStyleRecalculation']);
const LAYOUT = new Set(['Layout', 'UpdateLayer']);
const PAINT = new Set(['PrePaint', 'Paint', 'Layerize', 'Commit', 'CompositeLayers', 'UpdateLayerTree', 'RasterTask', 'HitTest', 'ImageDecodeTask']);

function bucketOf(name) {
  if (SCRIPT.has(name)) return 'script';
  if (STYLE.has(name)) return 'style';
  if (LAYOUT.has(name)) return 'layout';
  if (PAINT.has(name)) return 'paint';
  return null;
}

/** Marks come from the page's own keydown hook; they identify the renderer main thread. */
function findMarks(events) {
  const marks = new Map();
  let thread = null;
  for (const event of events) {
    if (typeof event.name === 'string' && event.name.startsWith(MARK_PREFIX)) {
      marks.set(Number(event.name.slice(MARK_PREFIX.length)), event.ts);
      thread = thread || { pid: event.pid, tid: event.tid };
    }
  }
  return { marks, thread };
}

/** Complete events of the main thread with their self time (duration minus nested events). */
function mainThreadEvents(events, thread) {
  const own = events.filter(event => event.ph === 'X' && event.pid === thread.pid && event.tid === thread.tid && typeof event.dur === 'number')
    .map(event => ({ name: event.name, ts: event.ts, dur: event.dur, end: event.ts + event.dur, self: event.dur }))
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  for (const event of own) {
    while (stack.length && stack[stack.length - 1].end <= event.ts) stack.pop();
    if (stack.length) stack[stack.length - 1].self -= event.dur;
    stack.push(event);
  }
  return own;
}

/**
 * steps: [{ id, kind, key, until? }] where key is the index of a keypress mark.
 * `until` (another key index) cuts a held-key step at the next press; without
 * it the step is the burst of work that follows the press, ended by an idle gap.
 */
export function analyzeSteps(events, steps) {
  const { marks, thread } = findMarks(events);
  if (!thread) throw new Error('trace has no tvperf key marks; the page hook did not run');
  const all = mainThreadEvents(events, thread);
  const tasks = all.filter(event => event.name === 'RunTask');
  const firstTaskAt = ts => tasks.find(task => task.end >= ts);
  return steps.map(step => {
    const markTs = marks.get(step.key);
    if (markTs === undefined) throw new Error(`missing key mark ${step.key} for step ${step.id}`);
    const first = firstTaskAt(markTs);
    let window = [];
    if (first) {
      if (step.until !== undefined) {
        const cut = marks.get(step.until);
        const cutTask = cut === undefined ? undefined : firstTaskAt(cut);
        const limit = cutTask ? cutTask.ts : Infinity;
        window = tasks.filter(task => task.ts >= first.ts && task.ts < limit);
      } else {
        let end = first.end;
        window = [first];
        for (const task of tasks) {
          if (task.ts <= first.ts) continue;
          if (task.ts - end > QUIET_GAP_MS * MS) break;
          window.push(task);
          if (task.dur >= SIGNIFICANT_TASK_MS * MS) end = Math.max(end, task.end);
        }
        // Trailing hum after the last significant task is not the step's work.
        window = window.filter(task => task.ts <= end);
      }
    }
    const start = first ? first.ts : markTs;
    const stop = window.length ? Math.max(...window.map(task => task.end)) : markTs;
    const inside = all.filter(event => event.ts >= start && event.ts < stop);
    const sum = bucket => inside.filter(event => bucketOf(event.name) === bucket).reduce((total, event) => total + event.self, 0) / MS;
    const byName = {};
    for (const event of inside) if (event.name !== 'RunTask' && event.self >= 0.5 * MS) byName[event.name] = round(((byName[event.name] || 0) * MS + event.self) / MS);
    const busyMs = window.reduce((total, task) => total + task.dur, 0) / MS;
    const script = sum('script'), style = sum('style'), layout = sum('layout'), paint = sum('paint');
    return {
      id: step.id,
      label: step.label || step.id,
      kind: step.kind,
      group: step.group || step.id,
      markTs,
      busyMs: round(busyMs),
      settleMs: round(Math.max(0, stop - markTs) / MS),
      scriptMs: round(script),
      styleMs: round(style),
      layoutMs: round(layout),
      paintMs: round(paint),
      otherMs: round(Math.max(0, busyMs - script - style - layout - paint)),
      selfByEvent: byName, // self time per trace event name (events of 0.5 ms or more), for finding what a step spent its time on
      tasks: window.length,
      longTasks: window.filter(task => task.dur >= LONG_TASK_MS * MS).length,
      maxTaskMs: round(Math.max(0, ...window.map(task => task.dur)) / MS),
    };
  });
}

const round = value => Math.round(value * 10) / 10;

/** Frames the page presented inside [startMs, endMs] whose gap since the previous frame exceeds the threshold. */
export function countSlowFrames(frameTimes, startMs, endMs, thresholdMs = 50) {
  let slow = 0;
  for (let index = 1; index < frameTimes.length; index++) {
    const at = frameTimes[index];
    if (at >= startMs && at <= endMs && at - frameTimes[index - 1] > thresholdMs) slow++;
  }
  return slow;
}

/** Route steps must settle within the budget; move steps must be cheap and free of long tasks. */
export function evaluateBudgets(steps, budgets = BUDGETS) {
  const violations = [];
  for (const step of steps) {
    if (step.kind === 'route' && step.settleMs > budgets.routeSettleMs) {
      violations.push({ id: step.id, reason: `route change settled ${step.settleMs} ms after the keypress (budget ${budgets.routeSettleMs} ms)` });
    } else if (step.kind === 'move') {
      if (step.busyMs >= budgets.moveBusyMs) violations.push({ id: step.id, reason: `D-pad move cost ${step.busyMs} ms of main-thread time (budget under ${budgets.moveBusyMs} ms)` });
      else if (step.longTasks > budgets.moveLongTasks) violations.push({ id: step.id, reason: `D-pad move ran ${step.longTasks} long task(s) (budget ${budgets.moveLongTasks})` });
    }
  }
  return violations;
}
