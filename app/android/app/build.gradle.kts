import java.net.URI
import java.util.Base64

plugins {
    id("com.android.application")
    id("com.google.gms.google-services") version "4.5.0"
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Flutter passes every `--dart-define` as one comma-separated list of base64
// `NAME=value` pairs, so the Dart program and the manifest read the same switches.
fun dartDefine(name: String): String? = (project.findProperty("dart-defines") as? String)
    .orEmpty()
    .split(",")
    .mapNotNull { runCatching { String(Base64.getDecoder().decode(it)) }.getOrNull() }
    .firstOrNull { it.startsWith("$name=") }
    ?.substringAfter("=")

// One build switch controls both Dart transport and the cleartext manifest.
val localDevelopment = dartDefine("FROCKBOT_LOCAL_DEV") == "true"

// The App Link host is the deployment's own, never a host written into this file:
// whoever builds passes `--dart-define=FROCKBOT_ORIGIN=…` (README.md).
val deploymentHost = dartDefine("FROCKBOT_ORIGIN")?.let { URI(it).host }

// DexBot's application id and label, written once in `identity.xcconfig` beside
// `pubspec.yaml` and read here as plain `KEY = value` lines.
val identity: Map<String, String> = rootProject.file("../identity.xcconfig").readLines()
    .map { it.substringBefore("//").trim() }
    .filter { it.contains("=") }
    .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim() }
fun identity(key: String): String = identity[key] ?: error("identity.xcconfig names no $key")

// Push needs DexBot's own Firebase registration (`google-services.json`), which
// does not exist yet. Without the file the build skips Firebase's resource task
// and the app runs with no push, as FrockBot's development build does.
tasks.matching { it.name.endsWith("GoogleServices") }.configureEach {
    onlyIf { file("google-services.json").isFile }
}

android {
    // The Kotlin sources' package; the installed identity is `applicationId`.
    namespace = "com.dexbot.app"
    // Secure storage 11 requires API 37 at compile time; device floor/target remain 24/36.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion
    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = identity("DEXBOT_ANDROID_APPLICATION_ID")
        manifestPlaceholders["appLabel"] = identity("DEXBOT_APP_NAME")
        manifestPlaceholders["cleartext"] = localDevelopment.toString()
        // A build that names no deployment claims no App Link. `.invalid` never
        // resolves, so a forgotten define cannot claim another deployment's links;
        // the Dart client refuses such a build outright at its first request.
        manifestPlaceholders["linkHost"] = when {
            localDevelopment -> "localhost"
            deploymentHost != null -> deploymentHost
            else -> "unnamed.invalid"
        }
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 24
        targetSdk = 36
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        val acceptance = dartDefine("NATIVE_ACCEPTANCE") == "true"
        buildConfigField("boolean", "NATIVE_ACCEPTANCE", acceptance.toString())
        // The notification tap target opens this deployment's own document, so
        // Kotlin reads the same host the App Link filter was built with.
        buildConfigField(
            "String",
            "LINK_HOST",
            "\"" + manifestPlaceholders["linkHost"] + "\"",
        )
        // A push that arrives without a title is titled with the product's name.
        buildConfigField("String", "APP_NAME", "\"" + identity("DEXBOT_APP_NAME") + "\"")
    }

    buildTypes {
        release {
            // DexBot has no release signing yet. Signing with the debug keys for
            // now, so `flutter run --release` works; a store build needs its own.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.17.0")
    // The badge reconcile rule is pure Kotlin so it can be run here rather
    // than on a device. `:app:testDebugUnitTest` covers it, and the pull
    // request's `Flutter` job runs that task, so a Kotlin source that stops
    // compiling fails a check rather than the next release build.
    testImplementation("junit:junit:4.13.2")
}
