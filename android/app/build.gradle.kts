plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Optional release signing. Without these variables the release build is
// left unsigned; the debug build always uses the local debug key.
val releaseKeystore: String? = System.getenv("WYZE_CAR_KEYSTORE")

// CI sets these for signed builds: the tag as version name and an increasing
// version code, so a newer build always installs over an older one.
val ciVersionName: String? = System.getenv("WYZE_CAR_VERSION_NAME")?.removePrefix("v")?.takeIf { it.isNotBlank() }
val ciVersionCode: Int? = System.getenv("WYZE_CAR_VERSION_CODE")?.toIntOrNull()?.takeIf { it > 0 }

android {
    namespace = "io.github.jce200.wyzecar"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.jce200.wyzecar"
        minSdk = 26
        targetSdk = 35
        versionCode = ciVersionCode ?: 1
        versionName = ciVersionName ?: "0.1.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("WYZE_CAR_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("WYZE_CAR_KEY_ALIAS")
                keyPassword = System.getenv("WYZE_CAR_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
