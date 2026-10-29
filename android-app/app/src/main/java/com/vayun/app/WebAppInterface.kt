package com.vayun.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Phase 3 Native Bridge Interface exposed to WebView JavaScript as `window.VayunAndroid`.
 * Provides haptic pulses, status bar styling, native Android share sheets, file imports,
 * clipboard access, and network status checks.
 */
class WebAppInterface(private val activity: Activity) {

    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vibratorManager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vibratorManager?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    @JavascriptInterface
    fun hapticFeedback() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(14, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(14)
            }
        } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun setStatusBarColor(colorHex: String, isDarkContent: Boolean) {
        activity.runOnUiThread {
            try {
                val color = Color.parseColor(colorHex)
                activity.window.statusBarColor = color
                activity.window.navigationBarColor = color

                val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
                // isAppearanceLightStatusBars = true means dark icons (for light backgrounds)
                controller.isAppearanceLightStatusBars = !isDarkContent
                controller.isAppearanceLightNavigationBars = !isDarkContent
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun shareText(title: String, content: String) {
        activity.runOnUiThread {
            try {
                val sendIntent: Intent = Intent().apply {
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
    fun copyToClipboard(text: String) {
        activity.runOnUiThread {
            try {
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                val clip = ClipData.newPlainText("Vayun", text)
                clipboard?.setPrimaryClip(clip)
                Toast.makeText(activity, "Copied to clipboard", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun isNetworkAvailable(): Boolean {
        val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            val pInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
            pInfo.versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
    }

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }
}
