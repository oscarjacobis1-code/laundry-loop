package com.laundryloop.printbridge

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class PosActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var initialized = false
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null
    private lateinit var accessControl: RemotePosAccess
    private lateinit var accessOverlay: LinearLayout
    private lateinit var accessTitle: TextView
    private lateinit var accessDescription: TextView
    private var accessState = RemotePosAccess.State.CONNECTION_REQUIRED
    private var posLoaded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        initializePos()
        accessControl = RemotePosAccess(this) { applyAccessState(it) }
    }

    override fun onResume() {
        super.onResume()
        if (::accessControl.isInitialized) accessControl.start()
    }

    override fun onPause() {
        if (::accessControl.isInitialized) accessControl.stop()
        super.onPause()
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_FILE) {
            pendingFileChooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            pendingFileChooser = null
            return
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun initializePos() {
        if (initialized) return
        initialized = true

        val density = resources.displayMetrics.density
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding((14 * density).toInt(), (6 * density).toInt(), (8 * density).toInt(), (6 * density).toInt())
            setBackgroundColor(Color.rgb(7, 25, 79))
        }

        toolbar.addView(TextView(this).apply {
            text = "Laundry Loop POS"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString LaundryLoopPOS/2.3"
        }

        webView.addJavascriptInterface(NativePrintBridge(), "LaundryLoopNative")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileChooser?.onReceiveValue(null)
                pendingFileChooser = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "image/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }, REQUEST_FILE)
                    true
                } catch (_: Exception) {
                    pendingFileChooser?.onReceiveValue(null)
                    pendingFileChooser = null
                    false
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme.orEmpty().lowercase()
                val host = uri.host.orEmpty().lowercase()

                if (scheme == "https" && host == TRUSTED_HOST) return false

                if (scheme == "https") {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (_: Exception) {
                        true
                    }
                }

                return true
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        val screen = FrameLayout(this)
        screen.addView(root, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        val noticeCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val spacing = (20 * density).toInt()
            setPadding(spacing, spacing, spacing, spacing)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 14 * density
            }
            elevation = 3 * density
        }
        accessTitle = TextView(this).apply {
            text = "Verifying system access"
            textSize = 22f
            setTextColor(Color.rgb(23, 32, 51))
            gravity = Gravity.CENTER
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        accessDescription = TextView(this).apply {
            text = "Connecting to the system."
            textSize = 15f
            setTextColor(Color.rgb(91, 102, 118))
            gravity = Gravity.CENTER
            setPadding(0, (12 * density).toInt(), 0, (22 * density).toInt())
        }
        val retryButton = Button(this).apply {
            text = "Check again"
            setOnClickListener {
                if (::accessControl.isInitialized) accessControl.retryNow()
            }
        }
        noticeCard.addView(accessTitle)
        noticeCard.addView(accessDescription)
        noticeCard.addView(retryButton)

        accessOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(246, 247, 249))
            isClickable = true
            isFocusable = true
            setPadding((24 * density).toInt(), 0, (24 * density).toInt(), 0)
            addView(noticeCard, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ))
        }
        screen.addView(accessOverlay, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        setContentView(screen)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (accessState == RemotePosAccess.State.ALLOWED && ::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })
    }

    private fun applyAccessState(state: RemotePosAccess.State) {
        if (!::accessOverlay.isInitialized) return
        val previous = accessState
        accessState = state
        if (state == RemotePosAccess.State.ALLOWED) {
            accessOverlay.visibility = View.GONE
            webView.onResume()
            webView.resumeTimers()
            if (!posLoaded) {
                posLoaded = true
                webView.loadUrl("https://$TRUSTED_HOST/staff?app=1")
            } else if (previous != RemotePosAccess.State.ALLOWED) {
                webView.reload()
            }
            return
        }

        accessOverlay.visibility = View.VISIBLE
        webView.onPause()
        webView.pauseTimers()
        if (state == RemotePosAccess.State.SUSPENDED) {
            accessTitle.text = "Service Temporarily Suspended"
            accessDescription.text = "Please contact administrator for more information."
        } else {
            accessTitle.text = "Connection Required"
            accessDescription.text = "Connect to the internet to verify POS access. Saved orders remain on this tablet."
        }
    }

    inner class NativePrintBridge {
        @JavascriptInterface
        fun openPrinterSettings() {
            runOnUiThread {
                if (!::webView.isInitialized || accessState != RemotePosAccess.State.ALLOWED) return@runOnUiThread
                val current = Uri.parse(webView.url ?: return@runOnUiThread)
                if (current.scheme != "https" || current.host != TRUSTED_HOST) return@runOnUiThread
                startActivity(Intent(this@PosActivity, MainActivity::class.java))
            }
        }

        @JavascriptInterface
        fun print(payload: String) {
            runOnUiThread {
                if (!::webView.isInitialized || accessState != RemotePosAccess.State.ALLOWED) return@runOnUiThread
                val current = Uri.parse(webView.url ?: return@runOnUiThread)
                if (current.scheme != "https" || current.host != TRUSTED_HOST) return@runOnUiThread

                try {
                    val json = JSONObject(payload)
                    val mode = json.optString("mode", "receipt").lowercase()
                    if (mode !in setOf("receipt", "tag")) return@runOnUiThread

                    val uri = Uri.Builder()
                        .scheme("laundryloop-print")
                        .authority("print")
                        .appendQueryParameter("mode", mode)
                        .appendQueryParameter("text", json.optString("text").take(6000))
                        .appendQueryParameter("payment_status", json.optString("payment_status").take(60))
                        .apply {
                            json.optString("order").takeIf { it.isNotBlank() }?.let { appendQueryParameter("order", it) }
                            json.optString("payment").takeIf { it.isNotBlank() }?.let { appendQueryParameter("payment", it) }
                            if (json.optBoolean("suppress_drawer", false)) appendQueryParameter("suppress_drawer", "1")
                        }
                        .build()

                    startActivity(Intent(this@PosActivity, MainActivity::class.java).setData(uri))
                } catch (_: Exception) {
                    // Ignore malformed JavaScript bridge requests.
                }
            }
        }
    }

    override fun onDestroy() {
        if (::accessControl.isInitialized) accessControl.close()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("LaundryLoopNative")
            webView.apply {
                stopLoading()
                loadUrl("about:blank")
                clearHistory()
                removeAllViews()
                destroy()
            }
        }
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_FILE = 602
        private const val TRUSTED_HOST = "thelaundryloop.net"
    }
}
