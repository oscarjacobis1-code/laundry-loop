package com.laundryloop.printbridge

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class PosActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var initialized = false
    private var backgroundedAt = 0L
    private var awaitingCredential = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        requireDeviceCredential()
    }

    private fun requireDeviceCredential() {
        if (awaitingCredential) return
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isDeviceSecure) {
            showSecurityRequired()
            return
        }

        val intent = keyguard.createConfirmDeviceCredentialIntent(
            "Unlock Laundry Loop POS",
            "Confirm the tablet PIN, pattern or password to access customer and order data."
        )

        if (intent == null) {
            initializePos()
            return
        }

        awaitingCredential = true
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_UNLOCK)
    }

    private fun showSecurityRequired() {
        val pad = (24 * resources.displayMetrics.density).toInt()
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(this@PosActivity).apply {
                text = "Laundry Loop POS requires a device screen lock before customer data can be opened. Set a PIN, pattern or password in Android Settings, then reopen the app."
                textSize = 18f
            })
        })
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_UNLOCK) return
        awaitingCredential = false
        if (resultCode == RESULT_OK) initializePos() else finish()
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

        toolbar.addView(Button(this).apply {
            text = "Printer"
            setOnClickListener { startActivity(Intent(this@PosActivity, MainActivity::class.java)) }
        })

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
            userAgentString = "$userAgentString LaundryLoopPOS/2.1"
        }

        webView.addJavascriptInterface(NativePrintBridge(), "LaundryLoopNative")
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
        setContentView(root)

        webView.loadUrl("https://$TRUSTED_HOST/staff?app=1")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    inner class NativePrintBridge {
        @JavascriptInterface
        fun print(payload: String) {
            runOnUiThread {
                if (!::webView.isInitialized) return@runOnUiThread
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

    override fun onStop() {
        super.onStop()
        backgroundedAt = SystemClock.elapsedRealtime()
    }

    override fun onStart() {
        super.onStart()
        if (initialized && backgroundedAt > 0L && SystemClock.elapsedRealtime() - backgroundedAt > RELOCK_AFTER_MS) {
            initialized = false
            requireDeviceCredential()
        }
    }

    override fun onDestroy() {
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
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_UNLOCK = 601
        private const val TRUSTED_HOST = "thelaundryloop.net"
        private const val RELOCK_AFTER_MS = 60_000L
    }
}
