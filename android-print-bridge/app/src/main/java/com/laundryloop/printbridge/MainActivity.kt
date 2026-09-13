package com.laundryloop.printbridge

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.SocketChannel
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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        root.addView(TextView(this).apply { text = "Laundry Loop Printer"; textSize = 24f })
        root.addView(TextView(this).apply { text = "Direct ESC/POS network printing" })
        root.addView(TextView(this).apply {
            text = "Powered by SnapNest Solutions"
            textSize = 12f
            alpha = 0.68f
            setPadding(0, 4, 0, 16)
        })

        host = EditText(this).apply { hint = "Printer IP"; setText(prefs.getString("host", "192.168.1.87")) }
        port = EditText(this).apply { hint = "Port"; inputType = 2; setText(prefs.getInt("port", 9100).toString()) }
        status = TextView(this).apply { text = "Ready for direct Laundry Loop receipt printing." }

        val save = Button(this).apply {
            text = "Save printer"
            setOnClickListener { savePrinter(); status.text = "Printer settings saved." }
        }
        val test = Button(this).apply {
            text = "Test print"
            setOnClickListener {
                savePrinter()
                sendPrint(
                    text = "THE LAUNDRY LOOP\nPrinter connection test\nFresh. Folded. Done.",
                    openDrawer = false,
                    finishWhenDone = false,
                    printedOrder = null,
                )
            }
        }
        val drawer = Button(this).apply {
            text = "Test cash drawer"
            setOnClickListener {
                savePrinter()
                sendPrint("", true, false, null)
            }
        }

        listOf(host, port, save, test, drawer, status).forEach(root::addView)
        root.addView(TextView(this).apply {
            text = "Smart Software • Smart Business Solutions"
            textSize = 11f
            alpha = 0.55f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 24, 0, 0)
        })
        setContentView(root)
    }

    private fun savePrinter() {
        prefs.edit()
            .putString("host", host.text.toString().trim())
            .putInt("port", port.text.toString().toIntOrNull() ?: 9100)
            .apply()
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "laundryloop-print" || uri.host != "print") return

        val mode = uri.getQueryParameter("mode")?.lowercase() ?: "receipt"
        if (mode !in setOf("receipt", "tag")) {
            status.text = "Unsupported print request."
            return
        }

        val rawText = uri.getQueryParameter("text").orEmpty()
        val text = sanitizeReceipt(rawText)
        if (text.isBlank()) {
            status.text = "Receipt request was empty."
            return
        }

        val order = sanitizeOrderCode(uri.getQueryParameter("order"))
        val payment = uri.getQueryParameter("payment")?.trim()?.lowercase().orEmpty()
        val isFirstSuccessfulPrint = order != null && !wasPrinted(order)
        val openDrawer = mode == "receipt" && payment == "cash" && isFirstSuccessfulPrint

        status.text = "Sending directly to Rongta…"
        sendPrint(
            text = text,
            openDrawer = openDrawer,
            finishWhenDone = true,
            printedOrder = if (mode == "receipt") order else null,
        )
    }

    private fun sanitizeOrderCode(value: String?): String? {
        val cleaned = value?.trim()?.uppercase().orEmpty()
        if (cleaned.length !in 4..40) return null
        if (!cleaned.matches(Regex("[A-Z0-9-]+"))) return null
        return cleaned
    }

    private fun sanitizeReceipt(value: String): String {
        val normalized = value
            .replace('×', 'x')
            .replace('−', '-')
            .replace('–', '-')
            .replace('—', '-')
            .replace('·', '-')
            .replace('’', '\'')
            .replace('“', '"')
            .replace('”', '"')

        val safe = buildString {
            normalized.take(MAX_INPUT_CHARS).forEach { ch ->
                when {
                    ch == '\n' || ch == '\r' || ch == '\t' -> append(ch)
                    ch.code in 32..126 -> append(ch)
                    else -> append('?')
                }
            }
        }

        return safe
            .replace("\r\n", "\n")
            .replace('\r', '\n')
            .lines()
            .flatMap { wrapLine(it.trimEnd(), RECEIPT_COLUMNS) }
            .joinToString("\n")
            .trim()
    }

    private fun wrapLine(line: String, width: Int): List<String> {
        if (line.length <= width) return listOf(line)
        val result = mutableListOf<String>()
        var remaining = line
        while (remaining.length > width) {
            val splitAt = remaining.substring(0, width + 1).lastIndexOf(' ').let { if (it <= 0) width else it }
            result += remaining.substring(0, splitAt).trimEnd()
            remaining = remaining.substring(splitAt).trimStart()
        }
        result += remaining
        return result
    }

    private fun wasPrinted(order: String): Boolean = prefs.getStringSet("printed_orders", emptySet())?.contains(order) == true

    private fun markPrinted(order: String) {
        val existing = prefs.getStringSet("printed_orders", emptySet()).orEmpty().toMutableSet()
        existing += order
        // Keep this bounded on the dedicated tablet. Old order codes only matter
        // for preventing accidental repeat drawer pulses, not accounting history.
        val bounded = existing.takeLast(MAX_TRACKED_PRINTED_ORDERS).toSet()
        prefs.edit().putStringSet("printed_orders", bounded).apply()
    }

    private fun sendPrint(text: String, openDrawer: Boolean, finishWhenDone: Boolean, printedOrder: String?) {
        val printerHost = prefs.getString("host", "192.168.1.87")?.trim().orEmpty()
        val printerPort = prefs.getInt("port", 9100)
        if (printerHost.isBlank()) {
            status.text = "Set the printer IP first."
            return
        }

        status.text = "Sending to $printerHost:$printerPort…"
        thread(name = "LaundryLoopDirectPrint") {
            try {
                val payload = buildPayload(text, openDrawer)
                SocketChannel.open().use { channel ->
                    channel.configureBlocking(false)
                    channel.socket().tcpNoDelay = true
                    channel.connect(InetSocketAddress(printerHost, printerPort))

                    val connectDeadline = SystemClock.elapsedRealtime() + CONNECT_TIMEOUT_MS
                    while (!channel.finishConnect()) {
                        if (SystemClock.elapsedRealtime() > connectDeadline) error("Could not connect to printer")
                        Thread.sleep(10)
                    }

                    val buffer = ByteBuffer.wrap(payload)
                    val writeDeadline = SystemClock.elapsedRealtime() + WRITE_TIMEOUT_MS
                    while (buffer.hasRemaining()) {
                        val written = channel.write(buffer)
                        if (written == 0) {
                            if (SystemClock.elapsedRealtime() > writeDeadline) error("Printer stopped accepting data")
                            Thread.sleep(5)
                        }
                    }
                }

                if (printedOrder != null) markPrinted(printedOrder)
                runOnUiThread {
                    status.text = if (openDrawer) "Receipt printed; cash drawer opened." else "Receipt sent to printer."
                    if (finishWhenDone) finish()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    status.text = "Printer error: ${e.message ?: "connection failed"}"
                    // Leave the app open on failure so staff can see the error and retry.
                }
            }
        }
    }

    private fun buildPayload(text: String, openDrawer: Boolean): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40)) // initialize
        if (text.isNotBlank()) {
            out.write(text.toByteArray(Charsets.US_ASCII))
            out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
            out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03)) // partial cut
        }
        if (openDrawer) out.write(byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte()))
        return out.toByteArray()
    }

    companion object {
        private const val RECEIPT_COLUMNS = 48
        private const val MAX_INPUT_CHARS = 6000
        private const val MAX_TRACKED_PRINTED_ORDERS = 5000
        private const val CONNECT_TIMEOUT_MS = 3000L
        private const val WRITE_TIMEOUT_MS = 5000L
    }
}
