# Capacitor ProGuard rules — required when minifyEnabled true in release builds.
# Without these, R8 strips the JavaScript interface bridge and the WebView breaks.

# Keep Capacitor's core classes and their JavaScript-accessible methods.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keepclassmembers class com.getcapacitor.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep the app's own Capacitor plugin bridge (if any custom plugins exist).
-keep class com.praeventio.guard.** { *; }

# Preserve annotations used by Capacitor at runtime.
-keepattributes *Annotation*

# Keep JavaScript interface methods (WebView.addJavascriptInterface).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve source file names + line numbers for crash stack traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
