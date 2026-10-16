// Unit tests for the harness's pure evaluation logic: `node --test tools/tv_perf`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSteps, countSlowFrames, evaluateBudgets, BUDGETS } from './analysis.mjs';

const MS = 1000; // trace timestamps are microseconds
const PID = 1;
const TID = 2;
const meta = [{ ph: 'M', name: 'thread_name', pid: PID, tid: TID, args: { name: 'CrRendererMain' } }];
const mark = (n, atMs) => ({ ph: 'R', name: `tvperf:key:${n}`, cat: 'blink.user_timing', pid: PID, tid: TID, ts: atMs * MS });
const x = (name, atMs, durMs) => ({ ph: 'X', name, cat: 'devtools.timeline', pid: PID, tid: TID, ts: atMs * MS, dur: durMs * MS });
const task = (atMs, durMs) => x('RunTask', atMs, durMs);

test('a discrete step reports the burst that follows the keypress and ignores later work', () => {
  const events = [
    ...meta,
    mark(0, 1000),
    task(999, 40),
    x('FunctionCall', 1000, 30),
    x('UpdateLayoutTree', 1031, 5),
    x('Layout', 1036, 3),
    task(1060, 20), // 20 ms gap, same burst
    x('Paint', 1062, 10),
    task(1500, 8), // 420 ms later: an image arriving, not part of the step
  ];
  const [step] = analyzeSteps(events, [{ id: 's', kind: 'route', key: 0 }]);
  assert.equal(step.busyMs, 60);
  assert.equal(step.settleMs, 80); // burst ends at 1080, keypress at 1000
  assert.equal(step.scriptMs, 30);
  assert.equal(step.styleMs, 5);
  assert.equal(step.layoutMs, 3);
  assert.equal(step.paintMs, 10);
  assert.equal(step.longTasks, 0);
});

test('background hum of tiny tasks does not stretch a step', () => {
  const hum = Array.from({ length: 40 }, (_, i) => task(1100 + i * 16, 0.4)); // a frame tick every 16 ms
  const events = [...meta, mark(0, 1000), task(1000, 30), ...hum];
  const [step] = analyzeSteps(events, [{ id: 's', kind: 'route', key: 0 }]);
  assert.equal(step.settleMs, 30);
  assert.equal(step.tasks, 1);
});

test('self time is not double counted for nested events', () => {
  const events = [...meta, mark(0, 10), task(10, 50), x('FunctionCall', 10, 40), x('Layout', 20, 15)];
  const [step] = analyzeSteps(events, [{ id: 's', kind: 'move', key: 0 }]);
  assert.equal(step.scriptMs, 25); // 40 minus the nested 15 ms layout
  assert.equal(step.layoutMs, 15);
  assert.equal(step.longTasks, 1); // the 50 ms task
});

test('held keys are cut at the next keypress so each press owns its own work', () => {
  const events = [...meta, mark(0, 0), mark(1, 100), mark(2, 200), task(1, 30), task(101, 70), task(201, 10)];
  const steps = analyzeSteps(events, [
    { id: 'a', kind: 'move', key: 0, until: 1 },
    { id: 'b', kind: 'move', key: 1, until: 2 },
    { id: 'c', kind: 'move', key: 2 },
  ]);
  assert.deepEqual(steps.map(step => step.busyMs), [30, 70, 10]);
  assert.deepEqual(steps.map(step => step.longTasks), [0, 1, 0]);
});

test('slow frames are the gaps over 50 ms between frames inside the step window', () => {
  const frames = [0, 16, 32, 100, 116, 132, 400];
  assert.equal(countSlowFrames(frames, 0, 200), 1); // 32 -> 100
  assert.equal(countSlowFrames(frames, 110, 450), 1); // 132 -> 400
  assert.equal(countSlowFrames(frames, 0, 50), 0);
});

test('budgets: route changes settle in 150 ms, moves cost under 50 ms with no long task', () => {
  const steps = [
    { id: 'r-ok', kind: 'route', busyMs: 90, settleMs: 150, longTasks: 1 },
    { id: 'r-slow', kind: 'route', busyMs: 90, settleMs: 151, longTasks: 1 },
    { id: 'm-ok', kind: 'move', busyMs: 49, settleMs: 49, longTasks: 0 },
    { id: 'm-slow', kind: 'move', busyMs: 50, settleMs: 50, longTasks: 0 },
    { id: 'm-long', kind: 'move', busyMs: 10, settleMs: 10, longTasks: 1 },
    { id: 'nav', kind: 'info', busyMs: 900, settleMs: 900, longTasks: 3 },
  ];
  const violations = evaluateBudgets(steps, BUDGETS);
  assert.deepEqual(violations.map(violation => violation.id), ['r-slow', 'm-slow', 'm-long']);
  assert.match(violations[0].reason, /151/);
});
