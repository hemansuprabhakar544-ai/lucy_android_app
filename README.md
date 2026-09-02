# Lucy — Android-ready AI Memory Assistant

This project packages the supplied `App.js` into a complete Expo / React Native project.

## Run on your phone with Expo

1. Install Node.js LTS.
2. In this folder run:

   npm install
   npx expo start

3. Install **Expo Go** on your Android phone.
4. Scan the QR code shown by Expo.

For a standalone APK, use EAS Build.

## Build an installable Android APK

```bash
npm install
npm install --global eas-cli
eas login
eas build --platform android --profile preview
```

The `preview` profile is configured to produce an `.apk` for direct Android installation.

## AI setup

Open Lucy → Settings → choose OpenAI or Gemini → enter your API key → save.

The current app stores the API key locally on the phone. This is suitable for a personal prototype, but a public app should move provider calls behind a secure backend so the key is not exposed in the client.

## Important

The uploaded source already contains the core Lucy experience: local memory logs, today's timeline, AI recall, OpenAI/Gemini selection, editable model name, and spoken answers.
