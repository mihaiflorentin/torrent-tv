package com.torrenttv.app.avplay

import org.json.JSONArray
import org.json.JSONObject

/**
 * Serializes tracks into the shape `normalizeTrack` in the web app parses:
 * a JSON array of { index, type, extra_info }, where extra_info is itself a
 * JSON string carrying track_lang and codec. Indices count per type (the
 * first audio and the first text track are both 0), matching the index
 * `AvPlayBridge.setSelectTrack` resolves within its type.
 */
object TrackInfo {
    data class Track(val type: String, val language: String, val codec: String)

    fun toJson(tracks: List<Track>): String {
        val array = JSONArray()
        val nextIndex = mutableMapOf<String, Int>()
        tracks.forEach { track ->
            val index = nextIndex.getOrDefault(track.type, 0)
            nextIndex[track.type] = index + 1
            val extra = JSONObject()
            extra.put("track_lang", track.language)
            if (track.codec.isNotEmpty()) extra.put("codec", track.codec)
            array.put(JSONObject().put("index", index).put("type", track.type).put("extra_info", extra.toString()))
        }
        return array.toString()
    }
}
