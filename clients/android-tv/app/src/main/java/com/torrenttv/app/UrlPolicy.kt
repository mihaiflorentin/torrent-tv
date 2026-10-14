package com.torrenttv.app

import java.net.URI

// Pure URL decisions for the WebView lock (kept free of android.* so the
// JVM unit tests cover them).
object UrlPolicy {
    const val APP_HOST = "appassets.androidplatform.net"
    const val APP_URL = "https://$APP_HOST/assets/www/index.html"

    // True only for the app's own asset origin; everything else is cancelled.
    fun isAppOrigin(url: String?): Boolean {
        val uri = parse(url) ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(APP_HOST, ignoreCase = true) &&
            (uri.port == -1 || uri.port == 443)
    }

    // The bridge opens links in the platform browser: http(s) with a host only.
    fun isExternalOpenable(url: String?): Boolean {
        val uri = parse(url) ?: return false
        val scheme = uri.scheme?.lowercase()
        return (scheme == "http" || scheme == "https") && !uri.host.isNullOrEmpty()
    }

    private fun parse(url: String?): URI? {
        if (url.isNullOrBlank()) return null
        return try {
            URI(url.trim())
        } catch (error: Exception) {
            null
        }
    }
}
