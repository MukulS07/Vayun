package com.vayun.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference

/**
 * Phase 3 Native Bridge Interface exposed to WebView JavaScript as `window.VayunAndroid`.
 * Provides haptic pulses, status bar styling, native Android share sheets, file exports via FileProvider,
 * clipboard access, and network status checks with full memory safety and lifecycle protection.
 */
@Suppress("unused")
class WebAppInterface(activity: Activity) {

    private val activityRef: WeakReference<Activity> = WeakReference(activity)
    private val appContext: Context = activity.applicationContext

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    @JavascriptInterface
    fun hapticFeedback() {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            try {
                val decorView = activity.window?.decorView
                val performed = decorView?.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP) ?: false

                if (!performed) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator?.vibrate(VibrationEffect.createOneShot(14, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator?.vibrate(14)
                    }
                }
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun setStatusBarColor(colorHex: String, isDarkContent: Boolean) {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            try {
                val color = parseCssColor(colorHex) ?: return@runOnUiThread
                @Suppress("DEPRECATION")
                activity.window.statusBarColor = color
                @Suppress("DEPRECATION")
                activity.window.navigationBarColor = color
                // Edge-to-edge (Android 15+) ignores the bar colors above, so the strips behind the
                // padded WebView show the window background; keep it in step with the page theme.
                activity.window.setBackgroundDrawable(ColorDrawable(color))

                val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
                // isAppearanceLightStatusBars = true means dark icons (for light backgrounds)
                controller.isAppearanceLightStatusBars = !isDarkContent
                controller.isAppearanceLightNavigationBars = !isDarkContent
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun shareText(title: String, content: String) {
        val activity = activityRef.get() ?: return
        if (activity.isFinishing || activity.isDestroyed) return

        activity.runOnUiThread {
            try {
                val sendIntent = Intent().apply {
                    action = Intent.ACTION_SEND
                    putExtra(Intent.EXTRA_TITLE, title)
                    putExtra(Intent.EXTRA_TEXT, content)
                    type = "text/plain"
                }
                val shareIntent = Intent.createChooser(sendIntent, title)
                activity.startActivity(shareIntent)
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun shareFile(fileName: String, content: String, mimeType: String) {
        val activity = activityRef.get() ?: return
        if (activity.isFinishing || activity.isDestroyed) return

        activity.runOnUiThread {
            try {
                val exportDir = File(appContext.cacheDir, "exports").apply { mkdirs() }
                val targetFile = File(exportDir, fileName)
                FileOutputStream(targetFile).use { out ->
                    out.write(content.toByteArray(Charsets.UTF_8))
                }

                val uri = FileProvider.getUriForFile(
                    appContext,
                    "${appContext.packageName}.fileprovider",
                    targetFile
                )

                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType.ifBlank { "application/octet-stream" }
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_TITLE, fileName)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(sendIntent, fileName).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(chooser)
            } catch (_: Exception) {
                // Fallback to text sharing if file writing encounters an error
                shareText(fileName, content)
            }
        }
    }

    @JavascriptInterface
    fun copyToClipboard(text: String) {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            try {
                val clipboard = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                val clip = ClipData.newPlainText("Vayun", text)
                clipboard?.setPrimaryClip(clip)
                // Android 13+ (API 33+) provides its own native clipboard popup
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    Toast.makeText(appContext, activity.getString(R.string.copied_to_clipboard), Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun isNetworkAvailable(): Boolean {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            val pInfo = appContext.packageManager.getPackageInfo(appContext.packageName, 0)
            pInfo.versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
    }

    @JavascriptInterface
    fun showToast(message: String) {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            Toast.makeText(appContext, message, Toast.LENGTH_SHORT).show()
        }
    }

    private fun parseCssColor(raw: String): Int? {
        val trimmed = raw.trim()
        if (trimmed.startsWith("#")) {
            return try { Color.parseColor(trimmed) } catch (_: Exception) { null }
        }
        if (trimmed.startsWith("rgb", ignoreCase = true)) {
            val parts = trimmed.substringAfter("(").substringBefore(")").split(",")
            if (parts.size >= 3) {
                val r = parts[0].trim().toIntOrNull() ?: return null
                val g = parts[1].trim().toIntOrNull() ?: return null
                val b = parts[2].trim().toIntOrNull() ?: return null
                val a = if (parts.size >= 4) {
                    val alphaFloat = parts[3].trim().toFloatOrNull() ?: 1f
                    (alphaFloat * 255).toInt().coerceIn(0, 255)
                } else 255
                return Color.argb(a, r, g, b)
            }
        }
        return null
    }
}
