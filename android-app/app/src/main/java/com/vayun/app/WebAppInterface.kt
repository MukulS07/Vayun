package com.vayun.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Native bridge interface exposed to WebView JavaScript as `window.VayunAndroid`.
 * Provides haptics, status bar styling, native Android share sheets, and toasts.
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
                vibrator?.vibrate(VibrationEffect.createOneShot(12, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(12)
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
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }
}

