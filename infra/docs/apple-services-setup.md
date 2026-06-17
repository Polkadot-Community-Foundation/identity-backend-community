# Apple Services Setup Walkthrough — Operator Guide

This document is the authoritative operator guide for provisioning Apple App Attest, DeviceCheck, and APNs credentials used by this backend. All UI labels are quoted verbatim from Apple's developer portal as of the current portal structure. Where Apple's docs use a different name for a screen or field, both names are shown.

---

## Flow 1: App Attest Setup

### Prerequisites

**Required role:** Account Holder or **Admin** (includes App Manager permissions to manage certificates, identifiers, and keys).

**Required setup before starting:**

- Paid Apple Developer Program membership (organization or individual). Organizations need a D-U-N-S number; enrollment takes 1–2 business days for organizations, instant for individuals. Source: [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)
- Access to [developer.apple.com](https://developer.apple.com) → "Certificates, Identifiers & Profiles"
- A macOS device is not required; the web portal handles all registration.

**What you need to know before starting:**

- `APPLE_TEAM_ID` — found on the Apple Developer membership page (top-right account dropdown → "Membership")
- `APPLE_APP_ATTEST_APP_IDS` — a JSON array of bundle IDs, e.g. `["com.example.myapp"]`

---

### Click-by-click Walkthrough

#### Step 1 — Confirm Program Enrollment

1. Navigate to [developer.apple.com](https://developer.apple.com)
2. Click **Account** in the top navigation
3. Sign in with your Apple Developer account
4. Click **Membership** in the left sidebar
5. Confirm: "Apple Developer Program" status shows **Active**, and note your **Team ID** (a 10-character alphanumeric string, e.g. `A1B2C3D4E5`)

#### Step 2 — Register an App ID (Explicit Bundle ID)

Apple App Attest requires an **Explicit App ID** (also called a "Bundle ID"). Wildcard App IDs (ending in `*`) cannot use App Attest.

1. Navigate to [developer.apple.com](https://developer.apple.com) → **Account** → **Certificates, Identifiers & Profiles**
2. In the left sidebar under **Identifiers**, click **+** (Register a new identifier)
3. On "Register a new identifier", select **App IDs** → **App** → **Continue**
4. On the "Register an App ID" form:
   - **Description**: `My App Name` (human-readable, shown only in this portal)
   - **Bundle ID**: select **Explicit** (not Wildcard)
   - **Bundle ID field**: `com.example.myapp` (reverse-domain format; must match your app's `CFBundleIdentifier` in `Info.plist` exactly — this is the value for `APPLE_APP_ATTEST_APP_IDS`)
   - **Capabilities**: scroll down and check at minimum:
     - ✓ **App Attest** (enables the server-side App Attest capability)
     - ✓ **Push Notifications** (required for APNs; App Attest alone does not include it)
     - ✓ **Sign in with Apple** (if your app uses it — check with your mobile team)
5. Click **Continue** → **Register**

> **Note:** The "App Attest" capability checkbox in the App ID registration form is informational. App Attest is enabled server-side by the App Attest key registration in Step 3. The App ID's capability row confirms the team has registered the feature. Source: [developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity](https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity)

#### Step 3 — Register an App Attest Key

1. In **Certificates, Identifiers & Profiles**, in the left sidebar under **Keys**, click **+** (Register a new key)
2. On "Register a new key":
   - **Key Name**: `App Attest Key` (or any descriptive name)
   - Under **Key Options**, check **App Attest**
   - Optionally also check **Sign in with Apple** if your app uses it (a separate key is also valid)
3. Click **Continue**
4. On the confirmation screen, verify **App Attest** is listed under "Enabled Keys"
5. Click **Register**
6. On the key detail screen, note:
   - **Key ID**: a 10-character alphanumeric string (e.g. `A1B2C3D4E5`) — this is NOT used directly in the server config; the key ID is embedded in the app's attestation object and validated by Apple's servers
   - **Team ID**: shown below the key name — confirm it matches your `APPLE_TEAM_ID`
7. Click **Download** to save `AuthKey_<KeyID>.p8`

> **⚠️ Download is one-time only.** Apple does not re-display the private key after this screen. Store it securely (password manager, secrets vault). If lost, you must revoke and recreate the key.

#### Step 4 — Enable the App Attest Capability (Confirm)

The App Attest capability is automatically enabled for any Explicit App ID once the App Attest key is registered. To confirm:

1. Go to **Certificates, Identifiers & Profiles** → **Identifiers**
2. Click your App ID (`com.example.myapp`)
3. Scroll to the **Capabilities** section
4. Confirm **App Attest** shows as enabled (green checkmark or "Enabled" badge)

---

### Resulting Credential Shape

| Config Key                 | Value                                                       |
| -------------------------- | ----------------------------------------------------------- |
| `APPLE_TEAM_ID`            | `A1B2C3D4E5` (10-char string from membership page)          |
| `APPLE_APP_ATTEST_APP_IDS` | `["com.example.myapp"]` (JSON array of explicit bundle IDs) |

**No private key is stored in server config.** App Attest is a server-validates-client flow:

- The iOS app generates an attestation object using `DCAppAttestService.shared.attestKey(_:clientDataHash:completionHandler:)` with the key created on-device
- The app sends the attestation to `POST /api/v1/auth/ios/attestation` on the server
- The server validates it against Apple's App Attest service
- The App Attest key downloaded in Step 3 is **not used by the server** — it is used only by Apple to validate attestations. The server only needs the `APPLE_TEAM_ID` and `APPLE_APP_ATTEST_APP_IDS`.

**Source:** [developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity](https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity)

---

### Server-Side Configuration

```bash
APPLE_TEAM_ID=A1B2C3D4E5
APPLE_APP_ATTEST_APP_IDS=["com.example.myapp"]
DEVICE_CHECK_IOS_ENABLED=false  # EXPERIMENTAL — do not enable in production
ENFORCE_AUTH=false              # true = hard gate (blocking), false = soft gate (advisory log)
```

---

### Verification

1. **If testing the experimental DeviceCheck feature:** set `DEVICE_CHECK_IOS_ENABLED=true` and `ENFORCE_AUTH=true`
2. Build and install the iOS app on a **physical device** (App Attest is not available in the iOS Simulator)
3. Perform a fresh install and attempt to register a username
4. The app calls `DCAppAttestService.shared.attestKey(...)` to create a key pair, then `generateAssertion(...)` to sign a challenge
5. The server's `POST /api/v1/auth/ios/attestation` receives the attestation object
6. If the Bundle ID in the attestation matches an entry in `APPLE_APP_ATTEST_APP_IDS` and `ENFORCE_AUTH=true`, the request proceeds; otherwise, the server returns 4xx

**Server logs to check:** `Apple App Attest verification passed` (info) or `App Attest verification failed: <reason>` (warning)

---

### Common Errors

| Error                                           | Cause                                                                                         | How to Identify                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `App Attest is not available on this device`    | Running on iOS Simulator or unsupported hardware                                              | Physical device required                                                   |
| `Invalid attestation — key ID mismatch`         | Bundle ID in `APPLE_APP_ATTEST_APP_IDS` does not match the app that generated the attestation | Check the Bundle ID in App Store Connect → App → General → App Information |
| `Invalid attestation — team ID mismatch`        | `APPLE_TEAM_ID` does not match the team that owns the App ID                                  | Verify team ID on Apple Developer membership page                          |
| `Attestation rejected — clock skew`             | Server clock is more than 30 seconds off from Apple's servers                                 | Run `ntpdate -q time.apple.com` to check                                   |
| `Attestation rejected — replay attack detected` | The same attestation nonce was used twice                                                     | Apple detects replay; client must use a fresh nonce per attestation        |

---

## Flow 2: DeviceCheck Setup

> **⚠️ EXPERIMENTAL — Do not enable in production.**
> The Apple DeviceCheck SDK, server-side enforcement, and two-bit state management are not production-hardened.
> Production deployments must leave `DEVICE_CHECK_IOS_ENABLED=false`.

### Prerequisites

**Required role:** Account Holder or **Admin** (same as App Attest).

**Required setup before starting:**

- An Explicit App ID already registered (from Flow 1, Step 2)
- `APPLE_TEAM_ID` from the membership page
- The DeviceCheck key (`.p8`) registered below

**What `DEVICE_CHECK_PRIVATE_KEY` expects:** The raw PEM string (PKCS#8 ECDSA P-256 private key from the `.p8` file, as plain text). Not base64-encoded. The server passes this directly to `jose`'s `importPKCS8()`.

---

### Click-by-click Walkthrough

#### Step 1 — Register a DeviceCheck Key

1. Navigate to **Certificates, Identifiers & Profiles** → **Keys** → **+**
2. On "Register a new key":
   - **Key Name**: `DeviceCheck Key` (or any descriptive name)
   - Under **Key Options**, check **DeviceCheck** (do NOT check App Attest here — they are separate keys)
3. Click **Continue**
4. On the confirmation screen, verify **DeviceCheck** is listed under "Enabled Keys"
5. Click **Register**
6. On the key detail screen, note:
   - **Key ID**: a 10-character string (e.g. `F7G8H9I0J1`) — this is `DEVICE_CHECK_KEY_ID`
   - **Team ID**: confirm it matches your `APPLE_TEAM_ID`
7. Click **Download** to save `AuthKey_<KeyID>.p8`

> **⚠️ Download is one-time only.** Store securely.

#### Step 2 — Prepare the .p8 for the Server

Open the downloaded `AuthKey_<KeyID>.p8` in a text editor. It looks like:

```
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
[base64-encoded PKCS#8 ECDSA P-256 key, typically 1–2 lines]
-----END PRIVATE KEY-----
```

**The server expects the raw PEM string as the `DEVICE_CHECK_PRIVATE_KEY` value — no base64 wrapper, no binary encoding.**

To confirm your file is correctly formatted for DeviceCheck, run:

```bash
# Verify it's a valid EC P-256 key
openssl ec -in AuthKey_XXXXXXXXXX.p8 -text -noout 2>&1 | head -5
# Expected output includes: "ASN1 OID: prime256v1" (i.e., P-256)
```

---

### Resulting Credential Shape

| Config Key                   | Value                                    | Example                                                              |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `DEVICE_CHECK_KEY_ID`        | The Key ID from the key detail page      | `F7G8H9I0J1`                                                         |
| `DEVICE_CHECK_PRIVATE_KEY`   | Raw PEM string from the `.p8` file       | `-----BEGIN PRIVATE KEY-----\nMIGHAgE...\n-----END PRIVATE KEY-----` |
| `DEVICE_CHECK_URL`           | Apple DeviceCheck API URL (default)      | `https://api.devicecheck.apple.com/v1`                               |
| `APPLE_TEAM_ID`              | From membership page                     | `A1B2C3D4E5`                                                         |
| `DEVICE_CHECK_IOS_ENABLED`   | `false` (EXPERIMENTAL)                   | `false`                                                              |
| `DEVICE_CHECK_RESET_ENABLED` | `false` (must be `false` when DC is off) | `false`                                                              |
| `ENFORCE_AUTH`               | `true` = hard block, `false` = soft gate | `false`                                                              |

**JSON array format for `DEVICE_CHECK_PRIVATE_KEY`:** Not applicable — this is a multi-line PEM string. Set it in your secrets manager as a raw string or secret block. In `.sst.toml` / SST secrets:

```bash
# Example: setting as an SST secret (the \n must be literal newlines)
DEVICE_CHECK_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...\n-----END PRIVATE KEY-----"
```

**Source:** [developer.apple.com/documentation/devicecheck](https://developer.apple.com/documentation/devicecheck)

---

### Server-Side Flow

The server uses `jose`'s `importPKCS8()` to load the PEM key, then signs a JWT with `ES256` (ECDSA P-256). The JWT:

- `iss` / `aud`: `https://api.devicecheck.apple.com/v1`
- `iat`: issued-at timestamp
- JWT is cached for 10 minutes with a 30-second grace period before refresh

On `POST /api/v1/usernames` (iOS), the server calls Apple's `queryTwoBits` endpoint:

- If the device has already registered a username → the two-bit state is non-zero → server returns 4xx
- If the device has never registered → state is zero → registration proceeds

**Admin reset endpoint:** `POST /api/v1/admin/device-check/reset` (requires `ADMIN_ROUTE_ENABLED=true` and `DEVICE_CHECK_RESET_ENABLED=true`). Accepts `{"deviceToken": "<base64-encoded-device-token>"}`. This is irreversible — Apple's two-bit state is permanently cleared.

---

### Verification

1. **If testing the experimental DeviceCheck feature:** enable `DEVICE_CHECK_IOS_ENABLED=true` and `ENFORCE_AUTH=true`
2. On a physical iOS device, register a username (e.g. `alice`)
3. Confirm registration succeeds — server logs: `DeviceCheck passed, device token available`
4. Attempt to register the same device with a second username
5. The second attempt must be rejected with a 4xx — server logs: `DeviceCheckAlreadyUsed`
6. To reset: call `POST /api/v1/admin/device-check/reset` with the device token, then re-attempt registration

**Device token:** The iOS device token for DeviceCheck is distinct from the APNs device token. The server extracts it from the `Auth-Device-Check-Token` header on `POST /api/v1/usernames`.

---

### Common Errors

| Error                                      | Cause                                                    | How to Identify                                                   |
| ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `DEVICE_CHECK_PRIVATE_KEY` startup failure | PEM string is malformed (missing `\n`, wrong format)     | Server fails to start; `jose` import error in logs                |
| `Invalid provider token`                   | JWT signing failed (wrong key, wrong team ID, expired)   | Apple returns HTTP 401; server logs: `DeviceCheck API error: 401` |
| `DeviceCheck token missing`                | iOS app did not send `Auth-Device-Check-Token` header    | Server logs: `DeviceCheckInactive`                                |
| `DeviceCheck evaluation failed`            | Apple's API returned an error                            | Server logs: `DeviceCheckFailed: <cause>`                         |
| All registrations pass silently            | `DEVICE_CHECK_IOS_ENABLED=false` (default — use in production) or `ENFORCE_AUTH=false` | For DC testing set both to `true`; for production keep `DEVICE_CHECK_IOS_ENABLED=false` |

---

## Flow 3: APNs Setup

### Prerequisites

**Required role:** Account Holder or **Admin**.

**Required setup before starting:**

- `APPLE_TEAM_ID` from membership page
- Explicit App ID with **Push Notifications** capability enabled (from Flow 1, Step 2)
- `APN_KEY_ID` and `APN_PRIVATE_KEY` from the key registration below
- For `DUAL_FLOW_NOTIFICATIONS_ENABLED=true`: also `APN_KEY_ID_DEV` and `APN_PRIVATE_KEY_DEV`

---

### Click-by-click Walkthrough

#### Step 1 — Confirm App ID Push Notifications Capability

1. Navigate to **Certificates, Identifiers & Profiles** → **Identifiers**
2. Click your App ID (`com.example.myapp`)
3. Scroll to **Capabilities**
4. Confirm **Push Notifications** shows as enabled

If not enabled:

- Click **Edit** at the top of the Capabilities section
- Check **Push Notifications**
- Click **Save** (requires no additional provisioning for token-based auth; APNs certificates are separate)

#### Step 2 — Register an APNs Auth Key

One APNs key can be reused across all apps in the same team (unlike APNs certificates which are per-app).

1. Navigate to **Certificates, Identifiers & Profiles** → **Keys** → **+**
2. On "Register a new key":
   - **Key Name**: `APNs Auth Key` (or any descriptive name)
   - Under **Key Options**, check **Apple Push Notifications service (APNs)**
3. Click **Continue**
4. On the confirmation screen, verify **Apple Push Notifications service (APNs)** is listed under "Enabled Keys"
5. Click **Register**
6. On the key detail screen, note:
   - **Key ID**: e.g. `B2C3D4E5F6` — this is `APN_KEY_ID`
   - **Team ID**: confirm matches `APPLE_TEAM_ID`
7. Click **Download** to save `AuthKey_<KeyID>.p8`

> **⚠️ Download is one-time only.** Apple does not re-display the key.

#### Step 3 — Determine Your Bundle IDs (APN Topics)

**APN Topics** are the app's Bundle IDs. Find them in:

- **App Store Connect**: [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → your app → **General** → **App Information** → **Bundle ID**
- **Xcode**: Your app's `Info.plist` → `CFBundleIdentifier`

The server's `APN_TOPICS` config must be a JSON array of these bundle ID strings, e.g.:

```bash
APN_TOPICS=["com.example.myapp", "com.example.myapp.develop"]
```

The **development suffix** pattern (for `DUAL_FLOW_NOTIFICATIONS_ENABLED`) is configurable via `APN_DEVELOPMENT_SUFFIXES`. The default is `[".develop"]`. Any topic whose bundle ID ends with `.develop` (case-insensitive) is routed to both sandbox and production APNs when dual-flow is enabled.

---

### Resulting Credential Shape

| Config Key                        | Value                                            | Example                                     |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `APN_KEY_ID`                      | Key ID from Step 2                               | `B2C3D4E5F6`                                |
| `APN_PRIVATE_KEY`                 | Base64-encoded `.p8` file content                | `LS0tLS1CRUdJTiBQU...` (see encoding below) |
| `APN_TEAM_ID`                     | Team ID from membership page                     | `A1B2C3D4E5`                                |
| `APN_PRODUCTION`                  | `true`=production, `false`=sandbox (default)     | `false`                                     |
| `APN_TOPICS`                      | JSON array of bundle IDs                         | `["com.example.myapp"]`                     |
| `APN_DEVELOPMENT_SUFFIXES`        | JSON array of suffixes (default: `[".develop"]`) | `[".develop"]`                              |
| `DUAL_FLOW_NOTIFICATIONS_ENABLED` | `true` to fan out to both envs                   | `false`                                     |

#### Transform: `APN_PRIVATE_KEY` — Base64 Encode the .p8 File Bytes

The server decodes the base64 value back to raw bytes and passes the raw file content to `@parse/node-apn`. The `.p8` file is a PEM-encoded PKCS#8 ECDSA P-256 key. **You must base64-encode the raw file bytes, not the PEM text.**

```bash
# Encode the .p8 file to base64
APN_PRIVATE_KEY=$(base64 -w 0 AuthKey_XXXXXXXXXX.p8)
# On macOS:  APN_PRIVATE_KEY=$(base64 -b 0 AuthKey_XXXXXXXXXX.p8)

# Verify (should show "PKCS#8 EC PRIVATE KEY")
echo "$APN_PRIVATE_KEY" | base64 -d | openssl pkey -inform DER 2>/dev/null | openssl pkey -text -noout | head -3
```

Set in SST secrets:

```bash
APN_PRIVATE_KEY=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UU...
```

If `DUAL_FLOW_NOTIFICATIONS_ENABLED=true`, you also need:

| Config Key            | Value                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| `APN_KEY_ID_DEV`      | Development key ID (can be same as `APN_KEY_ID` if reusing the same key)              |
| `APN_PRIVATE_KEY_DEV` | Base64-encoded `.p8` content for the dev key (can be same value as `APN_PRIVATE_KEY`) |

---

### APNs Token-Based Authentication

The server uses `@parse/node-apn` to manage the HTTP/2 connection and JWT signing. The library handles:

- **JWT algorithm**: ES256 (ECDSA P-256)
- **JWT `kid` header**: `APN_KEY_ID`
- **JWT `iss` claim**: `APPLE_TEAM_ID`
- **JWT `aud` claim**: `https://api.push.apple.com` (production) or `https://api.sandbox.push.apple.com` (sandbox)
- **Token expiry**: handled by the library (typically re-signed every 30–60 minutes; old tokens are valid for up to 1 hour)

**Source:** [developer.apple.com/documentation/usernotifications/establishing_a_token-based_connection_to_apns](https://developer.apple.com/documentation/usernotifications/establishing_a_token-based_connection_to_apns)

---

### The `APN_PRODUCTION` Flag

| `APN_PRODUCTION`  | Effect                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `true`            | Sends to **production** APNs (`api.push.apple.com`) for topics not matching `APN_DEVELOPMENT_SUFFIXES`      |
| `false` (default) | Sends to **sandbox** APNs (`api.sandbox.push.apple.com`) for topics not matching `APN_DEVELOPMENT_SUFFIXES` |

Topics matching `APN_DEVELOPMENT_SUFFIXES` (default: any bundle ID ending in `.develop`) are always sent to **both** sandbox and production when `DUAL_FLOW_NOTIFICATIONS_ENABLED=true`.

---

### The `DUAL_FLOW_NOTIFICATIONS_ENABLED` Flag

When `true`:

- For any `APN_TOPICS` entry whose bundle ID (case-insensitively) ends with any string in `APN_DEVELOPMENT_SUFFIXES` (default: `.develop`)
- The server fans out the notification to **both** `development` and `production` APNs environments simultaneously
- This supports a single TestFlight build that must reach both sandbox and production tokens

When `false` (default): each topic routes to only one environment based on `APN_PRODUCTION`.

---

### Verification

1. Set `APN_PRODUCTION=false` for initial testing (uses sandbox)
2. Install the iOS app on a physical device and note the APNs device token from `AppDelegate` / `UNUserNotificationCenterDelegate`
3. Send a test notification via the server's `POST /api/v1/notify` route (or via your app's notification trigger)
4. Check server logs for APNs response:

**Success (HTTP 200 from APNs):**

```
APNs push sent topic=com.example.myapp environment=development sent=1 failed=0
```

**Failure:**

```
APNs push completed with failures topic=com.example.myapp environment=development sent=0 failed=1 reasons=["BadDeviceToken"]
```

5. The iOS device should display the notification if:
   - The device token matches the environment (`APN_PRODUCTION=false` + sandbox token, or `APN_PRODUCTION=true` + production token)
   - The app has granted notification permissions
   - The bundle ID (`topic`) matches the `APN_TOPICS` config

**Source:** [developer.apple.com/documentation/usernotifications](https://developer.apple.com/documentation/usernotifications)

---

### Common Errors

| APNs Reason Code                  | Meaning                                                                                                                    | Resolution                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BadDeviceToken`                  | Token is stale (app uninstalled and reinstalled, or sandbox token used in production, or vice versa)                       | App must re-register its device token with the server                                                         |
| `Unregistered`                    | Same as BadDeviceToken — device token has been invalidated by Apple                                                        | Same as above                                                                                                 |
| `TopicDisallowed`                 | The `topic` (bundle ID) is not authorized for this team, or the Push Notifications capability is not enabled on the App ID | Verify the App ID has Push Notifications enabled; verify `APN_TOPICS` contains only bundle IDs your team owns |
| `InvalidProviderToken`            | The JWT signing failed — key ID, team ID, or key content is wrong                                                          | Regenerate the APNs key; confirm `APN_KEY_ID` and `APN_TEAM_ID` are correct                                   |
| `Forbidden` (HTTP 403)            | The `.p8` key is wrong, or the team does not have the Push Notifications capability enabled                                | Verify key registration; verify App ID capabilities                                                           |
| `MissingProviderToken` (HTTP 400) | No JWT token sent with the request                                                                                         | Server-side bug; check that `APN_PRIVATE_KEY` is correctly set                                                |

---

## Source URLs

| Topic                              | URL                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program enrollment | [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)                                                                                                                             |
| App Attest                         | [developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity](https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity)                                     |
| DeviceCheck                        | [developer.apple.com/documentation/devicecheck](https://developer.apple.com/documentation/devicecheck)                                                                                                         |
| APNs token-based auth              | [developer.apple.com/documentation/usernotifications/establishing_a_token-based_connection_to_apns](https://developer.apple.com/documentation/usernotifications/establishing_a_token-based_connection_to_apns) |
| User Notifications framework       | [developer.apple.com/documentation/usernotifications](https://developer.apple.com/documentation/usernotifications)                                                                                             |
| App Store Connect                  | [appstoreconnect.apple.com](https://appstoreconnect.apple.com)                                                                                                                                                 |
| Apple Developer membership         | [developer.apple.com/account](https://developer.apple.com/account)                                                                                                                                             |
| Manage identifiers                 | [developer.apple.com/help/account/manage/manage-identifiers](https://developer.apple.com/help/account/manage/manage-identifiers)                                                                               |
| Manage keys                        | [developer.apple.com/help/account/manage/manage-keys](https://developer.apple.com/help/account/manage/manage-keys)                                                                                             |

---

## Quick Reference: Config Keys Summary

### App Attest

| Key                        | Type                  | Required      | Default |
| -------------------------- | --------------------- | ------------- | ------- |
| `APPLE_TEAM_ID`            | string                | Yes           | —       |
| `APPLE_APP_ATTEST_APP_IDS` | JSON array of strings | Yes           | `[]`    |
| `DEVICE_CHECK_IOS_ENABLED` | boolean               | No (EXPERIMENTAL) | `false` |
| `ENFORCE_AUTH`             | boolean               | No            | `false` |

### DeviceCheck

| Key                          | Type                         | Required      | Default                                |
| ---------------------------- | ---------------------------- | ------------- | -------------------------------------- |
| `APPLE_TEAM_ID`              | string                       | Yes           | —                                      |
| `DEVICE_CHECK_KEY_ID`        | string                       | Yes           | —                                      |
| `DEVICE_CHECK_PRIVATE_KEY`   | PEM string (raw, not base64) | Yes           | —                                      |
| `DEVICE_CHECK_URL`           | string                       | No            | `https://api.devicecheck.apple.com/v1` |
| `DEVICE_CHECK_IOS_ENABLED`   | boolean                      | No (EXPERIMENTAL) | `false`                                |
| `DEVICE_CHECK_RESET_ENABLED` | boolean                      | No            | `false`                                |
| `ENFORCE_AUTH`               | boolean                      | No            | `false`                                |

### APNs

| Key                               | Type                     | Required                                       | Default        |
| --------------------------------- | ------------------------ | ---------------------------------------------- | -------------- |
| `APN_TEAM_ID`                     | string                   | Yes                                            | —              |
| `APN_KEY_ID`                      | string                   | Yes                                            | —              |
| `APN_PRIVATE_KEY`                 | base64(p8-bytes)         | Yes                                            | —              |
| `APN_KEY_ID_DEV`                  | string                   | Only if `DUAL_FLOW_NOTIFICATIONS_ENABLED=true` | —              |
| `APN_PRIVATE_KEY_DEV`             | base64(p8-bytes)         | Only if `DUAL_FLOW_NOTIFICATIONS_ENABLED=true` | —              |
| `APN_TOPICS`                      | JSON array of bundle IDs | Yes                                            | `[]`           |
| `APN_PRODUCTION`                  | boolean                  | No                                             | `false`        |
| `APN_DEVELOPMENT_SUFFIXES`        | JSON array of strings    | No                                             | `[".develop"]` |
| `DUAL_FLOW_NOTIFICATIONS_ENABLED` | boolean                  | No                                             | `false`        |

---

## Critical Differences: App Attest vs DeviceCheck vs APNs Keys

|                                  | App Attest                                    | DeviceCheck                                   | APNs                                           |
| -------------------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| **Key capability in portal**     | App Attest                                    | DeviceCheck                                   | Apple Push Notifications service (APNs)        |
| **One key per team or per app?** | Per team (can be reused across team apps)     | Per team                                      | Per team (can be reused across team apps)      |
| **Key downloaded?**              | Yes — stored by operator (not used by server) | Yes — `DEVICE_CHECK_PRIVATE_KEY` (PEM string) | Yes — `APN_PRIVATE_KEY` (base64 of file bytes) |
| **Server stores private key?**   | No                                            | Yes (for signing JWTs to Apple)               | Yes (for signing JWTs to Apple)                |
| **Key ID used by server?**       | No                                            | Yes (`DEVICE_CHECK_KEY_ID`)                   | Yes (`APN_KEY_ID`)                             |
| **File format for server**       | N/A (server validates via Apple's API)        | Raw PEM string (PKCS#8)                       | Base64-encoded `.p8` bytes                     |
| **Algorithm**                    | App-generated key pair validated by Apple     | ECDSA P-256 JWT signed by server              | ECDSA P-256 JWT signed by server               |
