/**
 * Firebase Configuration
 * 
 * INSTRUCTIONS:
 * 1. Go to Firebase Console: https://console.firebase.google.com/
 * 2. Select your project
 * 3. Go to Project Settings (gear icon)
 * 4. Scroll down to "Firebase SDK snippet"
 * 5. Copy the config object below and fill in your values
 * 
 * DO NOT COMMIT this file with real API keys to public GitHub!
 */

// ⚠️ FILL IN YOUR FIREBASE CONFIG BELOW ⚠️
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",           // From Firebase Console
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"   // Optional
};

// ✅ DO NOT EDIT BELOW THIS LINE ✅

export { firebaseConfig };
