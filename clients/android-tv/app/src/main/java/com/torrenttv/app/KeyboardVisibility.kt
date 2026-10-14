package com.torrenttv.app

/**
 * Remembers the last reported on-screen keyboard state so the page gets one
 * event per transition. update returns the new state on a change, else null.
 */
class KeyboardVisibilityTracker {
    private var visible = false

    fun update(now: Boolean): Boolean? {
        if (now == visible) return null
        visible = now
        return now
    }
}

/** Script that reports keyboard visibility to the page's platform bridge. */
object KeyboardVisibilityScripts {
    fun script(visible: Boolean): String =
        "(function(){var b=window.FileListTVBridge;if(b&&b.setKeyboardVisible)b.setKeyboardVisible($visible);})();"

    /** Fallback below API 30, where no IME inset exists: the keyboard took over a fifth of the window. */
    fun heightImpliesKeyboard(rootHeight: Int, visibleHeight: Int): Boolean =
        rootHeight > 0 && (rootHeight - visibleHeight) * 5 > rootHeight
}
