# Vayun Android Proguard Rules
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.vayun.app.WebAppInterface { *; }

