package com.laundryloop.printbridge

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("printer", MODE_PRIVATE) }
    private lateinit var host: EditText
    private lateinit var port: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun buildUi() {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        root.addView(TextView(this).apply { text = "Laundry Loop Printer"; textSize = 24f })
        root.addView(TextView(this).apply { text = "Rongta / ESC-POS network printer" })
        root.addView(TextView(this).apply { text = "Powered by SnapNest Solutions"; textSize = 12f; alpha = 0.68f; setPadding(0, 4, 0, 16) })
        host = EditText(this).apply { hint = "Printer IP"; setText(prefs.getString("host", "192.168.1.87")) }
        port = EditText(this).apply { hint = "Port"; inputType = 2; setText(prefs.getInt("port", 9100).toString()) }
        status = TextView(this).apply { text = "Ready. Waiting for a print request." }
        val save = Button(this).apply { text = "Save printer"; setOnClickListener { savePrinter(); status.text = "Printer settings saved." } }
        val test = Button(this).apply { text = "Test print"; setOnClickListener { savePrinter(); sendPrint("THE LAUNDRY LOOP\nPrinter connection test\nFresh. Folded. Done.\n\n", false) } }
        val drawer = Button(this).apply { text = "Test cash drawer"; setOnClickListener { savePrinter(); sendPrint("", true) } }
        listOf(host, port, save, test, drawer, status).forEach(root::addView)
        root.addView(TextView(this).apply { text = "Smart Software • Smart Business Solutions"; textSize = 11f; alpha = 0.55f; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, 24, 0, 0) })
        setContentView(root)
    }

    private fun savePrinter() {
        prefs.edit().putString("host", host.text.toString().trim()).putInt("port", port.text.toString().toIntOrNull() ?: 9100).apply()
    }

    private fun handleIntent(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        status.text = "Print request received: ${uri.scheme}://${uri.host ?: ""}"

        val isCustom = uri.scheme == "laundryloop-print"
        val isWebsiteBridge = uri.scheme == "https" && uri.host == "thelaundryloop.net" && uri.path?.startsWith("/printer-bridge") == true
        if (!isCustom && !isWebsiteBridge) {
            status.text = "Unsupported print request: $uri"
            return
        }

        val action = if (isCustom) uri.host else uri.getQueryParameter("action") ?: "print"
        if (action == "configure") {
            status.text = "Printer bridge opened from Laundry Loop."
            return
        }
        if (action != "print") {
            status.text = "Unknown printer action: $action"
            return
        }

        val text = uri.getQueryParameter("text").orEmpty()
        if (text.isBlank()) {
            status.text = "Print request received, but receipt text was empty."
            return
        }
        val openDrawer = uri.getQueryParameter("drawer") == "1"
        status.text = "Receipt received. Sending to ${prefs.getString("host", "192.168.1.87")}:${prefs.getInt("port", 9100)}…"
        sendPrint(text, openDrawer)
    }

    private fun sendPrint(text: String, openDrawer: Boolean) {
        val printerHost = prefs.getString("host", "192.168.1.87")?.trim().orEmpty()
        val printerPort = prefs.getInt("port", 9100)
        if (printerHost.isBlank()) { status.text = "Set the printer IP first."; return }
        status.text = "Sending to $printerHost:$printerPort…"
        thread {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(printerHost, printerPort), 3000)
                    socket.soTimeout = 3000
                    val out = ByteArrayOutputStream()
                    out.write(byteArrayOf(0x1B, 0x40))
                    if (text.isNotBlank()) {
                        out.write(text.toByteArray(Charsets.UTF_8))
                        out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                        out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03))
                    }
                    if (openDrawer) out.write(byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte()))
                    socket.getOutputStream().use { stream -> stream.write(out.toByteArray()); stream.flush() }
                }
                runOnUiThread { status.text = if (openDrawer) "Receipt printed and drawer command sent." else "Receipt sent to printer." }
            } catch (e: Exception) {
                runOnUiThread { status.text = "Printer error: ${e.message ?: "connection failed"}" }
            }
        }
    }
}
