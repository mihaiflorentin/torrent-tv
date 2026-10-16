plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version identity comes from the repository VERSION file (major.minor.patch).
// versionCode = major * 10000 + minor * 100 + patch, so 0.10.5 -> 1005. Every
// later release must keep minor and patch below 100 to stay monotonic.
fun deriveVersionCode(major: Int, minor: Int, patch: Int) =
    major * 10000 + minor * 100 + patch

val releaseVersion: String = file("../../../VERSION").readText().trim()
val versionParts = Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(releaseVersion)
    ?.destructured?.toList()?.map { it.toInt() }
    ?: throw GradleException("VERSION must match major.minor.patch, got '$releaseVersion'")
val (verMajor, verMinor, verPatch) = versionParts
require(verMinor < 100 && verPatch < 100) { "VERSION minor and patch must be below 100 for a monotonic versionCode, got '$releaseVersion'" }

// Release keystore: one fixed key from the environment (CI secrets) so builds
// from any machine upgrade each other. Never commit the keystore.
val releaseKeystorePath: String? = System.getenv("TORRENTTV_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val releaseKeystorePassword: String? = System.getenv("TORRENTTV_KEYSTORE_PASSWORD")
val releaseKeyAlias: String? = System.getenv("TORRENTTV_KEY_ALIAS")
val releaseKeyPassword: String? = System.getenv("TORRENTTV_KEY_PASSWORD")
val haveReleaseKeystore = releaseKeystorePath != null && releaseKeystorePassword != null &&
    releaseKeyAlias != null && releaseKeyPassword != null

android {
    namespace = "com.torrenttv.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.torrenttv.app"
        minSdk = 26
        targetSdk = 35
        versionCode = deriveVersionCode(verMajor, verMinor, verPatch)
        versionName = releaseVersion
    }
    signingConfigs {
        if (haveReleaseKeystore) {
            create("torrenttvRelease") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        named("release") {
            isMinifyEnabled = false
            signingConfig = if (haveReleaseKeystore) {
                signingConfigs.getByName("torrenttvRelease")
            } else {
                if (System.getenv("TORRENTTV_REQUIRE_RELEASE_KEY") == "true") {
                    throw GradleException(
                        "TORRENTTV_REQUIRE_RELEASE_KEY is set but TORRENTTV_KEYSTORE_PATH/_KEYSTORE_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD " +
                            "are not all set; refusing to sign a release APK with the debug key."
                    )
                }
                logger.warn(
                    "WARNING: TORRENTTV_KEYSTORE_PATH/_KEYSTORE_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD not all set; " +
                        "signing the release APK with the debug key. It will not upgrade a keystore-signed install."
                )
                signingConfigs.getByName("debug")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

// Sync the shared TV web app into WebView assets. index.html is the Android
// page variant (TorrentTV branding, no $WEBAPIS tag, platform-bridge.js);
// everything else — app.js, app.css, boot scripts — ships byte-identical to
// the Tizen WGT.
val syncWebApp = tasks.register<Sync>("syncWebApp") {
    // Fail loudly instead of packaging a shell without its app: the web
    // bundle must be built before this task runs.
    doFirst {
        if (!file("../../tv/dist/app.js").exists()) {
            throw GradleException("clients/tv/dist is missing — run 'npm run build -w @torrent-tv/tv' first")
        }
    }
    from("../../tv/dist") { exclude("index.html") }
    from("assets/index.html")
    from("assets/platform-bridge.js")
    into("src/main/assets/www")
}
tasks.named("preBuild") { dependsOn(syncWebApp) }

// Build check: fail if the Android identity ever stops matching VERSION.
val verifyVersion = tasks.register("verifyVersion") {
    doLast {
        val dc = android.defaultConfig
        check(dc.versionName == releaseVersion) { "versionName ${dc.versionName} != VERSION $releaseVersion" }
        check(dc.versionCode == deriveVersionCode(verMajor, verMinor, verPatch)) {
            "versionCode ${dc.versionCode} does not match VERSION $releaseVersion"
        }
    }
}
tasks.named("preBuild") { dependsOn(verifyVersion) }
