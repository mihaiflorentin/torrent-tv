package com.torrenttv.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {
    @Test fun `app asset pages stay inside the WebView`() {
        assertTrue(UrlPolicy.isAppOrigin("https://appassets.androidplatform.net/assets/www/index.html"))
        assertTrue(UrlPolicy.isAppOrigin("https://appassets.androidplatform.net/assets/www/index.html#/setup"))
        assertTrue(UrlPolicy.isAppOrigin("https://APPASSETS.androidplatform.net/assets/www/index.html"))
    }

    @Test fun `any other origin is rejected for navigation`() {
        assertFalse(UrlPolicy.isAppOrigin("http://appassets.androidplatform.net/assets/www/index.html"))
        assertFalse(UrlPolicy.isAppOrigin("https://appassets.androidplatform.net.evil.com/"))
        assertFalse(UrlPolicy.isAppOrigin("https://appassets.androidplatform.net@evil.com/"))
        assertFalse(UrlPolicy.isAppOrigin("https://appassets.androidplatform.net:8443/assets/"))
        assertFalse(UrlPolicy.isAppOrigin("http://192.168.1.10:8080/"))
        assertFalse(UrlPolicy.isAppOrigin("https://example.com/"))
        assertFalse(UrlPolicy.isAppOrigin("file:///android_asset/www/index.html"))
        assertFalse(UrlPolicy.isAppOrigin("javascript:alert(1)"))
        assertFalse(UrlPolicy.isAppOrigin("intent://scan#Intent;end"))
        assertFalse(UrlPolicy.isAppOrigin("about:blank"))
    }

    @Test fun `malformed navigation input is rejected`() {
        assertFalse(UrlPolicy.isAppOrigin(null))
        assertFalse(UrlPolicy.isAppOrigin(""))
        assertFalse(UrlPolicy.isAppOrigin("not a url"))
        assertFalse(UrlPolicy.isAppOrigin("https://"))
    }

    @Test fun `external open accepts http and https`() {
        assertTrue(UrlPolicy.isExternalOpenable("http://192.168.1.10:8080/"))
        assertTrue(UrlPolicy.isExternalOpenable("https://example.com/path?q=1"))
        assertTrue(UrlPolicy.isExternalOpenable("HTTPS://example.com/"))
    }

    @Test fun `external open rejects other schemes`() {
        assertFalse(UrlPolicy.isExternalOpenable("file:///sdcard/x"))
        assertFalse(UrlPolicy.isExternalOpenable("intent://x#Intent;scheme=http;end"))
        assertFalse(UrlPolicy.isExternalOpenable("javascript:alert(1)"))
        assertFalse(UrlPolicy.isExternalOpenable("content://contacts/people"))
        assertFalse(UrlPolicy.isExternalOpenable("market://details?id=x"))
        assertFalse(UrlPolicy.isExternalOpenable("tel:123"))
    }

    @Test fun `external open rejects malformed input`() {
        assertFalse(UrlPolicy.isExternalOpenable(null))
        assertFalse(UrlPolicy.isExternalOpenable(""))
        assertFalse(UrlPolicy.isExternalOpenable("   "))
        assertFalse(UrlPolicy.isExternalOpenable("http://"))
        assertFalse(UrlPolicy.isExternalOpenable("http:///path"))
        assertFalse(UrlPolicy.isExternalOpenable("example.com"))
        assertFalse(UrlPolicy.isExternalOpenable("http://exa mple.com/"))
        assertFalse(UrlPolicy.isExternalOpenable("http://example.com/\nfoo"))
    }
}
