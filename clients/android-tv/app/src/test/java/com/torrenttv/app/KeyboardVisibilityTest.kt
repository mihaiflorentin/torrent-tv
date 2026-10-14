package com.torrenttv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardVisibilityTest {
    @Test fun `tracker reports only changes so the page sees one event per transition`() {
        val tracker = KeyboardVisibilityTracker()
        assertNull(tracker.update(false))
        assertEquals(true, tracker.update(true))
        assertNull(tracker.update(true))
        assertEquals(false, tracker.update(false))
        assertNull(tracker.update(false))
    }
    @Test fun `script calls the page bridge with the visibility`() {
        assertTrue(KeyboardVisibilityScripts.script(true).contains("setKeyboardVisible(true)"))
        assertTrue(KeyboardVisibilityScripts.script(false).contains("setKeyboardVisible(false)"))
    }
    @Test fun `legacy detection treats a large lost height as a visible keyboard`() {
        assertTrue(KeyboardVisibilityScripts.heightImpliesKeyboard(1080, 700))
        assertFalse(KeyboardVisibilityScripts.heightImpliesKeyboard(1080, 1040))
        assertFalse(KeyboardVisibilityScripts.heightImpliesKeyboard(0, 0))
    }
}
