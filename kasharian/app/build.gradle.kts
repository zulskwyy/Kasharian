plugins {
    id("com.android.application")
}

val releaseKeyPath = System.getenv("KASHARIAN_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("KASHARIAN_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("KASHARIAN_KEY_ALIAS")
val releaseKeyPassword = System.getenv("KASHARIAN_KEY_PASSWORD")

android {
    namespace = "id.kasharian.app"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "id.kasharian.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 110
        versionName = "1.0.10"
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        create("release") {
            if (!releaseKeyPath.isNullOrBlank()) {
                storeFile = file(releaseKeyPath)
            }
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isDebuggable = true
        }
        release {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*", "META-INF/NOTICE*"
        )
    }

    lint {
        checkReleaseBuilds = true
        abortOnError = false
    }
}

val forbiddenReleaseArtifacts = listOf(
    "firebase-auth", "firebase-appcheck", "com.google.firebase",
    "play-services-auth", "androidx.credentials", "com.google.android.play:core",
    "androidx.compose.ui:ui-tooling"
)

tasks.register("assertReleaseClean") {
    doLast {
        val keyFile = releaseKeyPath?.let { file(it) }
        check(keyFile != null && keyFile.isFile) {
            "KASHARIAN_KEYSTORE_FILE tidak ditemukan. Build release tidak boleh memakai kunci debug."
        }
        check(!releaseStorePassword.isNullOrBlank() && !releaseKeyPassword.isNullOrBlank() && !releaseKeyAlias.isNullOrBlank()) {
            "Lengkapi seluruh secret penandatanganan APK di GitHub Actions."
        }
        val release = android.buildTypes.getByName("release")
        check(!release.isDebuggable) { "Release masih debuggable." }
        check(release.isMinifyEnabled && release.isShrinkResources) { "R8 dan resource shrinking wajib aktif." }
        val resolved = configurations.getByName("releaseRuntimeClasspath").resolvedConfiguration.resolvedArtifacts
        val bad = resolved.map { it.moduleVersion.id.toString() }
            .filter { id -> forbiddenReleaseArtifacts.any { id.contains(it, ignoreCase = true) } }
        check(bad.isEmpty()) { "Dependensi terlarang ditemukan pada release: $bad" }
    }
}

tasks.matching { it.name == "assembleRelease" || it.name == "bundleRelease" }.configureEach {
    dependsOn("assertReleaseClean")
}

dependencies {
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.sqlite:sqlite:2.7.0")
    implementation("net.zetetic:sqlcipher-android:4.20.0")
}
