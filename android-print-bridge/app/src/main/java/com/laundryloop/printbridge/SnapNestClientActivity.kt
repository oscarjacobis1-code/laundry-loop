package com.laundryloop.printbridge

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class SnapNestClientActivity : AppCompatActivity() {
    private lateinit var proofStatus: TextView
    private lateinit var systemStatus: TextView
    private var selectedProof: Uri? = null

    private val proofPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        selectedProof = uri
        proofStatus.text = if (uri == null) {
            "No payment proof selected."
        } else {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: Exception) {
            }
            "Payment proof selected and ready to submit."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    private fun buildUi() {
        val density = resources.displayMetrics.density
        val pad = (20 * density).toInt()
        val gap = (10 * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "SnapNest Client"
            textSize = 28f
        })
        root.addView(TextView(this).apply {
            text = "The Laundry Loop"
            textSize = 17f
            alpha = 0.72f
            setPadding(0, 2, 0, pad)
        })

        systemStatus = TextView(this).apply {
            text = "System status: Ready"
            textSize = 16f
            setPadding(0, 0, 0, gap)
        }
        root.addView(systemStatus)

        val printer = Button(this).apply {
            text = "Printer & Device Status"
            setOnClickListener {
                startActivity(Intent(this@SnapNestClientActivity, MainActivity::class.java))
            }
        }

        val pos = Button(this).apply {
            text = "Open Laundry Loop POS"
            setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://thelaundryloop.net/staff"))
                startActivity(intent)
            }
        }

        val billingTitle = TextView(this).apply {
            text = "Billing"
            textSize = 21f
            setPadding(0, pad, 0, gap)
        }

        val billingInfo = TextView(this).apply {
            text = "Payment details will be securely configured by SnapNest.\n\nMMG: Not configured\nBank transfer: Not configured\n\nPayment proof can be JPG, PNG, WebP or PDF."
            textSize = 15f
        }

        val chooseProof = Button(this).apply {
            text = "Choose Payment Proof"
            setOnClickListener {
                proofPicker.launch(arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf"))
            }
        }

        proofStatus = TextView(this).apply {
            text = "No payment proof selected."
            setPadding(0, gap, 0, gap)
        }

        val submitProof = Button(this).apply {
            text = "Submit Payment Proof"
            setOnClickListener {
                proofStatus.text = if (selectedProof == null) {
                    "Choose a payment proof first."
                } else {
                    "Proof is ready. Secure upload will activate when SnapNest billing is connected."
                }
            }
        }

        val support = Button(this).apply {
            text = "SnapNest Support"
            setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://snapnestsolutions.com"))
                startActivity(intent)
            }
        }

        val appSettings = Button(this).apply {
            text = "App Settings"
            setOnClickListener {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            }
        }

        listOf(printer, pos, billingTitle, billingInfo, chooseProof, proofStatus, submitProof, support, appSettings).forEach {
            root.addView(it)
        }

        root.addView(TextView(this).apply {
            text = "Smart Software • Smart Business Solutions"
            textSize = 11f
            alpha = 0.55f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, pad, 0, 0)
        })

        setContentView(root)
    }
}
