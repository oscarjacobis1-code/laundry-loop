package com.laundryloop.printbridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.net.InetSocketAddress
import java.net.Socket
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

class SnapNestClientActivity : AppCompatActivity() {
    private val printerPrefs by lazy { getSharedPreferences("printer", MODE_PRIVATE) }
    private lateinit var status: TextView
    private lateinit var printerStatus: TextView
    private lateinit var internetStatus: TextView
    private lateinit var lastPrintStatus: TextView
    private lateinit var alerts: TextView
    private lateinit var billingInfo: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var amount: EditText
    private lateinit var reference: EditText
    private var session: SnapNestBackend.Session? = null
    private var config: SnapNestBackend.BillingConfig? = null
    private var proofUri: Uri? = null

    private val proofPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        proofUri = uri
        status.text = if (uri == null) "No payment proof selected." else "Payment proof selected."
        if (uri != null) {
            runCatching {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    override fun onResume() {
        super.onResume()
        refreshDeviceDashboard()
    }

    private fun buildUi() {
        val d = resources.displayMetrics.density
        val pad = (20 * d).toInt()
        val gap = (10 * d).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply { text = "SnapNest Client"; textSize = 28f })
        root.addView(TextView(this).apply {
            text = "The Laundry Loop"
            textSize = 17f
            alpha = 0.72f
            setPadding(0, 2, 0, pad)
        })

        status = TextView(this).apply {
            text = "System status: Ready"
            textSize = 15f
            setPadding(0, 0, 0, gap)
        }
        root.addView(status)

        root.addView(TextView(this).apply {
            text = "System Overview"
            textSize = 21f
            setPadding(0, gap, 0, gap)
        })

        printerStatus = dashboardLine("Printer", "Checking…")
        internetStatus = dashboardLine("Internet", "Checking…")
        lastPrintStatus = dashboardLine("Last print", "No successful print recorded yet.")
        alerts = dashboardLine("Alerts", "Checking system…")
        listOf(printerStatus, internetStatus, lastPrintStatus, alerts).forEach(root::addView)

        root.addView(Button(this).apply {
            text = "Refresh Device Status"
            setOnClickListener { refreshDeviceDashboard() }
        })
        root.addView(Button(this).apply {
            text = "Printer Settings & Test"
            setOnClickListener { startActivity(Intent(this@SnapNestClientActivity, MainActivity::class.java)) }
        })
        root.addView(Button(this).apply {
            text = "Open Laundry Loop POS"
            setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://thelaundryloop.net/staff"))) }
        })
        root.addView(Button(this).apply {
            text = "Open Admin"
            setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://thelaundryloop.net/admin"))) }
        })

        root.addView(TextView(this).apply {
            text = "SnapNest Billing"
            textSize = 21f
            setPadding(0, pad, 0, gap)
        })

        email = EditText(this).apply {
            hint = "Manager/Admin email"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            maxLines = 1
        }
        password = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            maxLines = 1
        }
        root.addView(email)
        root.addView(password)

        root.addView(Button(this).apply {
            text = "Sign In & Load Billing"
            setOnClickListener { signInAndLoad() }
        })

        billingInfo = TextView(this).apply {
            text = "Sign in with an authorized Laundry Loop manager/admin account to view SnapNest payment details."
            textSize = 15f
            setPadding(0, gap, 0, gap)
        }
        root.addView(billingInfo)

        root.addView(Button(this).apply {
            text = "Copy MMG Number"
            setOnClickListener { copyValue("MMG number", config?.mmgNumber) }
        })
        root.addView(Button(this).apply {
            text = "Copy Bank Account Number"
            setOnClickListener { copyValue("Bank account number", config?.bankAccountNumber) }
        })

        amount = EditText(this).apply {
            hint = "Amount paid (GYD)"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            maxLines = 1
        }
        reference = EditText(this).apply { hint = "Payment reference"; maxLines = 1 }
        root.addView(amount)
        root.addView(reference)

        root.addView(Button(this).apply {
            text = "Choose Payment Proof"
            setOnClickListener {
                proofPicker.launch(arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf"))
            }
        })
        root.addView(Button(this).apply {
            text = "Submit Payment Proof"
            setOnClickListener { submitProof() }
        })

        root.addView(Button(this).apply {
            text = "WhatsApp SnapNest Support"
            setOnClickListener {
                val digits = config?.supportWhatsapp?.filter(Char::isDigit)
                if (digits.isNullOrBlank()) status.text = "Load billing first to open support."
                else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")))
            }
        })
        root.addView(Button(this).apply {
            text = "App Settings"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                })
            }
        })

        root.addView(TextView(this).apply {
            text = "Smart Software • Smart Business Solutions"
            textSize = 11f
            alpha = 0.55f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, pad, 0, 0)
        })

        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun dashboardLine(label: String, value: String): TextView = TextView(this).apply {
        text = label + ": " + value
        textSize = 15f
        setPadding(0, 6, 0, 6)
    }

    private fun refreshDeviceDashboard() {
        val internetOnline = hasInternetConnection()
        internetStatus.text = if (internetOnline) "Internet: Online" else "Internet: Offline"

        val lastAt = printerPrefs.getLong("last_successful_print_at", 0L)
        val lastOrder = printerPrefs.getString("last_successful_print_order", "").orEmpty()
        lastPrintStatus.text = if (lastAt > 0L) {
            val whenText = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastAt))
            if (lastOrder.isBlank()) "Last print: " + whenText else "Last print: " + whenText + " • " + lastOrder
        } else {
            "Last print: No successful print recorded yet."
        }

        val host = printerPrefs.getString("host", "192.168.1.87")?.trim().orEmpty()
        val port = printerPrefs.getInt("port", 9100)
        printerStatus.text = "Printer: Checking " + host + ":" + port + "…"
        alerts.text = if (internetOnline) "Alerts: Checking printer…" else "Alerts: Internet connection is offline."

        thread(name = "SnapNestPrinterHealth") {
            val online = canReachPrinter(host, port)
            printerPrefs.edit().putString("last_printer_status", if (online) "online" else "offline").apply()
            runOnUiThread {
                printerStatus.text = if (online) "Printer: Online • " + host + ":" + port else "Printer: Offline • " + host + ":" + port
                val warnings = mutableListOf<String>()
                if (!internetOnline) warnings += "Internet offline"
                if (!online) warnings += "Printer offline"
                val lastError = printerPrefs.getString("last_printer_error", "").orEmpty()
                if (!online && lastError.isNotBlank()) warnings += "Last printer error: " + lastError
                alerts.text = if (warnings.isEmpty()) "Alerts: No active warnings." else "Alerts: " + warnings.joinToString(" • ")
                status.text = if (warnings.isEmpty()) "System status: Ready" else "System status: Attention needed"
            }
        }
    }

    private fun hasInternetConnection(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun canReachPrinter(host: String, port: Int): Boolean {
        if (host.isBlank()) return false
        return runCatching {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 1600)
            }
            true
        }.getOrDefault(false)
    }

    private fun signInAndLoad() {
        val e = email.text.toString().trim()
        val p = password.text.toString()
        if (e.isBlank() || p.isBlank()) {
            status.text = "Enter the manager/admin email and password."
            return
        }
        status.text = "Signing in…"
        Thread {
            runCatching {
                val s = SnapNestBackend.signIn(e, p)
                val c = SnapNestBackend.fetchBilling(s)
                session = s
                config = c
                c
            }.onSuccess { c ->
                runOnUiThread {
                    password.text.clear()
                    val bankLast4 = c.bankAccountNumber?.takeLast(4)?.padStart(4, '•') ?: "Not configured"
                    billingInfo.text = buildString {
                        append("Amount due: ${c.currency} ${"%,.0f".format(c.amountDue)}")
                        if (!c.dueDate.isNullOrBlank()) append("\nDue: ${c.dueDate}")
                        append("\n\nMMG\n${c.mmgName ?: ""}\n${c.mmgNumber ?: "Not configured"}")
                        append("\n\n${c.bankName ?: "Bank Transfer"}\n${c.bankAccountName ?: ""}")
                        append("\n${c.bankAccountType ?: ""} · ${c.currency}")
                        append("\nAccount ••••••••$bankLast4")
                        if (!c.bankBranch.isNullOrBlank()) append("\n${c.bankBranch} Branch")
                    }
                    status.text = "Billing loaded securely."
                }
            }.onFailure { ex -> runOnUiThread { status.text = "Could not load billing: ${ex.message}" } }
        }.start()
    }

    private fun submitProof() {
        val s = session
        val uri = proofUri
        if (s == null) { status.text = "Sign in first."; return }
        if (uri == null) { status.text = "Choose a payment proof first."; return }
        val amt = amount.text.toString().trim().toDoubleOrNull()
        val ref = reference.text.toString().trim().takeIf { it.isNotBlank() }
        status.text = "Uploading payment proof…"
        Thread {
            runCatching { SnapNestBackend.uploadProof(s, contentResolver, uri, amt, ref) }
                .onSuccess {
                    runOnUiThread {
                        proofUri = null
                        amount.text.clear()
                        reference.text.clear()
                        status.text = "Payment submitted — Pending Verification."
                    }
                }
                .onFailure { ex -> runOnUiThread { status.text = "Upload failed: ${ex.message}" } }
        }.start()
    }

    private fun copyValue(label: String, value: String?) {
        if (value.isNullOrBlank()) { status.text = "Load billing first."; return }
        val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cb.setPrimaryClip(ClipData.newPlainText(label, value))
        status.text = "$label copied."
    }
}
