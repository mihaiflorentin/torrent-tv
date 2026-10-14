package com.torrenttv.app

/** What the lifecycle needs from the Activity; a fake stands in on the JVM. */
interface ShellHost {
    fun pausePlayer()
    fun releasePlayer()
    fun notifyVisibility(visible: Boolean)
    fun pauseWebView()
    fun resumeWebView()
    fun destroyWebView()
}

sealed class RendererOutcome {
    object Restart : RendererOutcome()
    data class GiveUp(val reason: String) : RendererOutcome()
}

/**
 * Activity lifecycle transitions and the bounded renderer-restart policy,
 * kept free of Android types so they run as plain JVM unit tests.
 * Leaving the screen pauses the player and tells the page it is hidden (its
 * suspend path saves the position); destroy releases everything once.
 */
class ShellLifecycle(
    private val host: ShellHost,
    private val maxRestarts: Int = MAX_RESTARTS,
    private val windowMs: Long = RESTART_WINDOW_MS,
) {
    private var destroyed = false
    private val restarts = ArrayDeque<Long>()

    fun onPause() {
        if (destroyed) return
        host.pausePlayer()
        host.notifyVisibility(false)
        host.pauseWebView()
    }

    fun onResume() {
        if (destroyed) return
        host.resumeWebView()
        host.notifyVisibility(true)
    }

    fun onDestroy() {
        if (destroyed) return
        destroyed = true
        host.releasePlayer()
        host.destroyWebView()
    }

    /** Tears down the dead shell, then says whether to rebuild it. */
    fun onRendererGone(nowMs: Long): RendererOutcome {
        host.releasePlayer()
        host.destroyWebView()
        while (restarts.isNotEmpty() && nowMs - restarts.first() >= windowMs) restarts.removeFirst()
        if (restarts.size >= maxRestarts) {
            return RendererOutcome.GiveUp("The web view stopped $maxRestarts times in a minute.")
        }
        restarts.addLast(nowMs)
        return RendererOutcome.Restart
    }

    companion object {
        const val MAX_RESTARTS = 3
        const val RESTART_WINDOW_MS = 60_000L
    }
}

/** Script that reports app visibility to the page's platform bridge. */
object VisibilityScripts {
    fun script(visible: Boolean): String =
        "(function(){var b=window.FileListTVBridge;if(b&&b.setVisible)b.setVisible($visible);})();"
}
