package com.laundryloop.printbridge

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class PosActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var initialized = false
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        initializePos()
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
            userAgentString = "$userAgentString LaundryLoopPOS/2.2"
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
        fun openPrinterSettings() {
            runOnUiThread {
                if (!::webView.isInitialized) return@runOnUiThread
                val current = Uri.parse(webView.url ?: return@runOnUiThread)
                if (current.scheme != "https" || current.host != TRUSTED_HOST) return@runOnUiThread
                startActivity(Intent(this@PosActivity, MainActivity::class.java))
            }
        }

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
