package com.expertesim.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.telephony.TelephonyManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Image
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.math.sqrt

private val Ink = Color(0xFF08080B)
private val Panel = Color(0xFF111116)
private val Panel2 = Color(0xFF17171D)
private val Stroke = Color(0xFF292930)
private val MainText = Color(0xFFF4F4F6)
private val Muted = Color(0xFF92929C)
private val Purple = Color(0xFF8054F6)
private val Poppins = FontFamily(
    Font(R.font.poppins_regular, FontWeight.Normal),
    Font(R.font.poppins_semibold, FontWeight.SemiBold)
)
private val GeniexIcons = FontFamily(Font(R.font.geniex_icons))

private fun icon(code: Int) = String(Character.toChars(code))

private data class Country(val code: String, val name: String, val flag: String)
private data class Plan(val id: String, val name: String, val detail: String, val price: String, val points: String)
internal data class SpeedResult(val download: Double, val upload: Double, val ping: Double, val jitter: Double)
private data class MenuItem(val title: String, val subtitle: String, val glyph: Int, val page: String)

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("geniex_native", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(8, 8, 11)
        window.navigationBarColor = android.graphics.Color.rgb(8, 8, 11)
        setContent { GeniexNativeApp(this) }
    }

    internal fun notifyUser(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    internal fun sessionCookie(): String = preferences.getString("session_cookie", "") ?: ""

    internal suspend fun api(path: String, method: String = "GET", body: JSONObject? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val connection = (URL("https://expert-esim-web-production.up.railway.app/api/v1$path")
                .openConnection() as HttpURLConnection)
            try {
                connection.requestMethod = method
                connection.connectTimeout = 15000
                connection.readTimeout = 25000
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Cache-Control", "no-store")
                sessionCookie().takeIf { it.isNotBlank() }?.let {
                    connection.setRequestProperty("Cookie", it)
                }
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                connection.getHeaderField("Set-Cookie")?.substringBefore(";")?.takeIf { it.contains("=") }?.let {
                    preferences.edit().putString("session_cookie", it).apply()
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val result = if (raw.isBlank()) JSONObject() else JSONObject(raw)
                if (status !in 200..299) {
                    throw IllegalStateException(
                        result.optString("error").ifBlank {
                            result.optString("message").ifBlank { "Request failed ($status)." }
                        }
                    )
                }
                result
            } finally {
                connection.disconnect()
            }
        }

    internal fun openSimSettings() {
        val intents = listOf(
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_NETWORK_OPERATOR_SETTINGS),
            Intent(Settings.ACTION_SETTINGS)
        )
        val target = intents.firstOrNull { it.resolveActivity(packageManager) != null }
        if (target != null) startActivity(target) else notifyUser("SIM settings are not available on this device.")
    }

    internal fun openBatterySettings() {
        runCatching { startActivity(Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)) }
            .onFailure { startActivity(Intent(Settings.ACTION_SETTINGS)) }
    }

    internal fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    @SuppressLint("MissingPermission")
    internal fun currentNetworkLabel(): String {
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            return "Permission required"
        }
        return runCatching {
            val tm = getSystemService(TelephonyManager::class.java) ?: return "Not available"
            when (tm.dataNetworkType) {
                TelephonyManager.NETWORK_TYPE_NR -> "5G"
                TelephonyManager.NETWORK_TYPE_LTE -> "4G LTE"
                TelephonyManager.NETWORK_TYPE_HSPAP,
                TelephonyManager.NETWORK_TYPE_HSPA,
                TelephonyManager.NETWORK_TYPE_HSDPA,
                TelephonyManager.NETWORK_TYPE_HSUPA -> "3G HSPA"
                TelephonyManager.NETWORK_TYPE_UMTS -> "3G UMTS"
                TelephonyManager.NETWORK_TYPE_EDGE -> "2G EDGE"
                TelephonyManager.NETWORK_TYPE_GPRS -> "2G GPRS"
                TelephonyManager.NETWORK_TYPE_GSM -> "2G GSM"
                else -> "Network type unavailable"
            }
        }.getOrElse { "Network type unavailable" }
    }

    internal fun hasEuicc(): Boolean =
        packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)

    internal suspend fun registerCurrentDevice(): JSONObject {
        val clientId = preferences.getString("client_device_id", null) ?: java.util.UUID.randomUUID()
            .toString().replace("-", "").also {
                preferences.edit().putString("client_device_id", it).apply()
            }
        val euicc = getSystemService(android.telephony.euicc.EuiccManager::class.java)
        val euiccEnabled = runCatching { euicc?.isEnabled == true }.getOrDefault(false)
        val name = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.distinct().joinToString(" ")
        val payload = JSONObject()
            .put("clientDeviceId", clientId)
            .put("platform", "android")
            .put("manufacturer", Build.MANUFACTURER.orEmpty())
            .put("model", Build.MODEL.orEmpty())
            .put("deviceName", name.ifBlank { "Android device" })
            .put("osVersion", Build.VERSION.RELEASE.orEmpty())
            .put("eSimSupportKnown", true)
            .put("hasEuiccHardware", hasEuicc())
            .put("euiccEnabled", euiccEnabled)
        val response = api("/devices", "POST", payload)
        return response.optJSONObject("device") ?: response
    }

    internal fun deviceSummary(): List<Pair<String, String>> {
        val batteryIntent = registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val battery = if (level >= 0 && scale > 0) "${level * 100 / scale}%" else "Unavailable"
        val am = getSystemService(android.app.ActivityManager::class.java)
        val memory = android.app.ActivityManager.MemoryInfo()
        am?.getMemoryInfo(memory)
        val storage = StatFs(Environment.getDataDirectory().path)
        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val pm = getSystemService(PowerManager::class.java)
            when (pm?.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "Normal"
                PowerManager.THERMAL_STATUS_LIGHT -> "Light"
                PowerManager.THERMAL_STATUS_MODERATE -> "Moderate"
                PowerManager.THERMAL_STATUS_SEVERE -> "Severe"
                PowerManager.THERMAL_STATUS_CRITICAL -> "Critical"
                PowerManager.THERMAL_STATUS_EMERGENCY -> "Emergency"
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "Shutdown"
                else -> "Unavailable"
            }
        } else "Unavailable"
        val model = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.distinct().joinToString(" ")
        return listOf(
            "Device" to model,
            "Android version" to (Build.VERSION.RELEASE ?: "Unknown"),
            "eSIM hardware" to if (hasEuicc()) "Detected" else "Not detected",
            "Battery" to battery,
            "Memory available" to "${memory.availMem / (1024L * 1024L)} MB",
            "Storage available" to "${storage.availableBytes / (1024L * 1024L)} MB",
            "Thermal status" to thermal
        )
    }

    internal suspend fun runSpeedTest(): SpeedResult = withContext(Dispatchers.IO) {
        fun request(path: String, method: String = "GET", bytes: ByteArray? = null): ByteArray {
            val c = (URL("https://expert-esim-web-production.up.railway.app/api/v1/tools/speedtest/$path")
                .openConnection() as HttpURLConnection)
            try {
                c.requestMethod = method
                c.connectTimeout = 15000
                c.readTimeout = 30000
                c.setRequestProperty("Cache-Control", "no-store")
                if (bytes != null) {
                    c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/octet-stream")
                    c.outputStream.use { it.write(bytes) }
                }
                if (c.responseCode !in 200..299) throw IllegalStateException("Speed test endpoint returned ${c.responseCode}.")
                val output = ByteArrayOutputStream()
                c.inputStream.use { it.copyTo(output) }
                return output.toByteArray()
            } finally {
                c.disconnect()
            }
        }
        val samples = mutableListOf<Double>()
        repeat(4) { i ->
            val start = System.nanoTime()
            request("ping?ts=${System.currentTimeMillis()}$i")
            samples += (System.nanoTime() - start) / 1_000_000.0
        }
        val average = samples.average()
        val jitter = sqrt(samples.map { (it - average) * (it - average) }.average())
        val downStart = System.nanoTime()
        val downloaded = request("download?bytes=1200000&ts=${System.currentTimeMillis()}").size
        val downSeconds = ((System.nanoTime() - downStart) / 1_000_000_000.0).coerceAtLeast(0.001)
        val down = downloaded * 8.0 / downSeconds / 1_000_000.0
        val uploadBytes = ByteArray(350000)
        val upStart = System.nanoTime()
        request("upload", "POST", uploadBytes)
        val upSeconds = ((System.nanoTime() - upStart) / 1_000_000_000.0).coerceAtLeast(0.001)
        val up = uploadBytes.size * 8.0 / upSeconds / 1_000_000.0
        SpeedResult(down, up, average, jitter)
    }
}

