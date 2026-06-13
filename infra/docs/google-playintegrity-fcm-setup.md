# Google Play Integrity & FCM Operator Setup Walkthrough

> **Purpose:** Step-by-step guide for an operator to provision Google Cloud credentials consumed by the identity-backend.
> **Credentials env var:** `GOOGLE_CREDENTIALS` — one base64-encoded JSON key file serves both Play Integrity (server-side token decoding) and Firebase Cloud Messaging (FCM) push notifications.
> **Code references:** `apps/identity-backend/src/config.ts` (defines `GOOGLE_CREDENTIALS`), `packages/lib/play-integrity/src/PlayIntegrityService.ts` (decodes integrity tokens), `apps/identity-backend/src/infrastructure/adapters/notifications/fcm/service.ts` (sends FCM pushes).

---

## Flow 1: Google Play Integrity

### Prerequisites

| Item                       | Detail                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Cloud project       | Created at [console.cloud.google.com](https://console.cloud.google.com)                                                                            |
| Billing account            | Linked to the project (Play Integrity API is free up to a quota; verify current pricing at [cloud.google.com/skus](https://cloud.google.com/skus)) |
| Operator role              | **Owner** or **Editor** (`roles/editor`) on the Google Cloud project                                                                               |
| Google Play Console access | The Play Console account must own the Android app                                                                                                  |
| Play Console permission    | **Release manager** or higher (can manage app signing)                                                                                             |

### Click-by-click walkthrough

#### Step 1 — Create or identify a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. If no project exists: click **Select a project** → **New Project**
3. Name the project (e.g., `polkadot-identity-prod`); note the **Project ID**
4. Link billing account: **Billing** → **Link a billing account**

#### Step 2 — Enable the Play Integrity API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. In the left sidebar, click **APIs & Services** → **Library**
3. Search: `Play Integrity API`
4. Click **Google Play Integrity API** → **Enable**

#### Step 3 — Create a service account

1. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
2. **Service account name:** `play-integrity-decoder` (or any descriptive name)
3. **Service account ID:** auto-populated (e.g., `play-integrity-decoder@PROJECT_ID.iam.gserviceaccount.com`)
4. Click **Create and continue**
5. **Grant this service account access to the project (optional):** skip this step; permissions are granted in the next step
6. Click **Done**

#### Step 4 — Grant the Editor role (minimum for Play Integrity API access)

> The Play Integrity API does not expose a service-account-specific predefined role (e.g. no `roles/playintegrity.admin`). The standard **Editor** role (`roles/editor`) on the project is the minimum viable grant. A service account with **Editor** can mint tokens for the `https://www.googleapis.com/auth/playintegrity` scope, which is all the backend needs.

1. On the **Service Accounts** page, click the newly created service account
2. Go to **Permissions** → **Grant access**
3. **Add principals:** enter the service account email
4. **Assign roles:** search for and select **Editor** (`roles/editor`)
5. Click **Save**

#### Step 5 — Generate a JSON key

1. Still on the service account page, click the **Keys** tab
2. Click **Add Key** → **Create new key**
3. Select **JSON** → click **Create**
4. The `.json` file downloads immediately. **This is the only copy.** Store it securely.

The downloaded file contains:

```json
{
  "type": "service_account",
  "project_id": "polkadot-identity-prod",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "client_email": "play-integrity-decoder@polkadot-identity-prod.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

#### Step 6 — Link the Google Cloud project to the Play Console

> This grants the Play Console permission to call the Play Integrity API on behalf of your Cloud project.

1. Go to [play.google.com/console](https://play.google.com/console) → select your app
2. In the left sidebar: **Setup** → **API access**
3. Under **Google Cloud access**, click **Link a Cloud project**
4. Select your **Google Cloud project** (by name or Project ID)
5. Click **Link project**
6. Source: [support.google.com/googleplay/android-developer/answer/2944108](https://support.google.com/googleplay/android-developer/answer/2944108)

### Transform required for the SST secret

The backend expects `GOOGLE_CREDENTIALS` as a **base64-encoded raw JSON file bytes** (not a string).

```bash
# Encode the JSON key file to base64
cat /path/to/play-integrity-decoder.json | base64 -w 0 > /tmp/credentials.b64

# Verify the encoding round-trips
cat /tmp/credentials.b64 | base64 -d | python3 -m json.tool > /dev/null && echo "OK"
```

Set the environment variable:

```bash
export GOOGLE_CREDENTIALS="$(cat /tmp/credentials.b64)"
```

The backend decodes this as: `base64 → raw JSON bytes →`JSON.parse`→ validates against the`JWTInput`schema → uses it with`@googleapis/playintegrity`to mint a short-lived OAuth token for the`https://www.googleapis.com/auth/playintegrity`scope → calls`playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken`.

**Key schema fields required** (from `packages/lib/play-integrity/src/types.ts`):

| Field            | Required                         |
| ---------------- | -------------------------------- |
| `type`           | yes (set to `"service_account"`) |
| `project_id`     | yes                              |
| `private_key_id` | yes                              |
| `private_key`    | yes (PEM RSA private key)        |
| `client_email`   | yes                              |
| `client_id`      | yes                              |
| `auth_uri`       | yes                              |
| `token_uri`      | yes                              |

Optional but often present: `quota_project_id`, `universe_domain`.

### Verification

1. **Local decode test** (requires `node` and the package):

   ```bash
   node -e "
   const { decodeIntegrityToken } = require('@googleapis/playintegrity');
   const auth = require('@google-auth-library/google-auth-library');
   // Decode base64 env var
   const creds = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString());
   console.log('project_id:', creds.project_id);
   console.log('client_email:', creds.client_email);
   "
   ```

2. **With a test integrity token** (from a Play Store device): POST the token to the backend's `/api/v1/auth/android/attestation` endpoint with a challenge, then inspect the returned verdict. The response JSON contains:

   ```json
   {
     "appIntegrity": {
       "appRecognitionVerdict": "PLAY_RECOGNIZED",
       "packageName": "io.pcf.polkadotapp",
       "versionCode": "1234"
     },
     "deviceIntegrity": {
       "deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"]
     },
     "accountDetails": {
       "LicensingVerdict": "LICENSED"
     }
   }
   ```

   Source: [developer.android.com/google/play/integrity/standard](https://developer.android.com/google/play/integrity/standard)

3. **`PLAY_INTEGRITY_MODE` modes** (from `apps/identity-backend/src/config.ts` line 527–536):

   | Mode               | Accepts `appIntegrity.appRecognitionVerdict` | Accepts `deviceIntegrity.deviceRecognitionVerdict` |
   | ------------------ | -------------------------------------------- | -------------------------------------------------- |
   | `strict` (default) | `PLAY_RECOGNIZED`                            | any                                                |
   | `relaxed_device`   | `PLAY_RECOGNIZED`, `UNRECOGNIZED_VERSION`    | `MEETS_DEVICE_INTEGRITY`                           |
   | `relaxed_all`      | any                                          | any                                                |

### Common errors

| Error                                                       | Cause                                               | Fix                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `Failed to authenticate service account`                    | Wrong or missing role on the service account        | Grant `roles/editor` (or `roles/owner`) to the service account in IAM    |
| `API has not been used in project X before`                 | Play Integrity API not enabled                      | Enable it at **APIs & Services → Library → Play Integrity API → Enable** |
| `PERMISSION_DENIED` on `decodeIntegrityToken`               | Service account lacks `roles/editor` on the project | Add the Editor role to the service account                               |
| `appIntegrity.appRecognitionVerdict = UNRECOGNIZED_VERSION` | App is a sideloaded build, not from Play Store      | Switch to `relaxed_all` mode, or use a Play Store build for testing      |
| `appIntegrity.verdict missing`                              | Device lacks Google Play Services                   | Test on a physical device with Play Store installed                      |

### Sources

- Play Integrity API overview: [developer.android.com/google/play/integrity](https://developer.android.com/google/play/integrity)
- Standard server-side integration: [developer.android.com/google/play/integrity/standard](https://developer.android.com/google/play/integrity/standard)
- API enablement: [cloud.google.com/endpoints/docs/openapi/enable-api](https://cloud.google.com/endpoints/docs/openapi/enable-api)
- Link Cloud project to Play Console: [support.google.com/googleplay/android-developer/answer/2944108](https://support.google.com/googleplay/android-developer/answer/2944108)
- Service account keys: [cloud.google.com/iam/docs/keys-create-delete](https://cloud.google.com/iam/docs/keys-create-delete)
- IAM roles overview: [cloud.google.com/iam/docs/understanding-roles](https://cloud.google.com/iam/docs/understanding-roles)

---

## Flow 2: Firebase Cloud Messaging (FCM) — HTTP v1 API

> The identity-backend sends push notifications via Firebase Admin SDK (server-side), using the **FCM HTTP v1 API**. The mobile app registers an FCM token via `POST /api/v1/subscriptions`; the backend stores and uses this token to push.

### Prerequisites

| Item                                    | Detail                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Firebase project                        | Created at [console.firebase.google.com](https://console.firebase.google.com) |
| Firebase project linked to Google Cloud | Done automatically when creating the Firebase project                         |
| Operator role                           | **Owner** or **Editor** on the Google Cloud project                           |
| Firebase Cloud Messaging API enabled    | In Google Cloud Console → **APIs & Services → Library**                       |

### Click-by-click walkthrough

#### Step 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Enter a project name (e.g., `polkadot-identity`) → Continue
3. **Enable Google Analytics** (optional) → Create project
4. Firebase creates a Google Cloud project automatically. To find the **Project ID**: go to **Project Settings** → **General** → **Your project ID**

#### Step 2 — Enable the Firebase Cloud Messaging API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Navigate to **APIs & Services** → **Library**
3. Search: `Firebase Cloud Messaging API`
4. Click **Firebase Cloud Messaging API** → **Enable**

> The legacy "Firebase Cloud Messaging" (v1 legacy) is deprecated. Always use the **Firebase Cloud Messaging API** (HTTP v1). Source: [firebase.google.com/docs/cloud-messaging/migrate-v1](https://firebase.google.com/docs/cloud-messaging/migrate-v1)

#### Step 3 — Register the Android app (informational — for the mobile team)

1. In Firebase Console → **Project Settings** → **General** → **Your apps** → **Add app** → **Android**
2. Enter the **Android package name** (must match `ANDROID_PACKAGE_NAMES[0]` in the backend config — e.g., `io.pcf.polkadotapp`)
3. **Download `google-services.json`** — this file goes into the Android app's `app/` directory. The backend does **not** use it.
4. Click **Next** through the remaining steps

#### Step 4 — Create a service account for the server

> This is the service account the backend actually uses. It is distinct from the Play Integrity service account but can be the **same JSON key file** — the `GOOGLE_CREDENTIALS` env var is shared.

1. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
2. **Name:** `fcm-sender` (or reuse `play-integrity-decoder`)
3. **Role:** search for and select **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`) — this grants `cloudmessaging.messages.create` and all other FCM permissions

   > The **Firebase Admin** role (`roles/firebase.admin`) also works (broader, includes FCM + other Firebase products). Use `roles/firebasecloudmessaging.admin` for least privilege.

   Role identifier: `roles/firebasecloudmessaging.admin`
   Source: [cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging](https://cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging)

4. Click **Done**

#### Step 5 — Generate a JSON key for the service account

1. Click the service account → **Keys** tab
2. **Add Key** → **Create new key** → **JSON** → **Create**
3. The `.json` file downloads. Store it alongside the Play Integrity key.

### Transform required for the SST secret

The backend uses **the same `GOOGLE_CREDENTIALS` env var** for both Play Integrity and FCM. Use the same base64 encoding command:

```bash
cat /path/to/fcm-sender.json | base64 -w 0 > /tmp/credentials.b64
export GOOGLE_CREDENTIALS="$(cat /tmp/credentials.b64)"
```

The backend initializes Firebase Admin with this credential:

```typescript
// apps/identity-backend/src/infrastructure/adapters/notifications/fcm/service.ts
import { cert, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

const firebaseApp = initializeApp({
  credential: cert(Redacted.value(config.serviceAccount) as any),
})
const messaging = getMessaging(firebaseApp)
```

The service account JSON is passed directly to `firebase-admin/app#cert()`. The JWTInput schema (`packages/lib/play-integrity/src/types.ts`) is a superset that accepts all Firebase Admin credential shapes, so a Firebase service account JSON (with `type: "service_account"`, `client_email`, `private_key`, etc.) is fully compatible.

### FCM HTTP v1 API endpoint

```
POST https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send
Authorization: Bearer <short-lived-OAuth-token-minted-by-firebase-admin>
Content-Type: application/json
```

The `PROJECT_ID` is the Firebase project ID (e.g., `polkadot-identity-123`).

Source: [firebase.google.com/docs/reference/fcm/rest/v1/projects.messages](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)

**Request body shape** (handled by `FCMPushService` in `apps/identity-backend/src/infrastructure/adapters/notifications/fcm/service.ts`):

```json
{
  "message": {
    "token": "<FCM_DEVICE_TOKEN>",
    "data": {
      "pushTypes": "chat",
      "pushId": "uuid",
      "message": "You have a new message"
    },
    "android": {
      "priority": "high",
      "ttl": 60
    }
  }
}
```

**Success response** (from Firebase):

```json
{
  "name": "projects/polkadot-identity-123/messages/1234567890"
}
```

**Error responses** (from `firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode`):

| FCM `ErrorCode`    | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `UNREGISTERED`     | App uninstalled or token expired — remove from subscriptions table |
| `INVALID_ARGUMENT` | Malformed token or payload                                         |
| `QUOTA_EXCEEDED`   | Project-level FCM quota exceeded                                   |
| `UNAVAILABLE`      | Firebase service temporarily unavailable — retry with backoff      |
| `INTERNAL`         | Firebase internal error — retry with backoff                       |

### Common errors

| Error                                         | Cause                                                                       | Fix                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `messaging/registration-token-not-registered` | Stale FCM token (app uninstalled)                                           | Server removes token from subscriptions                                             |
| `messaging/invalid-registration-token`        | Token issued by a different Firebase project                                | Ensure the FCM token was obtained from the same Firebase project linked to this app |
| `Authentication failed`                       | Service account missing `roles/firebasecloudmessaging.admin`                | Add the role to the service account in IAM                                          |
| `Permission denied`                           | Firebase Cloud Messaging API not enabled                                    | Enable at **APIs & Services → Library → Firebase Cloud Messaging API → Enable**     |
| `Sender ID mismatch`                          | The FCM sender ID used by the mobile app doesn't match the Firebase project | Verify the mobile app's `google-services.json` comes from the same Firebase project |

### Sources

- FCM HTTP v1 send message: [firebase.google.com/docs/cloud-messaging/send-message](https://firebase.google.com/docs/cloud-messaging/send-message)
- FCM REST reference: [firebase.google.com/docs/reference/fcm/rest/v1/projects.messages](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)
- FCM v1 migration guide: [firebase.google.com/docs/cloud-messaging/migrate-v1](https://firebase.google.com/docs/cloud-messaging/migrate-v1)
- FCM error codes: [firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode](https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode)
- Firebase Cloud Messaging roles: [cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging](https://cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging)

---

## Flow 3: Android Signing Digests for Play Integrity

> The backend compares the SHA-256 digest of the signing certificate reported by the device against the expected `ANDROID_SIGNING_DIGEST_PLAYSTORE` and `ANDROID_SIGNING_DIGEST_WEBSITE` config values.

### Prerequisites

| Item                               | Detail                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Google Play Console access         | Owner or Admin of the Play Console developer account     |
| Signing keystore                   | The `.jks` or `.keystore` file used to sign release APKs |
| `keytool` available                | Part of JDK; or use `apksigner` from Android SDK         |
| `ANDROID_SIGNING_DIGEST_PLAYSTORE` | Digest of Google's Play App Signing certificate          |
| `ANDROID_SIGNING_DIGEST_WEBSITE`   | Digest of the upload/sideloading certificate             |

### Click-by-click: Play Store digest (App Signing certificate)

1. Go to [play.google.com/console](https://play.google.com/console) → select your app
2. In the left sidebar: **Setup** → **App integrity**
3. Click the **App signing** tab
4. Under **App signing key certificate**, find the **SHA-256 certificate fingerprint** row
5. Click the copy icon — the fingerprint is shown in uppercase with colons:

   ```
   AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00:11:22:33
   ```

6. Strip the colons and convert to **lowercase**. This is the value for `ANDROID_SIGNING_DIGEST_PLAYSTORE`.

Source: [support.google.com/googleplay/android-developer/answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756)

### Click-by-click: Website/sideloaded digest (Upload certificate)

The upload certificate is the one used to sign the APK you upload to Play Console (or distribute directly).

#### Option A — from the Play Console (if you've linked upload key)

1. In **App integrity** → **App signing** tab
2. Look for **Upload key certificate** — if you've registered an upload key with Play Console, it shows here
3. Copy the SHA-256 fingerprint and process as above

#### Option B — from `keytool` (from your keystore)

```bash
keytool -list -v -keystore my-release.jks -alias upload
```

Output includes:

```
Certificate fingerprints:
  SHA256: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00:11:22:33
```

Strip colons and lowercase → `aabbccddeeff00112233445566778899001122334455667788990011223344556677889900112233`

#### Option C — from `apksigner` (from a built APK)

```bash
apksigner verify --print-certs my-app.apk
```

Output includes one block per signer. Look for the block whose signer name matches your upload key alias:

```
Signer #1 certificate SHA-256 digest: aabbccddeeff00112233445566778899001122334455667788990011223344556677889900112233
```

### Config value transform

The backend normalizes both values (from `apps/identity-backend/src/config.ts` lines 453–475):

```typescript
Config.map((s) => s.trim().toLowerCase().replace(/:/g, ''))
```

So both of these are equivalent:

```
AA:BB:CC:DD:EE:FF...   →  aabbccddeeff00112233445566778899001122334455667788990011223344556677889900112233
aabb:ccdd:eeff:0011... →  aabbccddeeff00112233445566778899001122334455667788990011223344556677889900112233
aabbccddeeff0011...    →  aabbccddeeff00112233445566778899001122334455667788990011223344556677889900112233
```

### Common errors

| Error                                                                             | Cause                                                                              | Fix                                                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Every device gets `UNRECOGNIZED_VERSION` verdict                                  | `ANDROID_SIGNING_DIGEST_WEBSITE` doesn't match the upload key used to sign the APK | Extract digest from the actual keystore or APK; verify with `keytool -list`                             |
| `appIntegrity.appRecognitionVerdict = UNRECOGNIZED_VERSION` on a Play Store build | The APK was re-signed by Google Play; use Play Store digest, not upload digest     | Set `ANDROID_SIGNING_DIGEST_PLAYSTORE` to the App Signing certificate from Play Console                 |
| Play Console shows no SHA-256 for App Signing                                     | Play App Signing is not enrolled — Google signs with a default debug keystore      | Check **Setup → App integrity → App signing** tab; if not enrolled, the digest may not yet be available |

### Sources

- Play App Signing overview: [support.google.com/googleplay/android-developer/answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756)

---

## Summary: Required Environment Variables

| Variable                           | Source                                                                              | Used by                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CREDENTIALS`               | Base64-encoded service account JSON (Play Integrity **and** FCM share the same key) | `PlayIntegrityService` (`packages/lib/play-integrity/src/PlayIntegrityService.ts`), `FCMPushService` (`apps/identity-backend/src/infrastructure/adapters/notifications/fcm/service.ts`) |
| `ANDROID_PACKAGE_NAMES`            | Comma-separated list of Android package names the backend accepts                   | Play Integrity middleware (`packages/lib/hono-auth/src/play-integrity/config.ts`)                                                                                                       |
| `ANDROID_SIGNING_DIGEST_PLAYSTORE` | SHA-256 hex (lowercase, no colons) of Google's App Signing certificate              | Play Integrity middleware — validates `deviceIntegrity`                                                                                                                                 |
| `ANDROID_SIGNING_DIGEST_WEBSITE`   | SHA-256 hex (lowercase, no colons) of the upload/sideload keystore certificate      | Play Integrity middleware — validates `deviceIntegrity`                                                                                                                                 |
| `PLAY_INTEGRITY_MODE`              | `strict` (default), `relaxed_device`, or `relaxed_all`                              | Play Integrity middleware — controls which integrity verdicts are accepted                                                                                                              |
