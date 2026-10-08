#!/usr/bin/env bash
# Creates a release keystore + android/keystore.properties (both git-ignored).
# KEEP THE KEYSTORE SAFE: Google Play requires the same key for every update.
set -euo pipefail
cd "$(dirname "$0")/../android"
PASS="${AEONIS_KEY_PASSWORD:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')}"
if [ ! -f aeonis-release.jks ]; then
  keytool -genkeypair -v -keystore aeonis-release.jks -alias aeonis -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Aeonis, OU=Games, O=julienots, C=FR"
  cat > keystore.properties <<PROPS
storeFile=../aeonis-release.jks
storePassword=$PASS
keyAlias=aeonis
keyPassword=$PASS
PROPS
  echo "Keystore created: android/aeonis-release.jks (password stored in android/keystore.properties)"
else
  echo "Keystore already exists."
fi
