importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCAazPn46JvckXqkOr0rEAmTNqE6hmNtc8",
    authDomain: "meatapp-eafe7.firebaseapp.com",
    databaseURL: "https://meatapp-eafe7-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "meatapp-eafe7",
    storageBucket: "meatapp-eafe7.firebasestorage.app",
    messagingSenderId: "860683370261",
    appId: "1:860683370261:web:248608976847cc05b3f31c",
    measurementId: "G-CQ86FFH952"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || '\uD83D\uDD14 Meat Association';
    const options = {
        body: payload.notification?.body || 'You have a new notification.',
        icon: payload.notification?.icon || '/logo.png',
        badge: '/logo.png',
        data: {
            url: payload.data?.url || '/dashboard.html'
        }
    };

    self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || '/dashboard.html';
    event.waitUntil(clients.openWindow(targetUrl));
});
