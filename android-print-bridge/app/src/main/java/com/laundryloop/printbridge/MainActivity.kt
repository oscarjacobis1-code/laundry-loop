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
import java.net.URLEncoder
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
                    mode = "receipt",
                )
            }
        }
        val drawer = Button(this).apply {
            text = "Test cash drawer"
            setOnClickListener {
                savePrinter()
                sendPrint("", true, false, null, "receipt")
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
        val suppressDrawer = uri.getQueryParameter("suppress_drawer") == "1"
        val isFirstSuccessfulPrint = order != null && !wasPrinted(order)
        val openDrawer = mode == "receipt" && payment == "cash" && isFirstSuccessfulPrint && !suppressDrawer

        status.text = "Sending directly to Rongta…"
        sendPrint(
            text = text,
            openDrawer = openDrawer,
            finishWhenDone = true,
            printedOrder = if (mode == "receipt") order else null,
            mode = mode,
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
        val bounded = existing.toList().takeLast(MAX_TRACKED_PRINTED_ORDERS).toSet()
        prefs.edit().putStringSet("printed_orders", bounded).apply()
    }

    private fun sendPrint(text: String, openDrawer: Boolean, finishWhenDone: Boolean, printedOrder: String?, mode: String) {
        val printerHost = prefs.getString("host", "192.168.1.87")?.trim().orEmpty()
        val printerPort = prefs.getInt("port", 9100)
        if (printerHost.isBlank()) {
            status.text = "Set the printer IP first."
            return
        }

        status.text = "Sending to $printerHost:$printerPort…"
        thread(name = "LaundryLoopDirectPrint") {
            try {
                val payload = buildPayload(text, openDrawer, printedOrder, mode)
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
                    status.text = if (openDrawer) "Two receipts printed; cash drawer opened." else "Two receipts sent to printer."
                    if (finishWhenDone) finish()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    status.text = "Printer error: ${e.message ?: "connection failed"}"
                }
            }
        }
    }

    private fun buildPayload(text: String, openDrawer: Boolean, orderCode: String?, mode: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40))
        out.write(byteArrayOf(0x1B, 0x4D, 0x00))

        if (text.isNotBlank()) {
            if (mode == "receipt") {
                repeat(RECEIPT_COPIES) {
                    writeStyledReceipt(out, text, orderCode)
                    writeWebsiteQr(out, orderCode)
                    out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                    out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03))
                }
            } else {
                out.write(byteArrayOf(0x1B, 0x61, 0x01))
                out.write(text.toByteArray(Charsets.US_ASCII))
                out.write(byteArrayOf(0x1B, 0x61, 0x00))
                out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03))
            }
        }
        if (openDrawer) out.write(byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte()))
        return out.toByteArray()
    }

    private fun writeStyledReceipt(out: ByteArrayOutputStream, text: String, orderCode: String?) {
        val border = "+" + "-".repeat(RECEIPT_COLUMNS) + "+"
        val rawLines = text.lines().flatMap { wrapLine(it.trim(), RECEIPT_COLUMNS) }
        val totalPounds = calculateTotalPounds(rawLines)
        val withWeight = if (totalPounds > 0.0) insertTotalWeight(rawLines, totalPounds) else rawLines
        var lines = withWeight.map { line ->
            if (line.equals("Laundry Loop", ignoreCase = true)) "THE LAUNDRY LOOP" else line
        }
        val initialPaymentIndex = lines.indexOfFirst { it.startsWith("Payment:", ignoreCase = true) }
        val customerPhoneIndex = lines.indexOfFirst { PHONE_LINE.matches(it.trim()) }
        val itemStart = if (customerPhoneIndex >= 0) customerPhoneIndex + 1 else -1
        val itemEnd = if (initialPaymentIndex > itemStart) initialPaymentIndex else -1
        if (itemStart >= 0 && itemEnd > itemStart) {
            lines = formatItemColumns(lines, itemStart, itemEnd)
        }
        val paymentIndex = lines.indexOfFirst { it.startsWith("Payment:", ignoreCase = true) }
        val finalItemEnd = if (paymentIndex > itemStart) paymentIndex else -1

        out.write(byteArrayOf(0x1B, 0x61, 0x01))
        writeAsciiLine(out, border)

        lines.forEachIndexed { index, line ->
            val isOrderCode = orderCode != null && line.equals(orderCode, ignoreCase = true)
            val isItemSection = itemStart >= 0 && finalItemEnd > itemStart && index in itemStart until finalItemEnd

            if (isOrderCode) {
                out.write(byteArrayOf(0x1B, 0x61, 0x01))
                out.write(byteArrayOf(0x1B, 0x45, 0x01))
                out.write(byteArrayOf(0x1D, 0x21, 0x10))
                writeAsciiLine(out, line)
                out.write(byteArrayOf(0x1D, 0x21, 0x00))
                out.write(byteArrayOf(0x1B, 0x45, 0x00))
                return@forEachIndexed
            }

            val content = if (isItemSection && line.isNotBlank()) {
                line.take(RECEIPT_COLUMNS).padEnd(RECEIPT_COLUMNS)
            } else {
                centerText(line, RECEIPT_COLUMNS)
            }
            writeAsciiLine(out, "|$content|")
        }

        writeAsciiLine(out, border)
        out.write(byteArrayOf(0x1B, 0x61, 0x00))
    }

    private fun writeWebsiteQr(out: ByteArrayOutputStream, orderCode: String?) {
        val targetUrl = if (orderCode.isNullOrBlank()) {
            WEBSITE_URL
        } else {
            WEBSITE_URL + "/?track=" + URLEncoder.encode(orderCode.trim(), "UTF-8")
        }
        val data = targetUrl.toByteArray(Charsets.US_ASCII)
        val storeLength = data.size + 3
        val pL = (storeLength and 0xFF).toByte()
        val pH = ((storeLength shr 8) and 0xFF).toByte()

        out.write(byteArrayOf(0x1B, 0x61, 0x01))
        writeAsciiLine(out, if (orderCode.isNullOrBlank()) WEBSITE_DISPLAY else "Scan to track order")
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00))
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05))
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31))
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30))
        out.write(data)
        out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30))
        out.write(0x0A)
        writeAsciiLine(out, WEBSITE_DISPLAY)
        out.write(byteArrayOf(0x1B, 0x61, 0x00))
    }

    private fun calculateTotalPounds(lines: List<String>): Double = lines.sumOf { line ->
        val match = LB_ITEM_LINE.matchEntire(line.trim())
        match?.groupValues?.getOrNull(2)?.toDoubleOrNull() ?: 0.0
    }

    private fun insertTotalWeight(lines: List<String>, totalPounds: Double): List<String> {
        val result = lines.toMutableList()
        val insertAt = result.indexOfFirst {
            it.equals("Discount", ignoreCase = true) || it.equals("Total", ignoreCase = true) || it.startsWith("Payment:", ignoreCase = true)
        }.let { if (it >= 0) it else result.size }
        result.add(insertAt, "Total weight: ${formatQuantity(totalPounds)} ${poundLabel(totalPounds.toString())}")
        return result
    }

    private fun formatItemColumns(lines: List<String>, start: Int, end: Int): List<String> {
        val prefix = lines.take(start)
        val section = lines.subList(start, end)
        val suffix = lines.drop(end)
        val formatted = mutableListOf<String>()
        var index = 0

        while (index < section.size) {
            val current = section[index].trim()
            val next = section.getOrNull(index + 1)?.trim().orEmpty()
            if (current.isNotBlank() && MONEY_LINE.matches(next)) {
                formatted += twoColumn(current, next)
                index += 2
            } else {
                formatted += current
                index += 1
            }
        }

        return prefix + formatted + suffix
    }

    private fun twoColumn(leftValue: String, rightValue: String): String {
        val right = rightValue.take(16)
        val maxLeft = (RECEIPT_COLUMNS - right.length - 1).coerceAtLeast(1)
        val left = leftValue.take(maxLeft)
        val spaces = (RECEIPT_COLUMNS - left.length - right.length).coerceAtLeast(1)
        return left + " ".repeat(spaces) + right
    }

    private fun formatQuantity(value: Double): String = if (value % 1.0 == 0.0) value.toInt().toString() else value.toString().trimEnd('0').trimEnd('.')

    private fun poundLabel(quantity: String): String {
        val value = quantity.toDoubleOrNull()
        return if (value == 1.0) "lb" else "lbs"
    }

    private fun centerText(value: String, width: Int): String {
        val clipped = value.take(width)
        val left = ((width - clipped.length) / 2).coerceAtLeast(0)
        val right = (width - clipped.length - left).coerceAtLeast(0)
        return " ".repeat(left) + clipped + " ".repeat(right)
    }

    private fun writeAsciiLine(out: ByteArrayOutputStream, value: String) {
        out.write(value.toByteArray(Charsets.US_ASCII))
        out.write(0x0A)
    }

    companion object {
        private const val RECEIPT_COLUMNS = 44
        private const val RECEIPT_COPIES = 2
        private const val MAX_INPUT_CHARS = 6000
        private const val MAX_TRACKED_PRINTED_ORDERS = 5000
        private const val CONNECT_TIMEOUT_MS = 3000L
        private const val WRITE_TIMEOUT_MS = 5000L
        private const val WEBSITE_URL = "https://thelaundryloop.net"
        private const val WEBSITE_DISPLAY = "thelaundryloop.net"
        private val PHONE_LINE = Regex("^[+0-9][0-9 ()-]{6,}$")
        private val LB_ITEM_LINE = Regex("^(.+?)\\s+x\\s+([0-9]+(?:\\.[0-9]+)?)\\s+(?:lb|lbs)$", RegexOption.IGNORE_CASE)
        private val MONEY_LINE = Regex("^-?\\s*GYD\\s+.+$", RegexOption.IGNORE_CASE)
    }
}