@Composable
private fun GeniexNativeApp(activity: MainActivity) {
    var page by remember { mutableStateOf("home") }
    var selectedCountry by remember { mutableStateOf<Country?>(null) }
    var countryQuery by remember { mutableStateOf("") }
    var planType by remember { mutableStateOf("data") }
    var plans by remember { mutableStateOf(emptyList<Plan>()) }
    var selectedPlan by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("Not connected") }
    var speed by remember { mutableStateOf("Not verified") }
    var loading by remember { mutableStateOf(false) }
    var dataMessage by remember { mutableStateOf("") }
    var points by remember { mutableStateOf("0") }
    var userEmail by remember { mutableStateOf("") }
    var fullName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var loginEmail by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var acceptedTerms by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(true) }
    var networkLabel by remember { mutableStateOf("Permission required") }
    var loginBusy by remember { mutableStateOf(false) }
    var speedResult by remember { mutableStateOf<SpeedResult?>(null) }
    var speedBusy by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf(emptyList<Pair<String, String>>()) }
    var detailsTitle by remember { mutableStateOf("Details") }
    var registeredDevice by remember { mutableStateOf<JSONObject?>(null) }
    var deviceSyncMessage by remember { mutableStateOf("") }
    var profileBusy by remember { mutableStateOf(false) }
    var profileMessage by remember { mutableStateOf("") }
    var appMessages by remember { mutableStateOf(emptyList<JSONObject>()) }
    var couponItems by remember { mutableStateOf(emptyList<JSONObject>()) }
    var rewardSummary by remember { mutableStateOf<JSONObject?>(null) }
    var rewardBusy by remember { mutableStateOf(false) }
    var transferRecipient by remember { mutableStateOf("") }
    var transferPoints by remember { mutableStateOf("10") }
    var transferBusy by remember { mutableStateOf(false) }
    var transferMessage by remember { mutableStateOf("") }
    var airtimeCountry by remember { mutableStateOf("NG") }
    var airtimePhone by remember { mutableStateOf("") }
    var airtimeAmount by remember { mutableStateOf("") }
    var airtimeCurrency by remember { mutableStateOf("NGN") }
    var airtimeBusy by remember { mutableStateOf(false) }
    var airtimeMessage by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val requestPhonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        networkLabel = if (granted) activity.currentNetworkLabel() else "Permission denied"
    }

    LaunchedEffect(Unit) {
        if (activity.sessionCookie().isNotBlank()) {
            runCatching {
                val profile = activity.api("/me")
                val user = profile.optJSONObject("user") ?: JSONObject()
                userEmail = user.optString("email").takeIf { it != "null" }.orEmpty()
                fullName = user.optString("fullName").takeIf { it != "null" }.orEmpty()
                phone = user.optString("phone").takeIf { it != "null" }.orEmpty()
                if (userEmail.isNotBlank()) {
                    val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                    points = wallet.optString("pointsBalance", points)
                    registeredDevice = activity.registerCurrentDevice()
                    deviceSyncMessage = "This Android device is registered to your account."
                }
            }
        }
    }

    val countries = remember {
        Locale.getISOCountries().map { code ->
            val name = if (code == "XK") "Kosovo" else Locale("", code).getDisplayCountry(Locale.ENGLISH)
            Country(code, name.ifBlank { code }, countryFlag(code))
        }.filter { it.name.isNotBlank() }.sortedBy { it.name.lowercase(Locale.ENGLISH) }
    }
    val filteredCountries = remember(countryQuery, countries) {
        countries.filter { it.name.contains(countryQuery, true) || it.code.contains(countryQuery, true) }
    }

    fun toast(message: String) = activity.notifyUser(message)
    fun open(target: String) {
        page = target
        if (target == "balance") {
            scope.launch {
                runCatching {
                    val r = activity.api("/app/wallet")
                    val w = r.optJSONObject("wallet") ?: r
                    points = w.optString("pointsBalance", points)
                }.onFailure { toast(it.message ?: "Balance could not be loaded.") }
            }
        }
        if (target == "rewards") {
            scope.launch {
                runCatching {
                    val r = activity.api("/app/summary")
                    rewardSummary = r.optJSONObject("summary") ?: JSONObject()
                    val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                    points = wallet.optString("pointsBalance", points)
                    details = summaryRows(r)
                    detailsTitle = "My Rewards"
                }.onFailure { toast(it.message ?: "Rewards could not be loaded.") }
            }
        }
        if (target == "vouchers") {
            scope.launch {
                runCatching {
                    val r = activity.api("/app/coupons")
                    val catalog = r.optJSONObject("coupons") ?: JSONObject()
                    val available = catalog.optJSONArray("available") ?: JSONArray()
                    couponItems = (0 until available.length()).mapNotNull { i -> available.optJSONObject(i) }
                    detailsTitle = "My Vouchers"
                }.onFailure { toast(it.message ?: "Vouchers could not be loaded.") }
            }
        }
        if (target == "messages") {
            scope.launch {
                runCatching {
                    val r = activity.api("/app/messages")
                    val items = r.optJSONArray("messages") ?: JSONArray()
                    appMessages = (0 until items.length()).mapNotNull { i -> items.optJSONObject(i) }
                }.onFailure { toast(it.message ?: "Messages could not be loaded.") }
            }
        }
        if (target == "device" && userEmail.isNotBlank() && registeredDevice == null) {
            scope.launch {
                runCatching {
                    registeredDevice = activity.registerCurrentDevice()
                    deviceSyncMessage = "This Android device is registered to your account."
                }.onFailure { deviceSyncMessage = it.message ?: "Device registration is unavailable." }
            }
        }
        if (target == "history") {
            scope.launch {
                runCatching {
                    val r = activity.api("/app/wallet")
                    val wallet = r.optJSONObject("wallet") ?: JSONObject()
                    points = wallet.optString("pointsBalance", points)
                    val entries = wallet.optJSONArray("transactions") ?: JSONArray()
                    details = (0 until entries.length()).map { i ->
                        val item = entries.optJSONObject(i) ?: JSONObject()
                        val delta = item.optInt("delta")
                        val sign = if (delta > 0) "+" else ""
                        (item.optString("reason", "Points activity") + " ($sign$delta)") to item.optString("createdAt", "")
                    }
                    detailsTitle = "Transaction History"
                }.onFailure { toast(it.message ?: "History could not be loaded.") }
            }
        }
        if (target == "airtime") {
            if (userEmail.isBlank()) {
                page = "account"
                toast("Sign in to request airtime.")
            } else {
                scope.launch {
                    runCatching {
                        val r = activity.api("/app/airtime")
                        val entries = r.optJSONArray("requests") ?: JSONArray()
                        details = (0 until entries.length()).map { i ->
                            val item = entries.optJSONObject(i) ?: JSONObject()
                            item.optString("reference", "Airtime request") to
                                (item.optString("phone") + " · " + item.optString("amount") + " " + item.optString("currency") + " · " + item.optString("status"))
                        }
                        detailsTitle = "Airtime History"
                    }.onFailure { toast(it.message ?: "Airtime history could not be loaded.") }
                }
            }
        }
        if (target == "apps") {
            scope.launch {
                runCatching {
                    val r = activity.api("/geniex/catalog")
                    val bundles = r.optJSONArray("bundles") ?: JSONArray()
                    details = (0 until bundles.length()).map { i ->
                        val item = bundles.optJSONObject(i) ?: JSONObject()
                        item.optString("name", "App bundle") to item.optString("description", "Provider catalogue item")
                    }
                    dataMessage = r.optString("message", "App bundle availability is controlled by the connected provider.")
                }.onFailure { dataMessage = it.message ?: "App bundles could not be loaded." }
            }
        }
    }

    fun loadPlans(country: Country, type: String) {
        selectedCountry = country
        planType = type
        selectedPlan = ""
        page = "plans"
        loading = true
        plans = emptyList()
        provider = "Not connected"
        speed = "Not verified"
        dataMessage = ""
        scope.launch {
            try {
                val r = activity.api(
                    "/geniex/catalog?countryCode=${country.code}&category=$type"
                )
                provider = r.optString("providerName").takeIf { it.isNotBlank() }
                    ?: r.optJSONObject("provider")?.optString("name")?.takeIf { it.isNotBlank() }
                    ?: "Not connected"
                speed = r.optString("speedLabel").takeIf { it.isNotBlank() }
                    ?: r.optString("speed").takeIf { it.isNotBlank() }
                    ?: "Not verified"
                val array = r.optJSONArray("plans") ?: JSONArray()
                plans = (0 until array.length()).mapNotNull { i ->
                    val item = array.optJSONObject(i) ?: return@mapNotNull null
                    val id = item.optString("id").takeIf { it != "null" }.orEmpty()
                        .ifBlank { item.optString("planId").takeIf { it != "null" }.orEmpty() }
                    val name = item.optString("name").takeIf { it.isNotBlank() && it != "null" }
                        ?: item.optString("dataLabel").takeIf { it.isNotBlank() && it != "null" }
                        ?: item.optString("allowance").takeIf { it.isNotBlank() && it != "null" }
                        ?: "eSIM plan"
                    val detail = item.optString("description").takeIf { it.isNotBlank() && it != "null" }
                        ?: item.optString("validityLabel").takeIf { it.isNotBlank() && it != "null" }.orEmpty()
                    val price = item.optString("priceFormatted").takeIf { it.isNotBlank() && it != "null" }
                        ?: item.optString("priceLabel").takeIf { it.isNotBlank() && it != "null" }
                        ?: if (item.has("price") && item.has("currency")) "${item.optString("currency")} ${item.optString("price")}" else ""
                    val pointsCost = if (item.has("pointsCost")) "${item.optString("pointsCost")} PTS" else ""
                    Plan(id, name, detail, price, pointsCost)
                }
                dataMessage = r.optString("message")
            } catch (e: Exception) {
                dataMessage = e.message ?: "Availability could not be checked."
            } finally {
                loading = false
            }
        }
    }

    BackHandler(enabled = page != "home") {
        page = when (page) {
            "plans" -> "countries"
            "countries" -> "shop"
            "shop" -> "home"
            else -> "home"
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Purple, background = Ink, surface = Panel,
        onPrimary = Color.White, onBackground = MainText, onSurface = MainText
    )) {
        Column(Modifier.fillMaxSize().background(Ink)) {
            Column(Modifier.weight(1f).fillMaxWidth()) {
                if (page == "home") {
                    HomeDashboard(
                        fullName = fullName,
                        userEmail = userEmail,
                        points = points,
                        networkLabel = networkLabel,
                        onOpen = { target -> open(target) }
                    )
                } else if (page == "shop") {
                    ShopDashboard(onOpen = { target -> open(target) })
                } else if (page == "countries") {
                Row(
                    Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 17.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Glyph(0xE608, 22, Modifier.clickable { page = "shop" })
                    Glyph(0xE604, 21, Modifier.clickable { open("more") })
                }
                Text(
                    "Select country",
                    modifier = Modifier.padding(start = 23.dp, top = 9.dp, bottom = 16.dp),
                    color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 18.sp
                )
                OutlinedTextField(
                    value = countryQuery,
                    onValueChange = { countryQuery = it },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 23.dp),
                    placeholder = { Text("Where do you need an eSIM?", color = Muted, fontSize = 12.sp, fontFamily = Poppins) },
                    leadingIcon = { Glyph(0xE619, 16) },
                    trailingIcon = {
                        if (countryQuery.isNotEmpty()) Glyph(0xE607, 16, Modifier.clickable { countryQuery = "" })
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(7.dp),
                    textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Poppins, fontSize = 12.sp, color = MainText),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Stroke, unfocusedBorderColor = Stroke,
                        focusedContainerColor = Panel, unfocusedContainerColor = Panel,
                        cursorColor = Purple, focusedTextColor = MainText, unfocusedTextColor = MainText
                    )
                )
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 23.dp, vertical = 8.dp)
                ) {
                    items(filteredCountries, key = { it.code }) { country ->
                        Row(
                            Modifier.fillMaxWidth().height(43.dp).clickable { loadPlans(country, "data") },
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                Modifier.size(24.dp).clip(CircleShape).background(Panel2),
                                contentAlignment = Alignment.Center
                            ) { Text(country.flag, fontSize = 18.sp) }
                            Text(
                                country.name, modifier = Modifier.weight(1f).padding(start = 12.dp),
                                color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.Medium
                            )
                            Glyph(0xE60A, 15, color = Muted)
                        }
                    }
                }
            } else {
                HeaderBar(
                    title = when (page) {
                        "plans" -> "Available plans"
                        "more" -> "Mine"
                        "apps" -> "App Bundle"
                        "balance" -> "My Balance"
                        "account" -> "My Account"
                        "rewards" -> "My Rewards"
                        "airtime" -> "Airtime Recharge"
                        "vouchers" -> "My Vouchers"
                        "messages" -> "Message"
                        "settings" -> "Settings"
                        "network" -> "Network Detection"
                        "sim" -> "SIM Management"
                        "speed" -> "NetSpeed"
                        "device" -> "Device Information"
                        "battery" -> "Battery"
                        "boost" -> "Device Boosting"
                        "about" -> "About us"
                        "history" -> "Transaction History"
                        else -> "More"
                    },
                    back = { page = if (page == "plans") "countries" else "home" },
                    trailing = if (page == "plans" || page == "balance") "${points} PTS" else ""
                )
                when (page) {
                    "plans" -> {
                        val country = selectedCountry
                        if (country != null) {
                            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 23.dp)) {
                                Spacer(Modifier.height(8.dp))
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(country.name, color = Muted, fontFamily = Poppins, fontSize = 14.sp)
                                    }
                                    Text(country.flag, fontSize = 37.sp)
                                }
                                Spacer(Modifier.height(19.dp))
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Panel).padding(horizontal = 12.dp, vertical = 13.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Glyph(0xE614, 18)
                                    Spacer(Modifier.width(7.dp))
                                    Text("Provider:", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
                                    Text(provider, color = Muted, fontFamily = Poppins, fontSize = 11.sp, modifier = Modifier.weight(1f).padding(start = 4.dp))
                                    Box(Modifier.width(1.dp).height(19.dp).background(Stroke))
                                    Spacer(Modifier.width(11.dp))
                                    Glyph(0xE62F, 17)
                                    Spacer(Modifier.width(6.dp))
                                    Text("Speed", color = MainText, fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                    Text(speed, color = Muted, fontFamily = Poppins, fontSize = 10.sp, modifier = Modifier.padding(start = 4.dp))
                                }
                                Spacer(Modifier.height(14.dp))
                                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Panel2).padding(4.dp)) {
                                    PlanTab("Data", planType == "data", Modifier.weight(1f)) { loadPlans(country, "data") }
                                    PlanTab("Data + Calls + Text", planType == "combo", Modifier.weight(1f)) { loadPlans(country, "combo") }
                                }
                                Spacer(Modifier.height(14.dp))
                                when {
                                    loading -> Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
                                        CircularProgressIndicator(color = Purple, strokeWidth = 2.dp)
                                    }
                                    plans.isEmpty() -> Column(
                                        Modifier.fillMaxWidth().padding(top = 40.dp, bottom = 40.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally
                                    ) {
                                        Glyph(0xE614, 34, color = Muted)
                                        Spacer(Modifier.height(12.dp))
                                        Text("No verified plans available", color = MainText, fontFamily = Poppins, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                        Spacer(Modifier.height(7.dp))
                                        Text(
                                            dataMessage.ifBlank {
                                                "Provider: $provider. Speed: $speed. A live plan list will appear here when a connectivity provider supplies verified availability and pricing."
                                            },
                                            color = Muted, fontFamily = Poppins, fontSize = 11.sp, lineHeight = 18.sp
                                        )
                                        Spacer(Modifier.height(12.dp))
                                        OutlineAction("Refresh availability") { loadPlans(country, planType) }
                                    }
                                    else -> {
                                        val grouped = plans.groupBy { p ->
                                            val match = Regex("(\\d+)\\s*[- ]?\\s*day", RegexOption.IGNORE_CASE).find(p.detail + " " + p.name)
                                            match?.groupValues?.get(1)?.plus("-DAY PLAN") ?: "AVAILABLE PLANS"
                                        }
                                        grouped.forEach { (group, items) ->
                                            Text(group, color = Muted, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
                                            items.forEach { plan ->
                                                Row(
                                                    Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(8.dp))
                                                        .background(if (selectedPlan == plan.id) Panel2 else Panel)
                                                        .clickable { selectedPlan = plan.id }
                                                        .padding(horizontal = 11.dp, vertical = 13.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    RadioButton(
                                                        selected = selectedPlan == plan.id, onClick = { selectedPlan = plan.id },
                                                        colors = RadioButtonDefaults.colors(selectedColor = Purple, unselectedColor = Muted)
                                                    )
                                                    Column(Modifier.weight(1f).padding(start = 5.dp)) {
                                                        Text(plan.name, color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                                        if (plan.detail.isNotBlank()) Text(plan.detail, color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                                                    }
                                                    Column(horizontalAlignment = Alignment.End) {
                                                        Text(plan.price, color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                                        if (plan.points.isNotBlank()) Text(plan.points, color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Box(Modifier.fillMaxWidth().background(Ink).padding(horizontal = 23.dp, vertical = 12.dp)) {
                                Button(
                                    onClick = {
                                        if (selectedPlan.isNotBlank()) scope.launch {
                                            runCatching {
                                                activity.api(
                                                    "/geniex/data/order", "POST",
                                                    JSONObject().put("itemId", selectedPlan).put("countryCode", country.code).put("planType", planType)
                                                )
                                                toast("Order request submitted.")
                                            }.onFailure { toast(it.message ?: "Provider ordering is unavailable.") }
                                        }
                                    },
                                    enabled = selectedPlan.isNotBlank() && !loading,
                                    modifier = Modifier.fillMaxWidth().height(46.dp),
                                    shape = RoundedCornerShape(7.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Purple, disabledContainerColor = Color(0xFF26232F))
                                ) { Text("Buy eSIM", fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                            }
                        }
                    }
                    "more" -> MorePage(
                        onOpen = { target ->
                            when (target) {
                                "countries" -> page = "countries"
                                "sim" -> { page = "sim" }
                                else -> open(target)
                            }
                        }
                    )
                    "apps" -> DetailListPage(detailsTitle = "Application data bundles", details = details, message = dataMessage)
                    "balance" -> {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(10.dp)) {
                                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                                    Text("Expert Points", color = Muted, fontFamily = Poppins, fontSize = 11.sp)
                                    Text(points, color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 29.sp)
                                    Text("LOYALTY POINTS · NOT CASH", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                                }
                            }
                            Spacer(Modifier.height(12.dp))
                            SimpleActionRow("Transaction History", "View points earned and spent", 0xE61B) { open("history") }
                            Spacer(Modifier.height(10.dp))
                            Text("Transfer Expert Points", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(
                                value = transferRecipient,
                                onValueChange = { transferRecipient = it.uppercase() },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Recipient referral code", fontFamily = Poppins, fontSize = 11.sp) },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Purple, unfocusedBorderColor = Stroke, focusedContainerColor = Panel, unfocusedContainerColor = Panel, focusedTextColor = MainText, unfocusedTextColor = MainText)
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = transferPoints,
                                onValueChange = { transferPoints = it.filter(Char::isDigit).take(6) },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Points to transfer", fontFamily = Poppins, fontSize = 11.sp) },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Purple, unfocusedBorderColor = Stroke, focusedContainerColor = Panel, unfocusedContainerColor = Panel, focusedTextColor = MainText, unfocusedTextColor = MainText)
                            )
                            Spacer(Modifier.height(10.dp))
                            Button(
                                enabled = !transferBusy && transferRecipient.isNotBlank() && (transferPoints.toIntOrNull() ?: 0) > 0,
                                onClick = {
                                    transferBusy = true
                                    transferMessage = ""
                                    scope.launch {
                                        try {
                                            val response = activity.api(
                                                "/app/wallet/transfer", "POST",
                                                JSONObject().put("recipientCode", transferRecipient.trim()).put("points", transferPoints.toInt())
                                            )
                                            points = response.optString("pointsBalance", points)
                                            transferMessage = response.optString("message", "Points transfer completed.")
                                            transferRecipient = ""
                                            toast(transferMessage)
                                            val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                                            points = wallet.optString("pointsBalance", points)
                                        } catch (e: Exception) {
                                            transferMessage = e.message ?: "Points transfer failed."
                                            toast(transferMessage)
                                        } finally { transferBusy = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                            ) { Text(if (transferBusy) "Transferring…" else "Transfer Points", fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 12.sp) }
                            if (transferMessage.isNotBlank()) Text(transferMessage, color = Muted, fontFamily = Poppins, fontSize = 10.sp, modifier = Modifier.padding(top = 6.dp))
                            Spacer(Modifier.height(10.dp))
                            SimpleActionRow("Wallet Recharge", "Requires an authorised payment provider", 0xE614) { toast("Cash wallet recharge is not enabled. No payment provider is connected.") }
                        }
                    }
                    "account" -> {
                        if (userEmail.isNotBlank()) {
                            Column(Modifier.weight(1f).padding(23.dp)) {
                                Text(fullName.ifBlank { userEmail }, color = MainText, fontFamily = Poppins, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text(userEmail, color = Muted, fontFamily = Poppins, fontSize = 11.sp)
                                if (phone.isNotBlank()) Text(phone, color = Muted, fontFamily = Poppins, fontSize = 11.sp)
                                Spacer(Modifier.height(16.dp))
                                SimpleActionRow("Sign out", "End this account session", 0xE635) {
                                    scope.launch {
                                        runCatching { activity.api("/auth/logout", "POST", JSONObject()) }
                                        userEmail = ""
                                        activity.runOnUiThread { activity.getSharedPreferences("geniex_native", 0).edit().remove("session_cookie").apply() }
                                        toast("Signed out.")
                                    }
                                }
                            }
                        } else {
                            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Panel2).padding(4.dp)) {
                                    PlanTab("Sign in", loginMode, Modifier.weight(1f)) { loginMode = true }
                                    PlanTab("Create account", !loginMode, Modifier.weight(1f)) { loginMode = false }
                                }
                                Spacer(Modifier.height(20.dp))
                                if (!loginMode) {
                                    FormField("Full name", fullName, { fullName = it }, "Your full name")
                                    Spacer(Modifier.height(12.dp))
                                    FormField("Phone number (optional)", phone, { phone = it }, "+234...")
                                    Spacer(Modifier.height(12.dp))
                                }
                                FormField("Email address", loginEmail, { loginEmail = it }, "name@example.com")
                                Spacer(Modifier.height(12.dp))
                                OutlinedTextField(
                                    value = password, onValueChange = { password = it },
                                    modifier = Modifier.fillMaxWidth(),
                                    label = { Text("Password", fontFamily = Poppins, fontSize = 12.sp) },
                                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = Purple, unfocusedBorderColor = Stroke,
                                        focusedContainerColor = Panel, unfocusedContainerColor = Panel,
                                        focusedTextColor = MainText, unfocusedTextColor = MainText
                                    )
                                )
                                if (!loginMode) {
                                    Row(Modifier.fillMaxWidth().clickable { acceptedTerms = !acceptedTerms }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Checkbox(checked = acceptedTerms, onCheckedChange = { acceptedTerms = it }, colors = CheckboxDefaults.colors(checkedColor = Purple))
                                        Text("I agree to the Terms and Privacy Notice", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                                    }
                                }
                                Spacer(Modifier.height(16.dp))
                                Button(
                                    enabled = loginEmail.contains("@") && password.isNotBlank() && (loginMode || (fullName.trim().length >= 2 && password.length >= 10 && acceptedTerms)) && !loginBusy,
                                    onClick = {
                                        loginBusy = true
                                        scope.launch {
                                            try {
                                                val body = JSONObject().put("email", loginEmail).put("password", password)
                                                if (!loginMode) {
                                                    body.put("fullName", fullName.trim())
                                                        .put("phone", phone.trim())
                                                        .put("acceptedTerms", true)
                                                        .put("acceptedPrivacy", true)
                                                }
                                                val r = activity.api(if (loginMode) "/auth/login" else "/auth/register", "POST", body)
                                                val u = r.optJSONObject("user") ?: r.optJSONObject("account") ?: JSONObject()
                                                userEmail = u.optString("email").takeIf { it.isNotBlank() && it != "null" } ?: loginEmail
                                                fullName = u.optString("fullName").takeIf { it.isNotBlank() && it != "null" } ?: fullName
                                                phone = u.optString("phone").takeIf { it.isNotBlank() && it != "null" } ?: phone
                                                runCatching {
                                                    registeredDevice = activity.registerCurrentDevice()
                                                    deviceSyncMessage = "This Android device is registered to your account."
                                                }.onFailure { deviceSyncMessage = it.message ?: "Device registration is unavailable." }
                                                toast(r.optString("message").ifBlank { "Account request completed." })
                                            } catch (e: Exception) {
                                                toast(e.message ?: "Account request failed.")
                                            } finally { loginBusy = false }
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth().height(46.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Purple)
                                ) {
                                    Text(if (loginBusy) "Please wait…" else if (loginMode) "Sign in" else "Create account", fontFamily = Poppins, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                    "rewards" -> {
                        val summary = rewardSummary ?: JSONObject()
                        val tasks = summary.optJSONArray("tasks") ?: JSONArray()
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(12.dp)) {
                                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                                    Text("YOUR EXPERT POINTS", color = Muted, fontFamily = Poppins, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                                    Text(summary.optString("pointsBalance", points), color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 27.sp)
                                    Text("Earned from qualifying account and app activities", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                                }
                            }
                            Spacer(Modifier.height(12.dp))
                            Text("Daily rewards", color = MainText, fontFamily = Poppins, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(7.dp))
                            Button(
                                enabled = !rewardBusy && summary.optBoolean("dailyCheckinAvailable", false),
                                onClick = {
                                    rewardBusy = true
                                    scope.launch {
                                        try {
                                            val result = activity.api("/app/check-in", "POST", JSONObject())
                                            toast(result.optString("message", "Daily check-in claimed."))
                                            rewardSummary = activity.api("/app/summary").optJSONObject("summary") ?: JSONObject()
                                            val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                                            points = wallet.optString("pointsBalance", points)
                                        } catch (e: Exception) { toast(e.message ?: "Check-in could not be claimed.") }
                                        finally { rewardBusy = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(43.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                            ) { Text(if (summary.optBoolean("dailyCheckinAvailable", false)) "Daily Check-in · Collect 10 Points" else "Daily Check-in · Collected Today", fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
                            Spacer(Modifier.height(7.dp))
                            OutlinedButton(
                                enabled = !rewardBusy && summary.optBoolean("dailySpinAvailable", false),
                                onClick = {
                                    rewardBusy = true
                                    scope.launch {
                                        try {
                                            val result = activity.api("/app/spin", "POST", JSONObject())
                                            toast(result.optString("message", "Daily spin completed."))
                                            rewardSummary = activity.api("/app/summary").optJSONObject("summary") ?: JSONObject()
                                            val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                                            points = wallet.optString("pointsBalance", points)
                                        } catch (e: Exception) { toast(e.message ?: "Daily spin could not be completed.") }
                                        finally { rewardBusy = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(43.dp),
                                border = BorderStroke(1.dp, Stroke)
                            ) { Text(if (summary.optBoolean("dailySpinAvailable", false)) "Free Daily Rewards Spin" else "Daily Spin · Used Today", color = MainText, fontFamily = Poppins, fontSize = 11.sp) }
                            Spacer(Modifier.height(16.dp))
                            Text("Tasks", color = MainText, fontFamily = Poppins, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(6.dp))
                            if (tasks.length() == 0) {
                                Text("No tasks are available for this account yet.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                            } else {
                                for (i in 0 until tasks.length()) {
                                    val task = tasks.optJSONObject(i) ?: continue
                                    val taskId = task.optString("id")
                                    Card(
                                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                                        colors = CardDefaults.cardColors(containerColor = Panel),
                                        shape = RoundedCornerShape(10.dp)
                                    ) {
                                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Column(Modifier.weight(1f)) {
                                                    Text(task.optString("title", "Task"), color = MainText, fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                                    Text(task.optString("description", ""), color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 14.sp)
                                                }
                                                Text("${task.optInt("points")} PTS", color = Color(0xFFAE99FF), fontFamily = Poppins, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                            }
                                            Spacer(Modifier.height(8.dp))
                                            when {
                                                task.optBoolean("claimed", false) -> Text("COMPLETED", color = Color(0xFF8E84B6), fontFamily = Poppins, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                                                task.optBoolean("eligible", false) -> Button(
                                                    enabled = !rewardBusy,
                                                    onClick = {
                                                        rewardBusy = true
                                                        scope.launch {
                                                            try {
                                                                val result = activity.api("/app/tasks/${taskId}/claim", "POST", JSONObject())
                                                                toast(result.optString("message", "Task reward claimed."))
                                                                rewardSummary = activity.api("/app/summary").optJSONObject("summary") ?: JSONObject()
                                                                val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                                                                points = wallet.optString("pointsBalance", points)
                                                            } catch (e: Exception) { toast(e.message ?: "Task reward could not be claimed.") }
                                                            finally { rewardBusy = false }
                                                        }
                                                    },
                                                    modifier = Modifier.fillMaxWidth().height(36.dp),
                                                    colors = ButtonDefaults.buttonColors(containerColor = Purple)
                                                ) { Text("Claim Task Reward", fontFamily = Poppins, fontSize = 10.sp) }
                                                else -> Text("IN PROGRESS", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                                            }
                                        }
                                    }
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                            Text("Referral code", color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(summary.optString("referralCode", "Available after sign-in"), color = Color(0xFFAE99FF), fontFamily = Poppins, fontSize = 14.sp)
                            Text("Referral points are credited after the invited member completes the qualifying activity.", color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 14.sp)
                        }
                    }
                    "airtime" -> {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            Text("Mobile Airtime", color = MainText, fontFamily = Poppins, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text("Submit a top-up request for a supplier. It remains pending until delivery is confirmed.", color = Muted, fontFamily = Poppins, fontSize = 10.sp, lineHeight = 15.sp, modifier = Modifier.padding(top = 5.dp, bottom = 14.dp))
                            FormField("Country code (ISO)", airtimeCountry, { airtimeCountry = it.uppercase().take(2) }, "NG")
                            Spacer(Modifier.height(9.dp))
                            FormField("Phone number", airtimePhone, { airtimePhone = it }, "+234...")
                            Spacer(Modifier.height(9.dp))
                            FormField("Amount", airtimeAmount, { airtimeAmount = it.filter { c -> c.isDigit() || c == '.' } }, "Enter amount")
                            Spacer(Modifier.height(9.dp))
                            FormField("Currency", airtimeCurrency, { airtimeCurrency = it.uppercase().take(3) }, "NGN")
                            Spacer(Modifier.height(12.dp))
                            Button(
                                enabled = !airtimeBusy && airtimePhone.isNotBlank() && (airtimeAmount.toDoubleOrNull() ?: 0.0) > 0.0,
                                onClick = {
                                    airtimeBusy = true
                                    airtimeMessage = ""
                                    scope.launch {
                                        try {
                                            val result = activity.api(
                                                "/app/airtime", "POST",
                                                JSONObject().put("countryCode", airtimeCountry).put("phone", airtimePhone).put("amount", airtimeAmount.toDouble()).put("currency", airtimeCurrency)
                                            )
                                            val request = result.optJSONObject("request") ?: JSONObject()
                                            airtimeMessage = request.optString("message", "Your airtime request has been recorded.")
                                            toast(airtimeMessage)
                                            airtimePhone = ""
                                            airtimeAmount = ""
                                            val history = activity.api("/app/airtime").optJSONArray("requests") ?: JSONArray()
                                            details = (0 until history.length()).map { i ->
                                                val item = history.optJSONObject(i) ?: JSONObject()
                                                item.optString("reference", "Airtime") to (item.optString("phone") + " · " + item.optString("status"))
                                            }
                                        } catch (e: Exception) {
                                            airtimeMessage = e.message ?: "Airtime request failed."
                                            toast(airtimeMessage)
                                        } finally { airtimeBusy = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                            ) { Text(if (airtimeBusy) "Submitting…" else "Submit Top-up Request", fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
                            if (airtimeMessage.isNotBlank()) Text(airtimeMessage, color = Muted, fontFamily = Poppins, fontSize = 9.sp, modifier = Modifier.padding(top = 8.dp))
                            Spacer(Modifier.height(16.dp))
                            Text("Airtime history", color = MainText, fontFamily = Poppins, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            if (details.isEmpty()) Text("Previous requests will appear here.", color = Muted, fontFamily = Poppins, fontSize = 10.sp, modifier = Modifier.padding(top = 6.dp))
                            details.forEach { (title, subtitle) -> DetailRow(title, subtitle) }
                        }
                    }
                    "vouchers" -> {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            Text("Available vouchers", color = MainText, fontFamily = Poppins, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(8.dp))
                            if (userEmail.isBlank()) {
                                Text("Sign in to view and collect vouchers.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                            } else if (couponItems.isEmpty()) {
                                Text("There are no active vouchers available right now.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                            } else {
                                couponItems.forEach { coupon ->
                                    val couponId = coupon.optString("id")
                                    val alreadyClaimed = coupon.optBoolean("claimed", false)
                                    Card(modifier = Modifier.fillMaxWidth().padding(bottom = 9.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = BorderStroke(1.dp, Stroke), shape = RoundedCornerShape(11.dp)) {
                                        Column(Modifier.fillMaxWidth().padding(13.dp)) {
                                            Text(coupon.optString("title", "Voucher"), color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                            Text(coupon.optString("description", coupon.optString("type", "Reward voucher")), color = Muted, fontFamily = Poppins, fontSize = 10.sp, lineHeight = 15.sp, modifier = Modifier.padding(top = 4.dp))
                                            Spacer(Modifier.height(8.dp))
                                            Button(
                                                enabled = !alreadyClaimed && !rewardBusy && couponId.isNotBlank(),
                                                onClick = {
                                                    rewardBusy = true
                                                    scope.launch {
                                                        try {
                                                            val result = activity.api("/app/coupons/${couponId}/claim", "POST", JSONObject())
                                                            toast(result.optString("message", "Voucher collected."))
                                                            val fresh = activity.api("/app/coupons").optJSONObject("coupons") ?: JSONObject()
                                                            val available = fresh.optJSONArray("available") ?: JSONArray()
                                                            couponItems = (0 until available.length()).mapNotNull { i -> available.optJSONObject(i) }
                                                            val wallet = activity.api("/app/wallet").optJSONObject("wallet") ?: JSONObject()
                                                            points = wallet.optString("pointsBalance", points)
                                                        } catch (e: Exception) { toast(e.message ?: "Voucher could not be claimed.") }
                                                        finally { rewardBusy = false }
                                                    }
                                                },
                                                modifier = Modifier.fillMaxWidth().height(36.dp),
                                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                                            ) { Text(if (alreadyClaimed) "Already collected" else if (rewardBusy) "Collecting…" else "Collect voucher", fontFamily = Poppins, fontSize = 10.sp) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    "messages" -> {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            if (userEmail.isBlank()) {
                                Text("Sign in to view your messages.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                            } else if (appMessages.isEmpty()) {
                                Text("No messages are available.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                            } else {
                                appMessages.forEach { item ->
                                    val messageId = item.optString("id")
                                    val read = !item.isNull("readAt") && item.optString("readAt").isNotBlank() && item.optString("readAt") != "null"
                                    Card(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = BorderStroke(1.dp, Stroke), shape = RoundedCornerShape(10.dp)) {
                                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(item.optString("title", "Notice"), modifier = Modifier.weight(1f), color = MainText, fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                                Text(if (read) "READ" else "NEW", color = Color(0xFFAE99FF), fontFamily = Poppins, fontSize = 8.sp, fontWeight = FontWeight.SemiBold)
                                            }
                                            Text(item.optString("message", ""), color = Muted, fontFamily = Poppins, fontSize = 10.sp, lineHeight = 15.sp, modifier = Modifier.padding(top = 5.dp))
                                            if (!read && messageId.isNotBlank()) {
                                                TextButton(
                                                    onClick = {
                                                        scope.launch {
                                                            try {
                                                                val response = activity.api("/app/messages/${messageId}/read", "POST", JSONObject())
                                                                val updated = response.optJSONObject("message") ?: item
                                                                appMessages = appMessages.map { if (it.optString("id") == messageId) updated else it }
                                                            } catch (e: Exception) { toast(e.message ?: "Message could not be marked as read.") }
                                                        }
                                                    }
                                                ) { Text("Mark as read", color = Color(0xFFAE99FF), fontFamily = Poppins, fontSize = 9.sp) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    "history" -> {
                        DetailListPage("Transaction History", details, if (details.isEmpty()) "No points transactions have been returned for this account." else "")
                    }
                    "network" -> {
                        Column(Modifier.weight(1f).padding(23.dp)) {
                            Text("Current mobile network", color = Muted, fontFamily = Poppins, fontSize = 11.sp)
                            Text(networkLabel, color = MainText, fontFamily = Poppins, fontSize = 25.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(8.dp))
                            Text("Read from the handset's active mobile-data subscription. Network reporting depends on Android permissions and the carrier.", color = Muted, fontFamily = Poppins, fontSize = 11.sp, lineHeight = 18.sp)
                            Spacer(Modifier.height(18.dp))
                            PrimaryAction("Refresh network", 0xE619) {
                                if (activity.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                                    networkLabel = activity.currentNetworkLabel()
                                } else {
                                    requestPhonePermission.launch(Manifest.permission.READ_PHONE_STATE)
                                }
                            }
                            PrimaryAction("Open network settings", 0xE627) { activity.openSimSettings() }
                        }
                    }
                    "sim" -> {
                        Column(Modifier.weight(1f).padding(23.dp)) {
                            val simSupported = activity.hasEuicc()
                            Text(if (simSupported) "eSIM hardware detected" else "eSIM hardware not detected", color = MainText, fontFamily = Poppins, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(8.dp))
                            Text("An eSIM profile can only be installed after an authorised operator or SM-DP+ partner supplies a valid profile and activation details. This APK does not include transferable carrier credentials or a SIM profile.", color = Muted, fontFamily = Poppins, fontSize = 11.sp, lineHeight = 18.sp)
                            Spacer(Modifier.height(18.dp))
                            PrimaryAction("Open Android SIM settings", 0xE627) { activity.openSimSettings() }
                        }
                    }
                    "speed" -> {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Spacer(Modifier.height(20.dp))
                            Box(Modifier.size(174.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Glyph(0xE61B, 42, color = Purple)
                                    Text(speedResult?.download?.let { "%.1f".format(it) } ?: "—", color = MainText, fontSize = 28.sp, fontFamily = Poppins, fontWeight = FontWeight.SemiBold)
                                    Text("Mbps download", color = Muted, fontSize = 10.sp, fontFamily = Poppins)
                                }
                            }
                            Spacer(Modifier.height(23.dp))
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Metric("Upload", speedResult?.let { "%.1f Mbps".format(it.upload) } ?: "—")
                                Metric("Ping", speedResult?.let { "%.0f ms".format(it.ping) } ?: "—")
                                Metric("Jitter", speedResult?.let { "%.1f ms".format(it.jitter) } ?: "—")
                            }
                            Spacer(Modifier.height(28.dp))
                            Button(
                                onClick = {
                                    speedBusy = true
                                    scope.launch {
                                        runCatching { activity.runSpeedTest() }
                                            .onSuccess { speedResult = it; toast("Speed test complete.") }
                                            .onFailure { toast(it.message ?: "Speed test failed.") }
                                        speedBusy = false
                                    }
                                },
                                enabled = !speedBusy,
                                modifier = Modifier.fillMaxWidth().height(47.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                            ) { Text(if (speedBusy) "Testing…" else "Start test", fontFamily = Poppins, fontWeight = FontWeight.SemiBold) }
                            Spacer(Modifier.height(10.dp))
                            Text("Measures the active internet connection to the Expert eSIM service. Results depend on your current Wi-Fi or mobile-data route.", color = Muted, fontFamily = Poppins, fontSize = 10.sp, lineHeight = 16.sp)
                        }
                    }
                    "device" -> {
                        val rows = remember { activity.deviceSummary() }
                        val current = registeredDevice
                        val latestProfile = current?.optJSONObject("latestProfile")
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            Card(colors = CardDefaults.cardColors(containerColor = Panel), border = BorderStroke(1.dp, Stroke), shape = RoundedCornerShape(12.dp)) {
                                Column(Modifier.fillMaxWidth().padding(14.dp)) {
                                    Text("THIS DEVICE", color = Muted, fontFamily = Poppins, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        current?.optString("deviceName")?.takeIf { it.isNotBlank() } ?: listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" "),
                                        color = MainText, fontFamily = Poppins, fontSize = 15.sp, fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        if (userEmail.isNotBlank()) deviceSyncMessage.ifBlank { "Checking device registration…" } else "Sign in to attach this device to your subscriber account.",
                                        color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 14.sp
                                    )
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            rows.forEach { (label, value) -> DetailRow(label, value) }
                            if (current != null) {
                                DetailRow("Account device status", current.optString("status", "registered"))
                                DetailRow("eSIM capability", when {
                                    current.optBoolean("hasEuiccHardware", false).not() -> if (current.isNull("hasEuiccHardware")) "Not reported" else "Not detected"
                                    current.optBoolean("euiccEnabled", false) -> "Supported and enabled"
                                    else -> "Hardware detected; eSIM disabled"
                                })
                            }
                            Spacer(Modifier.height(12.dp))
                            Text("eSIM profile", color = MainText, fontFamily = Poppins, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            if (latestProfile != null) {
                                Text(latestProfile.optString("status", "Status unavailable").replace('_', ' ').uppercase(), color = Color(0xFFAE99FF), fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
                                Text(latestProfile.optString("message", "Provider status has not supplied a message."), color = Muted, fontFamily = Poppins, fontSize = 10.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 4.dp))
                            } else {
                                Text("No eSIM profile has been requested for this device.", color = Muted, fontFamily = Poppins, fontSize = 10.sp, modifier = Modifier.padding(top = 5.dp))
                            }
                            if (profileMessage.isNotBlank()) Text(profileMessage, color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 6.dp))
                            Spacer(Modifier.height(10.dp))
                            Button(
                                enabled = userEmail.isNotBlank() && current != null && current.optBoolean("hasEuiccHardware", false) && current.optBoolean("euiccEnabled", false) && !profileBusy,
                                onClick = {
                                    val deviceId = current?.optString("id").orEmpty()
                                    if (deviceId.isBlank()) return@Button
                                    profileBusy = true
                                    profileMessage = ""
                                    scope.launch {
                                        try {
                                            val response = activity.api("/devices/${deviceId}/profile", "POST", JSONObject())
                                            val issued = response.optJSONObject("profile") ?: JSONObject()
                                            val copy = JSONObject(current.toString()).put("latestProfile", issued)
                                            registeredDevice = copy
                                            profileMessage = response.optString("message", issued.optString("message", "Provider request received."))
                                            toast(profileMessage)
                                        } catch (e: Exception) {
                                            profileMessage = e.message ?: "Profile request could not be completed."
                                            toast(profileMessage)
                                        } finally { profileBusy = false }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Purple)
                            ) { Text(if (profileBusy) "Requesting profile…" else "Request eSIM Profile", fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
                            if (!activity.hasEuicc()) {
                                Text("This handset does not report eSIM hardware. Profile installation is unavailable on this device.", color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 7.dp))
                            } else if (userEmail.isBlank()) {
                                Text("Sign in before requesting an eSIM profile.", color = Muted, fontFamily = Poppins, fontSize = 9.sp, modifier = Modifier.padding(top = 7.dp))
                            }
                            Spacer(Modifier.height(14.dp))
                            PrimaryAction("Open device settings", 0xE627) { activity.openAppSettings() }
                        }
                    }
                    "battery", "boost" -> {
                        val rows = remember(page) { activity.deviceSummary() }
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(23.dp)) {
                            rows.forEach { (label, value) -> DetailRow(label, value) }
                            Spacer(Modifier.height(14.dp))
                            PrimaryAction(if (page == "battery") "Open battery settings" else "Open app settings", 0xE627) {
                                if (page == "battery") activity.openBatterySettings() else activity.openAppSettings()
                            }
                        }
                    }
                    "settings" -> {
                        Column(Modifier.weight(1f).padding(23.dp)) {
                            SimpleActionRow("Account security", "Manage your account and password", 0xE635) { open("account") }
                            SimpleActionRow("Battery", "Open Android battery controls", 0xE627) { activity.openBatterySettings() }
                            SimpleActionRow("SIM settings", "Manage SIM and mobile-data preferences", 0xE627) { activity.openSimSettings() }
                            SimpleActionRow("About us", "Application information", 0xE628) { open("about") }
                        }
                    }
                    "about" -> {
                        Column(Modifier.weight(1f).padding(23.dp)) {
                            Image(painterResource(R.drawable.geniex_wordmark), contentDescription = "Expert eSIM", modifier = Modifier.width(158.dp).height(36.dp), contentScale = ContentScale.Fit)
                            Spacer(Modifier.height(18.dp))
                            Text("Expert eSIM", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            Text("Mobile services and device tools.", color = Muted, fontFamily = Poppins, fontSize = 11.sp, lineHeight = 18.sp)
                        }
                    }
                    else -> DetailListPage("More", emptyList(), "")
                }
            }
            }
            NavigationBar(
                containerColor = Panel,
                contentColor = MainText
            ) {
                NavigationBarItem(
                    selected = page == "home",
                    onClick = { open("home") },
                    icon = { Glyph(0xE614, 19) },
                    label = { Text("Home", fontFamily = Poppins, fontSize = 9.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Purple, selectedTextColor = Purple, indicatorColor = Panel2, unselectedIconColor = Muted, unselectedTextColor = Muted)
                )
                NavigationBarItem(
                    selected = page in listOf("shop", "countries", "plans", "apps", "airtime"),
                    onClick = { open("shop") },
                    icon = { Glyph(0xE622, 19) },
                    label = { Text("Shop", fontFamily = Poppins, fontSize = 9.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Purple, selectedTextColor = Purple, indicatorColor = Panel2, unselectedIconColor = Muted, unselectedTextColor = Muted)
                )
                NavigationBarItem(
                    selected = page == "balance",
                    onClick = { open("balance") },
                    icon = { Glyph(0xE61C, 19) },
                    label = { Text("Balance", fontFamily = Poppins, fontSize = 9.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Purple, selectedTextColor = Purple, indicatorColor = Panel2, unselectedIconColor = Muted, unselectedTextColor = Muted)
                )
                NavigationBarItem(
                    selected = page in listOf("device", "network", "sim", "speed", "battery", "boost", "settings"),
                    onClick = { open("device") },
                    icon = { Glyph(0xE628, 19) },
                    label = { Text("Device", fontFamily = Poppins, fontSize = 9.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Purple, selectedTextColor = Purple, indicatorColor = Panel2, unselectedIconColor = Muted, unselectedTextColor = Muted)
                )
                NavigationBarItem(
                    selected = page in listOf("more", "account", "rewards", "vouchers", "messages", "history", "about"),
                    onClick = { open("more") },
                    icon = { Glyph(0xE61F, 19) },
                    label = { Text("Mine", fontFamily = Poppins, fontSize = 9.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Purple, selectedTextColor = Purple, indicatorColor = Panel2, unselectedIconColor = Muted, unselectedTextColor = Muted)
                )
            }
        }
    }
}



@Composable
private fun ShopDashboard(onOpen: (String) -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)
    ) {
        Text("Shop", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 23.sp)
        Text("Choose a service to continue", color = Muted, fontFamily = Poppins, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp, bottom = 16.dp))
        Card(
            modifier = Modifier.fillMaxWidth().clickable { onOpen("countries") },
            colors = CardDefaults.cardColors(containerColor = Panel),
            border = BorderStroke(1.dp, Stroke),
            shape = RoundedCornerShape(15.dp)
        ) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
                    Glyph(0xE622, 25, color = Color(0xFFAE99FF))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Data Plan", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text("Browse country availability and verified plans", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                }
                Glyph(0xE60A, 17, color = Muted)
            }
        }
        Spacer(Modifier.height(10.dp))
        Card(
            modifier = Modifier.fillMaxWidth().clickable { onOpen("apps") },
            colors = CardDefaults.cardColors(containerColor = Panel),
            border = BorderStroke(1.dp, Stroke),
            shape = RoundedCornerShape(15.dp)
        ) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(Panel2), contentAlignment = Alignment.Center) {
                    Glyph(0xE614, 25, color = Color(0xFFAE99FF))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("App Bundle", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text("Browse application data bundles from providers", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                }
                Glyph(0xE60A, 17, color = Muted)
            }
        }
        Spacer(Modifier.height(18.dp))
        Text("Other services", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Spacer(Modifier.height(7.dp))
        SimpleActionRow("Airtime Recharge", "Submit a recharge request where a supplier is connected", 0xE614) { onOpen("airtime") }
        SimpleActionRow("Orders & History", "View your previous order requests", 0xE61B) { onOpen("history") }
        Spacer(Modifier.height(12.dp))
        Text(
            "Plan and bundle lists are shown only when an authorised provider supplies live inventory. No prices or provider speeds are invented.",
            color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 15.sp
        )
    }
}

@Composable
private fun HomeDashboard(
    fullName: String,
    userEmail: String,
    points: String,
    networkLabel: String,
    onOpen: (String) -> Unit
) {
    val greeting = fullName.trim().substringBefore(" ").ifBlank { "there" }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 10.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Image(
                painterResource(R.drawable.geniex_app_icon),
                contentDescription = null,
                modifier = Modifier.size(38.dp),
                contentScale = ContentScale.Fit
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Expert eSIM", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text("Mobile services", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
            }
            Glyph(0xE61F, 22, Modifier.clickable { onOpen("more") }, color = Color(0xFFAE99FF))
        }
        Spacer(Modifier.height(16.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Panel),
            border = BorderStroke(1.dp, Stroke),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text("WELCOME BACK", color = Muted, fontFamily = Poppins, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                Text("Hello, $greeting", color = MainText, fontFamily = Poppins, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    if (userEmail.isNotBlank()) userEmail else "Sign in to access your account and rewards",
                    color = Muted, fontFamily = Poppins, fontSize = 10.sp
                )
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("CURRENT NETWORK", color = Muted, fontFamily = Poppins, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                        Text(networkLabel, color = MainText, fontFamily = Poppins, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                        Text("Detected from this Android device", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                    }
                    Box(
                        Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(Panel2),
                        contentAlignment = Alignment.Center
                    ) { Glyph(0xE61B, 25, color = Color(0xFFAE99FF)) }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = { onOpen("network") },
                    border = BorderStroke(1.dp, Stroke),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Network Detection", color = MainText, fontFamily = Poppins, fontSize = 11.sp)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Card(
                modifier = Modifier.weight(1f).clickable { onOpen("balance") },
                colors = CardDefaults.cardColors(containerColor = Panel),
                shape = RoundedCornerShape(13.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(13.dp)) {
                    Text("REWARD COINS", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                    Text(points, color = MainText, fontFamily = Poppins, fontSize = 23.sp, fontWeight = FontWeight.SemiBold)
                    Text("Points balance", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                }
            }
            Card(
                modifier = Modifier.weight(1f).clickable { onOpen("device") },
                colors = CardDefaults.cardColors(containerColor = Panel),
                shape = RoundedCornerShape(13.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(13.dp)) {
                    Text("DEVICE STATUS", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                    Text(if (networkLabel == "Permission required") "Check device" else "Detected", color = MainText, fontFamily = Poppins, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text("Network and hardware", color = Muted, fontFamily = Poppins, fontSize = 9.sp)
                }
            }
        }
        Spacer(Modifier.height(17.dp))
        Text("Quick access", color = MainText, fontFamily = Poppins, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(7.dp))
        SimpleActionRow("Shop", "Data plans, app bundles and services", 0xE622) { onOpen("shop") }
        SimpleActionRow("App Bundle", "Browse application bundles", 0xE614) { onOpen("apps") }
        SimpleActionRow("My Balance", "Balance and transaction controls", 0xE614) { onOpen("balance") }
        SimpleActionRow("Reward Center", "Daily rewards and tasks", 0xE618) { onOpen("rewards") }
        SimpleActionRow("NetSpeed", "Measure the current Internet connection", 0xE612) { onOpen("speed") }
        SimpleActionRow("Device Information", "Battery, memory, storage and eSIM support", 0xE628) { onOpen("device") }
        Spacer(Modifier.height(12.dp))
        Text(
            "Carrier data, plan availability and eSIM activation are displayed only when confirmed by an authorised service.",
            color = Muted, fontFamily = Poppins, fontSize = 9.sp, lineHeight = 15.sp
        )
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
private fun HeaderBar(title: String, back: () -> Unit, trailing: String = "") {
    Row(
        Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Glyph(0xE608, 22, Modifier.clickable { back() })
        Text(title, modifier = Modifier.weight(1f).padding(start = 12.dp), color = MainText, fontFamily = Poppins, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        if (trailing.isNotBlank()) {
            Box(Modifier.clip(RoundedCornerShape(18.dp)).background(Panel2).padding(horizontal = 13.dp, vertical = 7.dp)) {
                Text(trailing, color = MainText, fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun MorePage(onOpen: (String) -> Unit) {
    val groups = listOf(
        "Connectivity" to listOf(
            MenuItem("Data Plan", "Browse country coverage", 0xE622, "countries"),
            MenuItem("App Bundle", "Application data bundles", 0xE614, "apps"),
            MenuItem("My Balance", "Balance and points", 0xE614, "balance"),
            MenuItem("Network Detection", "Read the active mobile network", 0xE61B, "network"),
            MenuItem("SIM Management", "Android SIM settings", 0xE627, "sim"),
            MenuItem("NetSpeed", "Measure connection speed", 0xE612, "speed")
        ),
        "Account & rewards" to listOf(
            MenuItem("My Account", "Account access and profile", 0xE61F, "account"),
            MenuItem("Free Data", "Reward and task centre", 0xE618, "rewards"),
            MenuItem("My Rewards", "Rewards and points", 0xE625, "rewards"),
            MenuItem("My Vouchers", "Coupons and redemption", 0xE65B, "vouchers"),
            MenuItem("Message", "Notifications and announcements", 0xE637, "messages"),
            MenuItem("Transaction History", "Account activity", 0xE61B, "history")
        ),
        "Device tools & settings" to listOf(
            MenuItem("Battery", "Battery condition and settings", 0xE627, "battery"),
            MenuItem("Device Boosting", "Device information and controls", 0xE612, "boost"),
            MenuItem("Device Information", "Hardware and system details", 0xE628, "device"),
            MenuItem("Settings", "Application settings", 0xE627, "settings"),
            MenuItem("About us", "App information", 0xE628, "about")
        )
    )
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 19.dp)) {
            Card(
                modifier = Modifier.fillMaxWidth().padding(top = 7.dp, bottom = 15.dp),
                colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(9.dp)
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(R.drawable.geniex_app_icon), contentDescription = null, modifier = Modifier.size(40.dp), contentScale = ContentScale.Fit)
                    Spacer(Modifier.width(11.dp))
                    Column {
                        Text("Expert eSIM", color = MainText, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("Mobile services", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                    }
                }
            }
            groups.forEach { (heading, items) ->
                Text(heading, color = Muted, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 2.dp, top = 10.dp, bottom = 8.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    border = BorderStroke(1.dp, Stroke), shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        items.forEachIndexed { index, item ->
                            MenuRow(item) { onOpen(item.page) }
                            if (index != items.lastIndex) HorizontalDivider(color = Stroke, thickness = 0.6.dp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun MenuRow(item: MenuItem, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(57.dp).clickable { onClick() }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(31.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF211B30)), contentAlignment = Alignment.Center) {
            Glyph(item.glyph, 18, color = Color(0xFFAE99FF))
        }
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(item.title, color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text(item.subtitle, color = Muted, fontFamily = Poppins, fontSize = 9.sp)
        }
        Glyph(0xE60A, 15, color = Muted)
    }
}

@Composable
private fun PlanTab(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(8.dp))
            .background(if (selected) Ink else Color.Transparent)
            .clickable { onClick() }.padding(horizontal = 6.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = if (selected) MainText else Muted, fontFamily = Poppins, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, fontSize = 11.sp)
    }
}

@Composable
private fun Glyph(code: Int, size: Int, modifier: Modifier = Modifier, color: Color = MainText) {
    Text(icon(code), modifier = modifier, color = color, fontFamily = GeniexIcons, fontSize = size.sp, lineHeight = (size + 2).sp)
}

@Composable
private fun OutlineAction(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, border = BorderStroke(1.dp, Stroke), shape = RoundedCornerShape(20.dp)) {
        Text(label, color = MainText, fontFamily = Poppins, fontSize = 11.sp)
    }
}

@Composable
private fun PrimaryAction(label: String, glyph: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(8.dp))
            .background(Panel).clickable { onClick() }.padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Glyph(glyph, 18, color = Color(0xFFAE99FF))
        Text(label, Modifier.weight(1f).padding(start = 11.dp), color = MainText, fontFamily = Poppins, fontSize = 12.sp)
        Glyph(0xE60A, 15, color = Muted)
    }
}

@Composable
private fun SimpleActionRow(title: String, subtitle: String, glyph: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(8.dp))
            .background(Panel).clickable { onClick() }.padding(13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Glyph(glyph, 19, color = Color(0xFFAE99FF))
        Column(Modifier.weight(1f).padding(start = 11.dp)) {
            Text(title, color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = Muted, fontFamily = Poppins, fontSize = 10.sp)
        }
        Glyph(0xE60A, 15, color = Muted)
    }
}

@Composable
private fun DetailListPage(detailsTitle: String, details: List<Pair<String, String>>, message: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 12.dp)) {
        if (message.isNotBlank()) {
            Text(message, color = Muted, fontFamily = Poppins, fontSize = 11.sp, lineHeight = 18.sp)
            Spacer(Modifier.height(10.dp))
        }
        if (details.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(230.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Glyph(0xE618, 32, color = Muted)
                    Spacer(Modifier.height(12.dp))
                    Text("No items available", color = MainText, fontFamily = Poppins, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text("The service has not returned any records.", color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                }
            }
        } else {
            details.forEach { (title, subtitle) ->
                Column(Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                    Text(title, color = MainText, fontFamily = Poppins, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    if (subtitle.isNotBlank()) Text(subtitle, color = Muted, fontFamily = Poppins, fontSize = 10.sp)
                    HorizontalDivider(color = Stroke, modifier = Modifier.padding(top = 10.dp))
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 11.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Muted, fontFamily = Poppins, fontSize = 11.sp)
        Text(value, color = MainText, fontFamily = Poppins, fontSize = 11.sp, fontWeight = FontWeight.Medium)
    }
    HorizontalDivider(color = Stroke, thickness = 0.6.dp)
}

@Composable
private fun Metric(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = MainText, fontFamily = Poppins, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(label, color = Muted, fontFamily = Poppins, fontSize = 10.sp)
    }
}

@Composable
private fun FormField(label: String, value: String, onValue: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value, onValueChange = onValue, modifier = Modifier.fillMaxWidth(),
        label = { Text(label, fontFamily = Poppins, fontSize = 12.sp) },
        placeholder = { Text(placeholder, fontFamily = Poppins, fontSize = 11.sp, color = Muted) },
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Purple, unfocusedBorderColor = Stroke,
            focusedContainerColor = Panel, unfocusedContainerColor = Panel,
            focusedTextColor = MainText, unfocusedTextColor = MainText
        )
    )
}

private fun summaryRows(r: JSONObject): List<Pair<String, String>> {
    val s = r.optJSONObject("summary") ?: r
    return listOf(
        "Check-in status" to s.optString("checkInStatus", "Available after sign in"),
        "Points balance" to s.optString("pointsBalance", "—"),
        "Tasks" to s.optString("tasksCount", "—"),
        "Referral rewards" to s.optString("referralRewards", "—")
    ).filter { it.second != "null" && it.second.isNotBlank() }
}

private fun countryFlag(countryCode: String): String {
    val code = countryCode.uppercase(Locale.ROOT)
    if (code.length != 2) return "🌐"
    val first = Character.toChars(0x1F1E6 + (code[0] - 'A'))
    val second = Character.toChars(0x1F1E6 + (code[1] - 'A'))
    return String(first) + String(second)
}
