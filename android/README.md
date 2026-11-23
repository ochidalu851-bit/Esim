# Expert eSIM Android companion

This native Android companion hosts the Expert eSIM one-button interface and exposes a limited JavaScript bridge to Android's public EuiccManager APIs.

## Build

Run:

    gradle -p android :app:assembleDebug

The APK is written to:

    android/app/build/outputs/apk/debug/app-debug.apk

The GitHub Actions workflow at .github/workflows/android-apk.yml builds a debug APK when Android project files change or when manually triggered.

## eSIM activation requirements

- The phone must expose eUICC/eSIM hardware and have Android eSIM support enabled.
- A real carrier/wholesale partner must issue an eSIM profile labelled Expert eSIM and install it on the device.
- The provider's profile metadata must grant the required carrier privileges, or Android must present and receive the required user approval.
- Android may require the user to free an eSIM port by disabling another active subscription.
- A normal third-party app cannot silently grant itself privileged telephony permissions or guarantee that the default mobile-data SIM changes. The user may need to select the eSIM in Android SIM settings.
- Disabling the Expert eSIM profile does not guarantee that every Android OEM automatically reactivates the same physical SIM or restores it as the default data subscription.

The app reports failures from Android rather than simulating a successful connection. It does not include a carrier profile, activation code, or provider credentials.
