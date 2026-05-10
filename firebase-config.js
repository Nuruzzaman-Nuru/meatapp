// Firebase SDK Import
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCAazPn46JvckXqkOr0rEAmTNqE6hmNtc8",
  authDomain: "meatapp-eafe7.firebaseapp.com",
  databaseURL: "https://meatapp-eafe7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "meatapp-eafe7",
  storageBucket: "meatapp-eafe7.firebasestorage.app",
  messagingSenderId: "860683370261",
  appId: "1:860683370261:web:248608976847cc05b3f31c",
  measurementId: "G-CQ86FFH952"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firestore Database
const db = getFirestore(app);

// Export Database
window.db = db;