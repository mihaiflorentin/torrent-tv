import { options } from 'preact';
import { afterEach } from 'vitest';
import { resetFocusPoint } from './lazy-art';

// Preact runs useEffect callbacks after the next animation frame or after a 35 ms fallback, whichever
// comes first. Tests sleep for 20-60 ms, so under load an effect (landing focus, a screen's initial
// focus timer) could fire after the test had already moved focus and yank it back. Flush effects on the
// next macrotask instead, so a sleep always outlasts them.
options.requestAnimationFrame = callback => { setTimeout(callback, 0); };

// Module-level focus point (lazy art) must not leak from one test into the next.
afterEach(() => { resetFocusPoint(); });
