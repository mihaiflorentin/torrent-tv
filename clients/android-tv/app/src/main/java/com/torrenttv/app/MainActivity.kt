package com.torrenttv.app

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.torrenttv.app.avplay.AvPlayBridge

class MainActivity : Activity(), ShellHost {
    private var webView: WebView? = null
    private var avplayBridge: AvPlayBridge? = null
    private var gaveUp = false
    private val lifecycle = ShellLifecycle(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildShell()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildShell() {
        val surface = SurfaceView(this)
        val view = WebView(this)
        webView = view
        // Transparent wherever the page is transparent: the video surface
        // below shows through the player shell exactly like Tizen's AVPlay
        // plane shows through the object element.
        view.setBackgroundColor(Color.TRANSPARENT)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = false
        // The page origin is https (appassets domain) and the LAN server is
        // http: without this, mixed-content blocking kills every API call.
        view.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        view.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // The JS bridge is exposed to whatever document loads, so the
            // WebView never leaves the app's asset origin.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !UrlPolicy.isAppOrigin(request.url.toString())

            override fun onPageFinished(view: WebView, url: String) {
                Log.i("TorrentTV", "ready")
            }

            // The client never fails silently (spec): a dead renderer
            // rebuilds the shell a bounded number of times, then shows the
            // error panel instead of looping or leaving a black screen.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e("TorrentTV", "render process gone")
                when (val outcome = lifecycle.onRendererGone(SystemClock.elapsedRealtime())) {
                    RendererOutcome.Restart -> buildShell()
                    is RendererOutcome.GiveUp -> showErrorPanel(outcome.reason)
                }
                return true
            }
        }
        val bridge = AvPlayBridge(surface) { script ->
            runOnUiThread { webView?.evaluateJavascript(script, null) }
        }
        avplayBridge = bridge
        view.addJavascriptInterface(Bridge(this, LinkNetworkInfo(this), bridge), "FileListTVNative")
        val layout = FrameLayout(this)
        layout.addView(surface, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        layout.addView(view, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(layout)
        view.loadUrl(UrlPolicy.APP_URL)
    }

    // The WebView is gone for good, so the panel is native; Back exits.
    private fun showErrorPanel(reason: String) {
        gaveUp = true
        val panel = TextView(this)
        panel.setBackgroundColor(Color.parseColor("#071018"))
        panel.setTextColor(Color.WHITE)
        panel.textSize = 24f
        panel.gravity = Gravity.CENTER
        panel.text = "TorrentTV stopped working\n\n$reason\n\nPress Back to exit."
        setContentView(panel)
    }

    override fun pausePlayer() { avplayBridge?.pause() }

    override fun releasePlayer() {
        avplayBridge?.close()
        avplayBridge = null
    }

    override fun notifyVisibility(visible: Boolean) {
        webView?.evaluateJavascript(VisibilityScripts.script(visible), null)
    }

    override fun pauseWebView() { webView?.onPause() }

    override fun resumeWebView() { webView?.onResume() }

    override fun destroyWebView() {
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
    }

    override fun onPause() {
        lifecycle.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        lifecycle.onResume()
    }

    override fun onDestroy() {
        lifecycle.onDestroy()
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (gaveUp) {
            if (keyCode == KeyEvent.KEYCODE_BACK) finish()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (event?.repeatCount == 0) webView?.evaluateJavascript(BackKeys.downScript(), null)
            return true
        }
        // DPAD and ENTER feed the page's focus engine as synthetic DOM key
        // events (DpadKeys) — the same contract Tizen delivers — and the
        // native key is consumed so the WebView's own focus search can
        // never move focus a second time. Key repeats forward too: held
        // arrows keep scrolling.
        DpadKeys.downScript(keyCode)?.let { script ->
            webView?.evaluateJavascript(script, null)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView?.evaluateJavascript(BackKeys.upScript(), null)
            return true
        }
        DpadKeys.upScript(keyCode)?.let { script ->
            webView?.evaluateJavascript(script, null)
            return true
        }
        return super.onKeyUp(keyCode, event)
    }
}
