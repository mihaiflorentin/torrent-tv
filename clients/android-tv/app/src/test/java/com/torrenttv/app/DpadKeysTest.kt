package com.torrenttv.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DpadKeysTest {
    @Test fun `down scripts map every dpad key to the DOM events the page consumes`() {
        assertTrue(DpadKeys.downScript(21)!!.contains("ArrowLeft") && DpadKeys.downScript(21)!!.contains("37"))
        assertTrue(DpadKeys.downScript(22)!!.contains("ArrowRight") && DpadKeys.downScript(22)!!.contains("39"))
        assertTrue(DpadKeys.downScript(19)!!.contains("ArrowUp") && DpadKeys.downScript(19)!!.contains("38"))
        assertTrue(DpadKeys.downScript(20)!!.contains("ArrowDown") && DpadKeys.downScript(20)!!.contains("40"))
        assertTrue(DpadKeys.downScript(23)!!.contains("Enter") && DpadKeys.downScript(23)!!.contains("13"))
        assertTrue(DpadKeys.downScript(66)!!.contains("Enter") && DpadKeys.downScript(66)!!.contains("13"))
    }
    @Test fun `up scripts dispatch the matching keyup`() {
        assertTrue(DpadKeys.upScript(20)!!.contains("keyup"))
        assertTrue(DpadKeys.upScript(20)!!.contains("ArrowDown"))
    }
    @Test fun `keys outside the d-pad set are left for the WebView`() {
        assertNull(DpadKeys.downScript(4))
        assertNull(DpadKeys.upScript(24))
    }
    @Test fun `media keys map to the key names and codes the shared player handles`() {
        val expected = mapOf(
            126 to ("MediaPlay" to 415), 127 to ("MediaPause" to 19), 85 to ("MediaPlayPause" to 10252),
            86 to ("MediaStop" to 413), 89 to ("MediaRewind" to 412), 90 to ("MediaFastForward" to 417),
            88 to ("MediaTrackPrevious" to 10232), 87 to ("MediaTrackNext" to 10233),
        )
        for ((androidCode, pair) in expected) {
            val script = DpadKeys.downScript(androidCode)!!
            assertTrue("key ${pair.first}", script.contains("'${pair.first}'"))
            assertTrue("code ${pair.second}", script.contains("return ${pair.second}}"))
        }
    }
    @Test fun `keydown carries repeat from the platform repeat count`() {
        assertTrue(DpadKeys.downScript(23, repeat = true)!!.contains("'repeat',{get:function(){return true}}"))
        assertTrue(DpadKeys.downScript(23, repeat = false)!!.contains("'repeat',{get:function(){return false}}"))
        assertTrue(DpadKeys.downScript(23)!!.contains("'repeat',{get:function(){return false}}"))
    }
    @Test fun `repeat flag derives from repeatCount above zero`() {
        assertFalse(DpadKeys.isRepeat(0))
        assertTrue(DpadKeys.isRepeat(1))
        assertTrue(DpadKeys.isRepeat(7))
    }
}
