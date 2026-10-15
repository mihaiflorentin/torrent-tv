package com.torrenttv.app.avplay

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AvPlayStateMapperTest {
    @Test fun `buffering maps to onbufferingstart`() = assertEquals("onbufferingstart", AvPlayStateMapper.bufferingCallback(Player.STATE_BUFFERING))
    @Test fun `ready maps to onbufferingcomplete`() = assertEquals("onbufferingcomplete", AvPlayStateMapper.bufferingCallback(Player.STATE_READY))
    @Test fun `ended maps to onstreamcompleted`() = assertEquals("onstreamcompleted", AvPlayStateMapper.bufferingCallback(Player.STATE_ENDED))
    @Test fun `idle maps to nothing`() = assertNull(AvPlayStateMapper.bufferingCallback(Player.STATE_IDLE))
    @Test fun `buffered percentage is passed through on the 0 to 100 scale`() = assertEquals(35, AvPlayStateMapper.bufferingPercent(35))
    @Test fun `buffered percentage is clamped to 0 to 100`() {
        assertEquals(0, AvPlayStateMapper.bufferingPercent(-1))
        assertEquals(100, AvPlayStateMapper.bufferingPercent(3500))
    }
}
