package com.torrenttv.app.avplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackInfoTest {
    @Test fun `serializes to the AVPlay total-track-info shape`() {
        val json = TrackInfo.toJson(listOf(
            TrackInfo.Track(type = "AUDIO", language = "eng", codec = "audio/eac3"),
            TrackInfo.Track(type = "TEXT", language = "ron", codec = "text/vtt"),
        ))
        val parsed = org.json.JSONArray(json)
        assertEquals(2, parsed.length())
        val audio = parsed.getJSONObject(0)
        assertEquals("AUDIO", audio.getString("type"))
        assertEquals(0, audio.getInt("index"))
        val extra = org.json.JSONObject(audio.getString("extra_info"))
        assertEquals("eng", extra.getString("track_lang"))
        assertEquals("audio/eac3", extra.optString("codec"))
        val text = parsed.getJSONObject(1)
        assertEquals("TEXT", text.getString("type"))
        assertEquals(1, text.getInt("index"))
        assertTrue(text.getString("extra_info").contains("ron"))
    }
    @Test fun `empty track list serializes to an empty array`() = assertEquals("[]", TrackInfo.toJson(emptyList()))
    @Test fun `indices are numbered per type across mixed groups`() {
        val json = TrackInfo.toJson(listOf(
            TrackInfo.Track(type = "VIDEO", language = "", codec = "video/avc"),
            TrackInfo.Track(type = "AUDIO", language = "eng", codec = "audio/eac3"),
            TrackInfo.Track(type = "AUDIO", language = "ron", codec = "audio/ac3"),
            TrackInfo.Track(type = "TEXT", language = "eng", codec = "text/vtt"),
            TrackInfo.Track(type = "TEXT", language = "ron", codec = "text/vtt"),
        ))
        val parsed = org.json.JSONArray(json)
        val indices = (0 until parsed.length()).map { parsed.getJSONObject(it).let { t -> t.getString("type") to t.getInt("index") } }
        assertEquals(listOf("VIDEO" to 0, "AUDIO" to 0, "AUDIO" to 1, "TEXT" to 0, "TEXT" to 1), indices)
    }
}
