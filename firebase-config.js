// Firebase SDK Import
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  child,
  push
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Firebase Config
export const firebaseConfig = {
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
export const app = initializeApp(firebaseConfig);

// Realtime Database
export const db = getDatabase(app);

// Global Access
window.db = db;
window.ref = ref;
window.set = set;
window.get = get;
window.child = child;
window.push = push;

export { ref, set, get, child, push };
