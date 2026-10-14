package com.torrenttv.app

/**
 * Synthetic key events that forward the Android DPAD and ENTER keys into the
 * page as the arrow and Enter DOM events the web app's focus engine consumes
 * — the same contract Tizen delivers through tvinputdevice. Consuming the
 * native keys also takes the WebView's own focus search out of the loop, so
 * one remote press moves focus exactly once.
 */
object DpadKeys {
    fun downScript(keyCode: Int, repeat: Boolean = false): String? = keyScript("keydown", keyCode, repeat)
    fun upScript(keyCode: Int): String? = keyScript("keyup", keyCode, false)

    /** Platform repeat count above zero means the key is held: the DOM `repeat` flag. */
    fun isRepeat(repeatCount: Int): Boolean = repeatCount > 0

    private fun keyScript(type: String, keyCode: Int, repeat: Boolean): String? {
        val (name, code) = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft" to 37
            KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight" to 39
            KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp" to 38
            KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown" to 40
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "Enter" to 13
            // Media keys: the key names the shared player matches first,
            // with the Tizen codes it falls back to.
            KeyEvent.KEYCODE_MEDIA_PLAY -> "MediaPlay" to 415
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPause" to 19
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause" to 10252
            KeyEvent.KEYCODE_MEDIA_STOP -> "MediaStop" to 413
            KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaRewind" to 412
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward" to 417
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious" to 10232
            KeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext" to 10233
            else -> return null
        }
        // Old TV WebViews ignore parts of the KeyboardEvent init dict, so
        // key/keyCode/which are forced with defineProperty after init: the
        // page's remoteAction matches on either field.
        return "(function(){" +
            "var e=document.createEvent('KeyboardEvent');" +
            "e.initKeyboardEvent('$type',true,true,window,'$name',0,'',false,'');" +
            "Object.defineProperty(e,'key',{get:function(){return '$name'}});" +
            "Object.defineProperty(e,'keyCode',{get:function(){return $code}});" +
            "Object.defineProperty(e,'which',{get:function(){return $code}});" +
            "Object.defineProperty(e,'repeat',{get:function(){return $repeat}});" +
            "document.dispatchEvent(e);})();"
    }

    private object KeyEvent {
        const val KEYCODE_DPAD_LEFT = 21
        const val KEYCODE_DPAD_RIGHT = 22
        const val KEYCODE_DPAD_UP = 19
        const val KEYCODE_DPAD_DOWN = 20
        const val KEYCODE_DPAD_CENTER = 23
        const val KEYCODE_ENTER = 66
        const val KEYCODE_MEDIA_PLAY_PAUSE = 85
        const val KEYCODE_MEDIA_STOP = 86
        const val KEYCODE_MEDIA_NEXT = 87
        const val KEYCODE_MEDIA_PREVIOUS = 88
        const val KEYCODE_MEDIA_REWIND = 89
        const val KEYCODE_MEDIA_FAST_FORWARD = 90
        const val KEYCODE_MEDIA_PLAY = 126
        const val KEYCODE_MEDIA_PAUSE = 127
    }
}
