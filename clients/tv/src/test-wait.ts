// Real-time sleep for tests that drive the app through timers (debounces, landing focus, effect
// flushes). A bare setTimeout(ms) is racy under load: when the process stalls, the sleep can expire
// before a timer chain that started earlier (render, effect, focus timer) has finished. After the
// sleep, drain a few zero-delay turns so every hop of such a chain has run.
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms));
  for (let i = 0; i < 12; i++) await turn();
}
