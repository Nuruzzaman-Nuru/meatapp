# 🔥 Firebase Cloud Sync Setup Guide

এই গাইড অনুসরণ করে আপনার App কে Firebase এর সাথে connect করতে পারবেন, যাতে সব ডেটা cloud এ থাকে এবং যেকোনো device থেকে access করা যায়।

---

## 📋 **Prerequisites**
- Google Account
- এই project এর সব ফাইল

---

## Step 1️⃣: Firebase Console এ যান

1. ব্রাউজারে যান: **https://console.firebase.google.com/**
2. Google Account দিয়ে Login করুন

---

## Step 2️⃣: নতুন Project Create করুন

1. **"Create a project"** ক্লিক করুন
2. **Project Name**: `meat-app-sync` (বা যেকোনো নাম)
3. **Continue** ক্লিক করুন
4. Google Analytics: **Disable** করুন (প্রয়োজন নেই)
5. **Create project** ক্লিক করুন

⏳ Project তৈরি হতে ২-৩ মিনিট সময় লাগবে...

---

## Step 3️⃣: Firestore Database সেটআপ করুন

1. Left menu থেকে **"Build"** → **"Firestore Database"** ক্লিক করুন
2. **"Create database"** ক্লিক করুন
3. **Start in test mode** নির্বাচন করুন
4. **Location**: `asia-southeast1` (Bangladesh এর কাছাকাছি) বা আপনার দেশ
5. **Create** ক্লিক করুন

---

## Step 4️⃣: Web App Add করুন এবং Config পান

1. **Project Overview** এ যান (Home icon ক্লিক করুন)
2. **"Add app"** ক্লিক করুন
3. **"Web"** আইকন ক্লিক করুন (`</> ` চিহ্ন)
4. **App nickname**: `meat-app-web`
5. **Register app** ক্লিক করুন
6. **Copy করুন** এই config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

---

## Step 5️⃣: Authentication সেটআপ করুন

1. Left menu থেকে **"Build"** → **"Authentication"** ক্লিক করুন
2. **"Get started"** ক্লিক করুন
3. **"Email/Password"** provider enable করুন
4. **Enable** ক্লিক করুন
5. **Save** ক্লিক করুন

---

## Step 6️⃣: Config File তৈরি করুন

প্রজেক্ট root এ একটি নতুন file তৈরি করুন: **`firebase-config.js`**

এতে paste করুন:

```javascript
// Firebase Initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

---

## ✅ **সম্পন্ন!**

Firebase setup শেষ। এখন project এ Firebase integration করা হবে এবং সব ডেটা cloud এ save হবে।

**যেকোনো device থেকে:**
1. App খুলুন
2. সেই account দিয়ে login করুন
3. সব ডেটা cloud থেকে load হবে ✨

---

## 🆘 **সমস্যা হলে:**

### Error: "Permission denied"
- Firestore সেটআপ **test mode** এ আছে কিনা check করুন

### Config values missing
- Firebase Console এ **Project Settings** check করুন

### Database তৈরি হয়নি
- History clear করুন এবং refresh করুন

---

**এই setup এর পর, contact করলে আমি backend code implement করব! 🚀**
