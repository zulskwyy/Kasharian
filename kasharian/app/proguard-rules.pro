# JavaScript interface calls are made by name from the bundled offline UI.
-keepattributes *Annotation*
-keep class id.kasharian.app.MainActivity { *; }
-keep class id.kasharian.app.MainActivity$NativeBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# SQLCipher Java/JNI entry points and native library bindings.
-keep class net.zetetic.database.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
