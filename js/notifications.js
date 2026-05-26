import { app, db, ref, set, get, child } from '../firebase-config.js';
import {
    getMessaging,
    getToken,
    isSupported,
    onMessage
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';

const FCM_VAPID_KEY = 'BCmKXYTR9I3M5Xx3sSgqCY3XqCMxzKC_36rmZh1pr-B--OU2FZGC6DYBQ7DBWyr_q-Wiq5wz84KsaBMLM7IebRE';
const FIREBASE_BASE_PATH = 'meatAppData/default';

const NotificationManager = {
    messaging: null,
    currentUser: null,
    initialized: false,

    async initForCurrentUser() {
        if (this.initialized) return;
        this.initialized = true;

        this.currentUser = window.AuthManager?.getCurrentUser?.() || null;
        if (!this.currentUser) return;

        this.bindEnableButton();

        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            this.updateStatus('Notifications are not supported in this browser.', 'warning');
            return;
        }

        if (!window.isSecureContext) {
            this.updateStatus('Notifications need HTTPS or localhost to work.', 'warning');
            return;
        }

        if (FCM_VAPID_KEY.includes('PASTE_YOUR')) {
            this.updateStatus('Firebase VAPID key is missing. Add it in js/notifications.js.', 'warning');
            return;
        }

        const supported = await isSupported().catch(() => false);
        if (!supported) {
            this.updateStatus('Firebase notifications are not supported in this browser.', 'warning');
            return;
        }

        this.messaging = getMessaging(app);
        this.listenForForegroundMessages();

        if (Notification.permission === 'granted') {
            await this.saveCurrentToken();
        } else if (Notification.permission === 'denied') {
            this.updateStatus('Notifications are blocked. Enable them from browser settings.', 'warning');
        } else {
            this.updateStatus('Click Enable Notifications to receive payment confirmation popup alerts.', 'info');
        }
    },

    bindEnableButton() {
        const button = document.getElementById('notificationEnableBtn');
        if (!button) return;

        button.addEventListener('click', () => {
            this.requestPermissionAndSaveToken();
        });
    },

    async requestPermissionAndSaveToken() {
        if (FCM_VAPID_KEY.includes('PASTE_YOUR')) {
            this.updateStatus('Firebase VAPID key is missing. Add it in js/notifications.js.', 'warning');
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            this.updateStatus('Notification permission was not allowed.', 'warning');
            return;
        }

        if (!this.messaging) {
            this.messaging = getMessaging(app);
            this.listenForForegroundMessages();
        }

        await this.saveCurrentToken();
    },

    async saveCurrentToken() {
        try {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            const token = await getToken(this.messaging, {
                vapidKey: FCM_VAPID_KEY,
                serviceWorkerRegistration: registration
            });

            if (!token) {
                this.updateStatus('Could not create a Firebase notification token.', 'warning');
                return null;
            }

            const tokenKey = this.getSafeTokenKey(token);
            await set(ref(db, `${FIREBASE_BASE_PATH}/notificationTokens/${this.currentUser.id}/${tokenKey}`), {
                token,
                userId: this.currentUser.id,
                userName: this.currentUser.name,
                userRole: this.currentUser.role,
                userAgent: navigator.userAgent,
                updatedAt: new Date().toISOString()
            });

            localStorage.setItem('meatAppFcmToken', token);
            this.updateStatus('Notifications enabled. Payment confirmation popup will be sent to this browser.', 'success');
            return token;
        } catch (error) {
            console.error('FCM token save failed', error);
            this.updateStatus('Could not enable Firebase notifications. Check console/configuration.', 'error');
            return null;
        }
    },

    listenForForegroundMessages() {
        if (!this.messaging || this.foregroundListenerReady) return;
        this.foregroundListenerReady = true;

        onMessage(this.messaging, (payload) => {
            const title = payload.notification?.title || '\uD83D\uDD14 Meat Association';
            const body = payload.notification?.body || 'You have a new notification.';

            if (Notification.permission === 'granted') {
                new Notification(title, {
                    body,
                    icon: payload.notification?.icon || '/logo.png'
                });
            }

            if (window.App?.showToast) {
                App.showToast(`${title} - ${body}`, 'success');
            }
        });
    },

    async getUserTokens(userId) {
        const snapshot = await get(child(ref(db), `${FIREBASE_BASE_PATH}/notificationTokens/${userId}`));
        if (!snapshot.exists()) return [];

        return Object.values(snapshot.val())
            .map(item => item?.token)
            .filter(Boolean);
    },

    async notifyPaymentConfirmed(user, contribution) {
        const tokens = await this.getUserTokens(user.id);
        if (tokens.length === 0) {
            return {
                success: false,
                message: 'No notification token found for this member. Ask the member to enable notifications.'
            };
        }

        const response = await fetch('/api/send-notification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tokens,
                title: '\uD83D\uDD14 Meat Association',
                body: 'Your payment has been confirmed successfully.',
                data: {
                    userId: String(user.id),
                    contributionId: String(contribution.id),
                    month: String(contribution.month),
                    year: String(contribution.year),
                    amount: String(contribution.amount),
                    url: '/dashboard.html'
                }
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                success: false,
                message: result.error || 'Notification API request failed.'
            };
        }

        return {
            success: true,
            ...result
        };
    },

    getSafeTokenKey(token) {
        return token.replace(/[.#$/\[\]]/g, '_');
    },

    updateStatus(message, type = 'info') {
        const status = document.getElementById('notificationStatus');
        if (status) {
            status.textContent = message;
            status.className = `alert alert-${type}`;
            status.style.display = 'block';
        }

        const button = document.getElementById('notificationEnableBtn');
        if (button) {
            button.style.display = 'Notification' in window && Notification.permission === 'granted'
                ? 'none'
                : 'inline-flex';
        }
    }
};

window.NotificationManager = NotificationManager;

window.addEventListener('DOMContentLoaded', () => {
    NotificationManager.initForCurrentUser();
});
