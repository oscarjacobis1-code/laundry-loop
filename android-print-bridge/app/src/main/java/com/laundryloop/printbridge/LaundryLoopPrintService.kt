package com.laundryloop.printbridge

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.print.PrintAttributes
import android.print.PrinterCapabilitiesInfo
import android.print.PrinterId
import android.print.PrinterInfo
import android.printservice.PrintJob
import android.printservice.PrintService
import android.printservice.PrinterDiscoverySession
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.roundToInt

class LaundryLoopPrintService : PrintService() {
    private val prefs by lazy { getSharedPreferences("printer", MODE_PRIVATE) }

    override fun onCreatePrinterDiscoverySession(): PrinterDiscoverySession = object : PrinterDiscoverySession() {
        override fun onStartPrinterDiscovery(priorityList: MutableList<PrinterId>) {
            addPrinters(listOf(buildPrinter()))
        }

        override fun onStopPrinterDiscovery() = Unit
        override fun onValidatePrinters(printerIds: MutableList<PrinterId>) {
            addPrinters(listOf(buildPrinter()))
        }
        override fun onStartPrinterStateTracking(printerId: PrinterId) {
            if (printerId == generatePrinterId(PRINTER_LOCAL_ID)) addPrinters(listOf(buildPrinter()))
        }
        override fun onStopPrinterStateTracking(printerId: PrinterId) = Unit
        override fun onDestroy() = Unit
    }

    override fun onPrintJobQueued(printJob: PrintJob) {
        if (!printJob.start()) return
        thread(name = "LaundryLoopPrint") {
            try {
                val document = printJob.document ?: error("No print document received")
                val data = document.data ?: error("No print data received")
                val bytes = renderPdfToEscPos(data)
                sendToPrinter(bytes)
                printJob.complete()
            } catch (e: Exception) {
                printJob.fail(e.message ?: "Laundry Loop printer failed")
            }
        }
    }

    override fun onRequestCancelPrintJob(printJob: PrintJob) {
        printJob.cancel()
    }

    private fun buildPrinter(): PrinterInfo {
        val printerId = generatePrinterId(PRINTER_LOCAL_ID)
        val media = PrintAttributes.MediaSize("ROLL_80MM", "80 mm receipt roll", 3150, 20000)
        val resolution = PrintAttributes.Resolution("203DPI", "203 dpi", 203, 203)
        val capabilities = PrinterCapabilitiesInfo.Builder(printerId)
            .addMediaSize(media, true)
            .addResolution(resolution, true)
            .setColorModes(PrintAttributes.COLOR_MODE_MONOCHROME, PrintAttributes.COLOR_MODE_MONOCHROME)
            .setDuplexModes(PrintAttributes.DUPLEX_MODE_NONE, PrintAttributes.DUPLEX_MODE_NONE)
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .build()

        return PrinterInfo.Builder(printerId, "Laundry Loop Rongta", PrinterInfo.STATUS_IDLE)
            .setDescription("80 mm ESC/POS printer · ${printerHost()}:${printerPort()}")
            .setCapabilities(capabilities)
            .build()
    }

    private fun renderPdfToEscPos(fd: android.os.ParcelFileDescriptor): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40)) // initialize
        PdfRenderer(fd).use { renderer ->
            for (index in 0 until renderer.pageCount) {
                renderer.openPage(index).use { page ->
                    val scale = PRINT_WIDTH_DOTS.toFloat() / page.width.toFloat()
                    val height = (page.height * scale).roundToInt().coerceAtLeast(1)
                    val bitmap = Bitmap.createBitmap(PRINT_WIDTH_DOTS, height, Bitmap.Config.ARGB_8888)
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    out.write(bitmapToEscPos(bitmap))
                    bitmap.recycle()
                }
            }
        }
        out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
        out.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03)) // cut
        return out.toByteArray()
    }

    private fun bitmapToEscPos(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val widthBytes = (width + 7) / 8
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(
            0x1D, 0x76, 0x30, 0x00,
            (widthBytes and 0xFF).toByte(), ((widthBytes shr 8) and 0xFF).toByte(),
            (height and 0xFF).toByte(), ((height shr 8) and 0xFF).toByte()
        ))

        for (y in 0 until height) {
            for (xByte in 0 until widthBytes) {
                var value = 0
                for (bit in 0 until 8) {
                    val x = xByte * 8 + bit
                    if (x >= width) continue
                    val pixel = bitmap.getPixel(x, y)
                    val alpha = Color.alpha(pixel)
                    val gray = (Color.red(pixel) * 30 + Color.green(pixel) * 59 + Color.blue(pixel) * 11) / 100
                    if (alpha > 32 && gray < 180) value = value or (0x80 shr bit)
                }
                out.write(value)
            }
        }
        return out.toByteArray()
    }

    private fun sendToPrinter(bytes: ByteArray) {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(printerHost(), printerPort()), 4000)
            socket.soTimeout = 4000
            socket.getOutputStream().use { stream ->
                stream.write(bytes)
                stream.flush()
            }
        }
    }

    private fun printerHost(): String = prefs.getString("host", "192.168.1.87")?.trim().orEmpty()
    private fun printerPort(): Int = prefs.getInt("port", 9100)

    companion object {
        private const val PRINTER_LOCAL_ID = "rongta-80mm"
        private const val PRINT_WIDTH_DOTS = 576
    }
}
