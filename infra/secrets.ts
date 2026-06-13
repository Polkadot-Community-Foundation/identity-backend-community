const SECRET_PLACEHOLDERS: Record<string, string> = {
  JWT_AUTH_SECRET: 'dev-placeholder-replace-with-sst-secret-set-JWT_AUTH_SECRET',
  PROXY_PRIVATE_KEY: '0x0000000000000000000000000000000000000000000000000000000000000000',
  ATTESTER_PROXY_PRIVATE_KEY: '0x0000000000000000000000000000000000000000000000000000000000000000',
  WEB_PUSH_VAPID_PRIVATE_KEY: 'dev-placeholder-vapid-p-256-key-bytes-replace-before-prod',
  DEVICE_CHECK_PRIVATE_KEY: 'dev-placeholder-devicecheck-pkcs8-replace-before-prod',
  APN_PRIVATE_KEY: 'dev-placeholder-apn-p8-base64-replace-before-prod',
  TURN_SECRET: 'dev-placeholder-turn-shared-secret-base64',
  GOOGLE_CREDENTIALS: 'dev-placeholder-google-service-account-json-base64',
  ADMIN_PASSWORD: 'dev-placeholder-admin-password',
  DEBUG_PASSWORD: 'dev-placeholder-debug-password',
  GrafanaWebhookUrl: 'https://hooks.example.invalid/dev-placeholder-webhook',
}

export function appDeploymentEnvironment(): Record<string, $util.Output<string>> {
  return Object.fromEntries(
    Object.entries(SECRET_PLACEHOLDERS).map(([name, placeholder]) => [
      name,
      new sst.Secret(name, placeholder).value,
    ]),
  )
}
