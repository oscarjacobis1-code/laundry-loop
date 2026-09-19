package com.snapnest.manager

import android.content.ContentResolver
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object SnapNestBackend {
    private const val BASE_URL = "https://coohutrnqcxjhkxprama.supabase.co"
    private const val API_KEY = "sb_publishable_WwvZpvMkiHM3YOLhwty85g_wGZKQ84e"

    data class Session(val accessToken: String, val userId: String)
    data class BillingConfig(
        val clientName: String, val amountDue: Double, val dueDate: String?,
        val mmgNumber: String?, val mmgName: String?, val bankName: String?,
        val bankAccountName: String?, val bankAccountNumber: String?,
        val bankAccountType: String?, val bankBranch: String?,
        val currency: String, val supportWhatsapp: String?
    )

    fun signIn(email: String, password: String): Session {
        val conn = request("$BASE_URL/auth/v1/token?grant_type=password", "POST", null)
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.outputStream.use { it.write(JSONObject().put("email", email).put("password", password).toString().toByteArray()) }
        val json = JSONObject(readResponse(conn))
        return Session(json.getString("access_token"), json.getJSONObject("user").getString("id"))
    }

    fun fetchBilling(session: Session): BillingConfig {
        val conn = request("$BASE_URL/rest/v1/snapnest_client_billing_config?client_key=eq.laundry-loop&select=*", "GET", session.accessToken)
        val arr = JSONArray(readResponse(conn))
        if (arr.length() == 0) error("Billing configuration is unavailable.")
        val o = arr.getJSONObject(0)
        return BillingConfig(
            o.optString("client_name", "The Laundry Loop"), o.optDouble("amount_due", 0.0),
            o.optNullable("due_date"), o.optNullable("mmg_number"), o.optNullable("mmg_name"),
            o.optNullable("bank_name"), o.optNullable("bank_account_name"), o.optNullable("bank_account_number"),
            o.optNullable("bank_account_type"), o.optNullable("bank_branch"), o.optString("currency", "GYD"),
            o.optNullable("support_whatsapp")
        )
    }

    fun uploadProof(session: Session, resolver: ContentResolver, uri: Uri, amount: Double?, reference: String?) {
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val ext = when (mime) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/webp" -> "webp"; "application/pdf" -> "pdf"; else -> "bin" }
        val path = "laundry-loop/${session.userId}/${System.currentTimeMillis()}.$ext"
        val encoded = path.split('/').joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8") }
        val upload = request("$BASE_URL/storage/v1/object/snapnest-payment-proofs/$encoded", "POST", session.accessToken)
        upload.setRequestProperty("Content-Type", mime)
        upload.setRequestProperty("x-upsert", "false")
        upload.doOutput = true
        resolver.openInputStream(uri)?.use { input -> upload.outputStream.use { output -> input.copyTo(output) } } ?: error("Unable to read payment proof.")
        readResponse(upload)

        val insert = request("$BASE_URL/rest/v1/snapnest_client_payment_submissions", "POST", session.accessToken)
        insert.setRequestProperty("Content-Type", "application/json")
        insert.setRequestProperty("Prefer", "return=minimal")
        insert.doOutput = true
        val payload = JSONObject().put("client_key", "laundry-loop").put("submitted_by", session.userId).put("proof_path", path)
        if (amount != null) payload.put("amount", amount)
        if (!reference.isNullOrBlank()) payload.put("reference", reference)
        insert.outputStream.use { it.write(payload.toString().toByteArray()) }
        readResponse(insert)
    }

    private fun request(url: String, method: String, token: String?): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 12000; readTimeout = 20000
            setRequestProperty("apikey", API_KEY)
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }

    private fun readResponse(conn: HttpURLConnection): String {
        val code = conn.responseCode
        val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) {
            val msg = runCatching { JSONObject(body).optString("msg").ifBlank { JSONObject(body).optString("message") } }.getOrNull()
            error(msg?.ifBlank { null } ?: "Request failed ($code).")
        }
        return body
    }

    private fun JSONObject.optNullable(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
}
