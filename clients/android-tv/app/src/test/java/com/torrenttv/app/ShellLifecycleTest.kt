package com.torrenttv.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellLifecycleTest {
    private class FakeHost : ShellHost {
        val calls = mutableListOf<String>()
        override fun pausePlayer() { calls += "pausePlayer" }
        override fun releasePlayer() { calls += "releasePlayer" }
        override fun notifyVisibility(visible: Boolean) { calls += "visible=$visible" }
        override fun pauseWebView() { calls += "pauseWebView" }
        override fun resumeWebView() { calls += "resumeWebView" }
        override fun destroyWebView() { calls += "destroyWebView" }
    }

    @Test fun `pause stops the player, tells the page it is hidden, then pauses the webview`() {
        val host = FakeHost()
        ShellLifecycle(host).onPause()
        assertEquals(listOf("pausePlayer", "visible=false", "pauseWebView"), host.calls)
    }

    @Test fun `resume wakes the webview before telling the page it is visible`() {
        val host = FakeHost()
        ShellLifecycle(host).onResume()
        assertEquals(listOf("resumeWebView", "visible=true"), host.calls)
    }

    @Test fun `destroy releases the player and destroys the webview once`() {
        val host = FakeHost()
        val lifecycle = ShellLifecycle(host)
        lifecycle.onDestroy()
        lifecycle.onDestroy()
        assertEquals(listOf("releasePlayer", "destroyWebView"), host.calls)
    }

    @Test fun `nothing reaches the host after destroy`() {
        val host = FakeHost()
        val lifecycle = ShellLifecycle(host)
        lifecycle.onDestroy()
        host.calls.clear()
        lifecycle.onPause()
        lifecycle.onResume()
        assertTrue(host.calls.isEmpty())
    }

    @Test fun `renderer loss destroys the old webview and player then restarts`() {
        val host = FakeHost()
        val outcome = ShellLifecycle(host).onRendererGone(0L)
        assertEquals(RendererOutcome.Restart, outcome)
        assertEquals(listOf("releasePlayer", "destroyWebView"), host.calls)
    }

    @Test fun `the fourth renderer loss inside the window gives up`() {
        val lifecycle = ShellLifecycle(FakeHost())
        assertEquals(RendererOutcome.Restart, lifecycle.onRendererGone(0L))
        assertEquals(RendererOutcome.Restart, lifecycle.onRendererGone(1_000L))
        assertEquals(RendererOutcome.Restart, lifecycle.onRendererGone(2_000L))
        val outcome = lifecycle.onRendererGone(3_000L)
        assertTrue(outcome is RendererOutcome.GiveUp)
        assertTrue((outcome as RendererOutcome.GiveUp).reason.contains("3"))
    }

    @Test fun `old renderer losses age out of the window`() {
        val lifecycle = ShellLifecycle(FakeHost())
        lifecycle.onRendererGone(0L)
        lifecycle.onRendererGone(1_000L)
        lifecycle.onRendererGone(2_000L)
        assertEquals(RendererOutcome.Restart, lifecycle.onRendererGone(70_000L))
    }

    @Test fun `visibility script calls the bridge with the flag`() {
        assertTrue(VisibilityScripts.script(false).contains("setVisible(false)"))
        assertTrue(VisibilityScripts.script(true).contains("setVisible(true)"))
    }
}
