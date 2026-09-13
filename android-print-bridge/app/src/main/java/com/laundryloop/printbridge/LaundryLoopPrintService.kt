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
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.min
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
                printPdfToPrinter(data)
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

    private fun printPdfToPrinter(fd: android.os.ParcelFileDescriptor) {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(printerHost(), printerPort()), CONNECT_TIMEOUT_MS)
            socket.soTimeout = READ_TIMEOUT_MS
            socket.tcpNoDelay = true

            val stream = socket.getOutputStream()
            stream.write(byteArrayOf(0x1B, 0x40))
            stream.flush()

            PdfRenderer(fd).use { renderer ->
                for (index in 0 until renderer.pageCount) {
                    renderer.openPage(index).use { page ->
                        val scale = PRINT_WIDTH_DOTS.toFloat() / page.width.toFloat()
                        val fullHeight = (page.height * scale).roundToInt().coerceAtLeast(1)
                        val bitmap = Bitmap.createBitmap(PRINT_WIDTH_DOTS, fullHeight, Bitmap.Config.ARGB_8888)
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)

                        val lastDarkRow = findLastNonWhiteRow(bitmap)
                        if (lastDarkRow >= 0) {
                            var top = 0
                            while (top <= lastDarkRow) {
                                val bandHeight = min(BAND_HEIGHT_ROWS, lastDarkRow - top + 1)
                                val band = Bitmap.createBitmap(bitmap, 0, top, PRINT_WIDTH_DOTS, bandHeight)
                                val bytes = bitmapBandToEscPos(band)
                                band.recycle()

                                stream.write(bytes)
                                stream.flush()
                                Thread.sleep(BAND_PAUSE_MS)
                                top += bandHeight
                            }
                        }

                        bitmap.recycle()
                    }
                }
            }

            stream.write(byteArrayOf(0x0A, 0x0A, 0x0A))
            stream.write(byteArrayOf(0x1D, 0x56, 0x41, 0x03))
            stream.flush()
        }
    }

    private fun findLastNonWhiteRow(bitmap: Bitmap): Int {
        for (y in bitmap.height - 1 downTo 0) {
            var x = 0
            while (x < bitmap.width) {
                val pixel = bitmap.getPixel(x, y)
                val alpha = Color.alpha(pixel)
                val gray = (Color.red(pixel) * 30 + Color.green(pixel) * 59 + Color.blue(pixel) * 11) / 100
                if (alpha > 32 && gray < 245) return y
                x += 4
            }
        }
        return -1
    }

    private fun bitmapBandToEscPos(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val widthBytes = (width + 7) / 8
        val output = ByteArray(8 + widthBytes * height)
        output[0] = 0x1D
        output[1] = 0x76
        output[2] = 0x30
        output[3] = 0x00
        output[4] = (widthBytes and 0xFF).toByte()
        output[5] = ((widthBytes shr 8) and 0xFF).toByte()
        output[6] = (height and 0xFF).toByte()
        output[7] = ((height shr 8) and 0xFF).toByte()

        var offset = 8
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
                output[offset++] = value.toByte()
            }
        }
        return output
    }

    private fun printerHost(): String = prefs.getString("host", "192.168.1.87")?.trim().orEmpty()
    private fun printerPort(): Int = prefs.getInt("port", 9100)

    companion object {
        private const val PRINTER_LOCAL_ID = "rongta-80mm"
        private const val PRINT_WIDTH_DOTS = 576
        private const val BAND_HEIGHT_ROWS = 96
        private const val BAND_PAUSE_MS = 35L
        private const val CONNECT_TIMEOUT_MS = 3000
        private const val READ_TIMEOUT_MS = 3000
    }
}
