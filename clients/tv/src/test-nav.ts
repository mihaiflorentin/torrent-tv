import { hubOf, type TVRoute } from './hubs';
import { sleep } from './test-wait';

/**
 * Opens a route the way a viewer does: the rail item of its hub, then its tab (Library, Discover), or its
 * Settings entry (Background jobs, Other projects). Clicks stand in for OK, like the other app tests.
 */
export async function openRoute(container: ParentNode, route: TVRoute | string, waitMs = 80): Promise<void> {
  const target = route as TVRoute;
  const hub = hubOf(target);
  const click = async (selector: string) => {
    const element = container.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`openRoute(${route}): nothing matches ${selector}`);
    element.click();
    await sleep(waitMs);
  };
  await click(`[data-menu-hub="${hub.id}"]`);
  if (hub.tabs && !container.querySelector(`[data-hub-tab="${target}"][aria-selected="true"]`)) await click(`[data-hub-tab="${target}"]`);
  // Background jobs and Other projects: open their Settings group, then the entry in it.
  if (target === 'jobs' || target === 'projects') {
    await click(`[data-focus-key="settings-group-${target}"]`);
    await click(`[data-focus-key="settings-${target}"]`);
  }
}
