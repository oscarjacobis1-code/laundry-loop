package com.snapnest.manager

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.NumberFormat
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SnapNestManagerApp() }
    }
}

private enum class Tab(val label: String) { Home("Home"), Payments("Payments"), Manage("Manage"), Account("Account") }

private val Ink = Color(0xFF11233F)
private val Muted = Color(0xFF6E7B91)
private val Canvas = Color(0xFFF6F8FC)
private val Brand = Color(0xFF3559E0)
private val BrandSoft = Color(0xFFE9EEFF)
private val Mint = Color(0xFF0F9D76)

@Composable
private fun SnapNestManagerApp() {
    val context = LocalContext.current
    var session by remember { mutableStateOf<SnapNestBackend.Session?>(null) }
    var billing by remember { mutableStateOf<SnapNestBackend.BillingConfig?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(Tab.Home) }

    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Brand,
            secondary = Mint,
            background = Canvas,
            surface = Color.White,
            onSurface = Ink
        ),
        typography = Typography(
            headlineLarge = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.7).sp),
            headlineMedium = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
            titleLarge = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
            bodyLarge = MaterialTheme.typography.bodyLarge.copy(lineHeight = 23.sp)
        )
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = Canvas) {
            if (session == null || billing == null) {
                LoginScreen(
                    busy = busy,
                    message = message,
                    onLogin = { email, password ->
                        busy = true; message = ""
                        thread {
                            runCatching {
                                val s = SnapNestBackend.signIn(email, password)
                                s to SnapNestBackend.fetchBilling(s)
                            }.onSuccess { pair ->
                                runOnUiThread { session = pair.first; billing = pair.second; busy = false }
                            }.onFailure { error ->
                                runOnUiThread { message = error.message ?: "Could not sign in."; busy = false }
                            }
                        }
                    }
                )
            } else {
                Scaffold(
                    containerColor = Canvas,
                    bottomBar = {
                        NavigationBar(containerColor = Color.White, tonalElevation = 8.dp) {
                            Tab.entries.forEach { item ->
                                NavigationBarItem(
                                    selected = tab == item,
                                    onClick = { tab = item },
                                    icon = {
                                        val icon = when(item) {
                                            Tab.Home -> Icons.Outlined.Home
                                            Tab.Payments -> Icons.Outlined.CreditCard
                                            Tab.Manage -> Icons.Outlined.BusinessCenter
                                            Tab.Account -> Icons.Outlined.AccountCircle
                                        }
                                        Icon(icon, contentDescription = item.label)
                                    },
                                    label = { Text(item.label) }
                                )
                            }
                        }
                    }
                ) { pad ->
                    AnimatedContent(
                        targetState = tab,
                        transitionSpec = {
                            (fadeIn(tween(180)) + slideInHorizontally { it / 8 }) togetherWith
                                (fadeOut(tween(120)) + slideOutHorizontally { -it / 8 })
                        },
                        modifier = Modifier.padding(pad)
                    ) { current ->
                        when(current) {
                            Tab.Home -> HomeScreen(billing!!)
                            Tab.Payments -> PaymentsScreen(session!!, billing!!, onMessage = { message = it })
                            Tab.Manage -> ManageScreen()
                            Tab.Account -> AccountScreen(
                                billing = billing!!,
                                onLogout = { session = null; billing = null; tab = Tab.Home; message = "" }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LoginScreen(busy: Boolean, message: String, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFFF4F7FF), Color.White, Color(0xFFF8FAFD)))
        )
    ) {
        Box(Modifier.size(220.dp).offset(x = 230.dp, y = (-55).dp).clip(CircleShape).background(Brand.copy(alpha = .09f)))
        Box(Modifier.size(150.dp).offset(x = (-55).dp, y = 590.dp).clip(CircleShape).background(Mint.copy(alpha = .08f)))

        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.Center
        ) {
            Surface(shape = RoundedCornerShape(18.dp), color = Ink, modifier = Modifier.size(54.dp)) {
                Box(contentAlignment = Alignment.Center) { Text("S", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.height(24.dp))
            Text("SnapNest Manager", style = MaterialTheme.typography.headlineLarge, color = Ink)
            Text("Business control without the clutter.", color = Muted, fontSize = 16.sp)
            Spacer(Modifier.height(34.dp))

            ElevatedCard(shape = RoundedCornerShape(28.dp), colors = CardDefaults.elevatedCardColors(containerColor = Color.White)) {
                Column(Modifier.padding(22.dp)) {
                    Text("Welcome back", style = MaterialTheme.typography.titleLarge)
                    Text("Use an authorized Laundry Loop manager or admin account.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(18.dp))
                    OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(15.dp))
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(15.dp))
                    AnimatedVisibility(message.isNotBlank()) {
                        Text(message, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
                    }
                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = { onLogin(email.trim(), password) },
                        enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                        shape = RoundedCornerShape(15.dp),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        if (busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp), color = Color.White)
                        else Text("Sign in securely", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            Text("Smart Software • Smart Business Solutions", color = Muted, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

@Composable
private fun HomeScreen(billing: SnapNestBackend.BillingConfig) {
    val amount = remember(billing.amountDue) { money(billing.currency, billing.amountDue) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text("Good evening", color = Muted, fontSize = 13.sp)
                Text(billing.clientName, style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Surface(shape = CircleShape, color = BrandSoft, modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Text("LL", color = Brand, fontWeight = FontWeight.Bold) }
            }
        }
        Spacer(Modifier.height(24.dp))

        Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Ink)) {
            Column(Modifier.padding(22.dp)) {
                Text("SnapNest balance", color = Color.White.copy(alpha=.72f), fontSize = 13.sp)
                Text(amount, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Row {
                    StatusPill(if (billing.amountDue > 0) "Payment due" else "All caught up", if (billing.amountDue > 0) Color(0xFFFFD77A) else Color(0xFF8FE1C6))
                    billing.dueDate?.let { Spacer(Modifier.width(8.dp)); StatusPill("Due $it", Color.White.copy(alpha=.18f)) }
                }
            }
        }

        Spacer(Modifier.height(20.dp))
        Text("At a glance", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Account", "Active", "Software services", Modifier.weight(1f))
            MetricCard("Support", "Available", "SnapNest direct", Modifier.weight(1f))
        }
        Spacer(Modifier.height(20.dp))
        ActionCard("Open Laundry Loop", "Jump straight into the live staff POS.", "https://thelaundryloop.net/staff")
        Spacer(Modifier.height(10.dp))
        ActionCard("Administration", "Manage services, orders and operations.", "https://thelaundryloop.net/admin")
    }
}

@Composable
private fun PaymentsScreen(session: SnapNestBackend.Session, billing: SnapNestBackend.BillingConfig, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var amount by remember { mutableStateOf(if (billing.amountDue > 0) billing.amountDue.toString() else "") }
    var reference by remember { mutableStateOf("") }
    var proof by remember { mutableStateOf<Uri?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> proof = uri }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Payments", style = MaterialTheme.typography.headlineMedium)
        Text("Everything you need to settle your SnapNest account.", color = Muted)
        Spacer(Modifier.height(20.dp))

        SectionCard("MMG") {
            DetailRow("Account name", billing.mmgName ?: "Not configured")
            DetailRow("Number", billing.mmgNumber ?: "Not configured")
            TextButton(onClick = { billing.mmgNumber?.let { clipboard.setText(AnnotatedString(it)); result = "MMG number copied." } }) { Text("Copy MMG number") }
        }
        Spacer(Modifier.height(12.dp))
        SectionCard(billing.bankName ?: "Bank transfer") {
            DetailRow("Account", billing.bankAccountName ?: "Not configured")
            DetailRow("Number", billing.bankAccountNumber ?: "Not configured")
            DetailRow("Type", listOfNotNull(billing.bankAccountType, billing.currency).joinToString(" • "))
            billing.bankBranch?.let { DetailRow("Branch", it) }
            TextButton(onClick = { billing.bankAccountNumber?.let { clipboard.setText(AnnotatedString(it)); result = "Bank account copied." } }) { Text("Copy account number") }
        }

        Spacer(Modifier.height(18.dp))
        SectionCard("Submit payment proof") {
            OutlinedTextField(amount, { amount = it }, label = { Text("Amount paid") }, prefix = { Text("GYD ") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp))
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(reference, { reference = it }, label = { Text("Reference") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp))
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = { picker.launch(arrayOf("image/jpeg","image/png","image/webp","application/pdf")) }, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Text(if (proof == null) "Choose receipt or proof" else "Proof selected ✓")
            }
            Spacer(Modifier.height(10.dp))
            Button(
                enabled = !uploading && proof != null,
                onClick = {
                    val uri = proof ?: return@Button
                    uploading = true; result = "Uploading securely…"
                    thread {
                        runCatching { SnapNestBackend.uploadProof(session, context.contentResolver, uri, amount.toDoubleOrNull(), reference.trim().ifBlank { null }) }
                            .onSuccess { (context as? ComponentActivity)?.runOnUiThread { uploading = false; proof = null; result = "Payment submitted — Pending Verification."; onMessage(result) } }
                            .onFailure { e -> (context as? ComponentActivity)?.runOnUiThread { uploading = false; result = e.message ?: "Upload failed." } }
                    }
                },
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) { if(uploading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth=2.dp, color=Color.White) else Text("Submit payment proof") }
            AnimatedVisibility(result.isNotBlank()) { Text(result, color = if(result.startsWith("Payment submitted")) Mint else Muted, fontSize = 12.sp, modifier = Modifier.padding(top=10.dp)) }
        }
    }
}

@Composable
private fun ManageScreen() {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Manage", style = MaterialTheme.typography.headlineMedium)
        Text("Your software, operations and support in one place.", color = Muted)
        Spacer(Modifier.height(20.dp))
        ActionCard("Staff POS", "Open the live Laundry Loop point-of-sale.", "https://thelaundryloop.net/staff")
        Spacer(Modifier.height(10.dp))
        ActionCard("Admin dashboard", "Orders, services, subscriptions and team access.", "https://thelaundryloop.net/admin")
        Spacer(Modifier.height(10.dp))
        ActionCard("Public website", "See exactly what customers see.", "https://thelaundryloop.net")
        Spacer(Modifier.height(18.dp))
        SectionCard("Service status") {
            DetailRow("Website", "Live")
            DetailRow("Database", "Connected")
            DetailRow("Client app", "Connected")
            Text("Live status monitoring can be expanded here without touching the printer bridge.", color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun AccountScreen(billing: SnapNestBackend.BillingConfig, onLogout: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Account", style = MaterialTheme.typography.headlineMedium)
        Text(billing.clientName, color = Muted)
        Spacer(Modifier.height(20.dp))
        SectionCard("SnapNest Client") {
            DetailRow("Plan", "Managed software services")
            DetailRow("Currency", billing.currency)
            billing.dueDate?.let { DetailRow("Next due date", it) }
        }
        Spacer(Modifier.height(12.dp))
        FilledTonalButton(
            onClick = {
                val digits = billing.supportWhatsapp?.filter(Char::isDigit).orEmpty()
                if(digits.isNotBlank()) context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")))
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(15.dp)
        ) { Icon(Icons.Outlined.SupportAgent, null); Spacer(Modifier.width(8.dp)); Text("WhatsApp SnapNest Support") }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(15.dp)) { Text("Sign out") }
        Spacer(Modifier.height(30.dp))
        Text("SnapNest Manager 1.0.0", color = Muted, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
private fun ActionCard(title: String, subtitle: String, url: String) {
    val context = LocalContext.current
    ElevatedCard(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }, shape = RoundedCornerShape(22.dp), colors = CardDefaults.elevatedCardColors(containerColor = Color.White)) {
        Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(16.dp), color = BrandSoft, modifier = Modifier.size(46.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.OpenInNew, null, tint = Brand) }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp); Text(subtitle, color = Muted, fontSize = 12.sp) }
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, caption: String, modifier: Modifier = Modifier) {
    ElevatedCard(modifier = modifier, shape = RoundedCornerShape(22.dp), colors = CardDefaults.elevatedCardColors(containerColor = Color.White)) {
        Column(Modifier.padding(16.dp)) {
            Text(label, color = Muted, fontSize = 12.sp)
            Text(value, color = Ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(caption, color = Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    ElevatedCard(shape = RoundedCornerShape(22.dp), colors = CardDefaults.elevatedCardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, fontSize = 13.sp)
        Text(value, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    Surface(shape = RoundedCornerShape(50.dp), color = color) { Text(text, color = if(color.alpha < .5f) Color.White else Ink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) }
}

private fun money(currency: String, value: Double): String {
    val nf = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 0 }
    return currency + " " + nf.format(value)
}
