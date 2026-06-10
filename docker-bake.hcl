variable "PNPM_STORE_PATH"  { default = "" }
variable "TURBO_CACHE_PATH" { default = "" }
variable "TAG_APP_IDENTITY" { default = "identity-backend:e2e-latest" }
variable "TAG_APP_E2E"      { default = "identity-backend-startup:e2e-latest" }
variable "TAG_CHOPSTICKS"   { default = "chopsticks:e2e-latest" }
variable "CACHE_EXPORT"     { default = "true" }
variable "VCS_REF"          { default = "" }
variable "BUILD_DATE"       { default = "" }

function "cache_to" {
  params = [scope]
  result = equal("true", CACHE_EXPORT) ? ["type=gha,mode=min,scope=${scope}"] : []
}

target "app-identity" {
  dockerfile = "./Dockerfile"
  target     = "app-identity"
  contexts = {
    pnpm-store     = "${PNPM_STORE_PATH}"
    turbo-cache    = "${TURBO_CACHE_PATH}"
    prune-identity = ".prune-identity"
    prune-api-docs = ".prune-api-docs"
  }
  tags       = [TAG_APP_IDENTITY]
  cache-from = ["type=gha,scope=identity-backend-image"]
  cache-to   = cache_to("identity-backend-image")
  args = {
    VCS_REF    = VCS_REF
    BUILD_DATE = BUILD_DATE
  }
}

target "app-e2e" {
  dockerfile = "./Dockerfile"
  target     = "app-e2e"
  contexts = {
    pnpm-store  = "${PNPM_STORE_PATH}"
    turbo-cache = "${TURBO_CACHE_PATH}"
    prune-e2e   = ".prune-e2e"
  }
  tags       = [TAG_APP_E2E]
  cache-from = ["type=gha,scope=identity-backend-image"]
  cache-to   = cache_to("identity-backend-image")
  args = {
    VCS_REF    = VCS_REF
    BUILD_DATE = BUILD_DATE
  }
}

target "chopsticks" {
  dockerfile = "./docker/test/e2e/chopsticks.dockerfile"
  contexts = {
    pnpm-store = "${PNPM_STORE_PATH}"
  }
  tags       = [TAG_CHOPSTICKS]
  cache-from = ["type=gha,scope=chopsticks-image"]
  cache-to   = cache_to("chopsticks-image")
}

group "e2e" {
  targets = ["app-identity", "app-e2e", "chopsticks"]
}

group "build-all" {
  targets = ["app-identity", "app-e2e"]
}

group "publish" {
  targets = ["app-identity"]
}
