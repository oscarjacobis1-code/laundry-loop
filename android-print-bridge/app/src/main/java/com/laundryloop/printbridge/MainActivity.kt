package com.laundryloop.printbridge

import android.content.Intent
import android.os.Bundle
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
        host = EditText(this).apply { hint = "Printer IP e.g. 192.168.1.50"; setText(prefs.getString("host", "192.168.1.50")) }
        port = EditText(this).apply { hint = "Port"; inputType = 2; setText(prefs.getInt("port", 9100).toString()) }
        status = TextView(this).apply { text = "Not tested yet." }
        val save = Button(this).apply { text = "Save printer"; setOnClickListener { savePrinter(); status.text = "Printer settings saved." } }
        val test = Button(this).apply { text = "Test print"; setOnClickListener { savePrinter(); sendPrint("THE LAUNDRY LOOP\nPrinter connection test\nFresh. Folded. Done.\n\n", false) } }
        val drawer = Button(this).apply { text = "Test cash drawer"; setOnClickListener { savePrinter(); sendPrint("", true) } }
        listOf(host, port, save, test, drawer, status).forEach(root::addView)
        setContentView(root)
    }

    private fun savePrinter() {
        prefs.edit().putString("host", host.text.toString().trim()).putInt("port", port.text.toString().toIntOrNull() ?: 9100).apply()
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "laundryloop-print") return
        if (uri.host == "configure") return
        if (uri.host == "print") {
            val text = uri.getQueryParameter("text") ?: return
            // Drawer opens only when the website explicitly asks for it. Receipt
            // printing alone never opens the drawer, preventing accidental kicks.
            val openDrawer = uri.getQueryParameter("drawer") == "1"
            sendPrint(text, openDrawer)
        }
    }

    private fun sendPrint(text: String, openDrawer: Boolean) {
        val printerHost = prefs.getString("host", "")?.trim().orEmpty()
        val printerPort = prefs.getInt("port", 9100)
        if (printerHost.isBlank()) { status.text = "Set the printer IP first."; return }
        status.text = "Sending…"
        thread {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(printerHost, printerPort), 3000)
                    socket.soTimeout = 3000
                    val out = ByteArrayOutputStream()
                    out.write(byteArrayOf(0x1B, 0x40)) // ESC @ initialize
                    if (text.isNotBlank()) {
                        out.write(text.replace("GYD", "GYD").toByteArray(Charsets.UTF_8))
                        out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                        out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03)) // GS V cut
                    }
                    if (openDrawer) out.write(byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())) // ESC p pin 2
                    socket.getOutputStream().use { stream -> stream.write(out.toByteArray()); stream.flush() }
                }
                runOnUiThread { status.text = if (openDrawer && text.isBlank()) "Drawer command sent." else "Receipt sent to printer." }
            } catch (e: Exception) {
                runOnUiThread { status.text = "Printer error: ${e.message ?: "connection failed"}" }
            }
        }
    }
}
