# Firebase Cloud Messaging Setup

This project now has the FCM client, service worker, token storage, and Vercel API route code.

## 1. Add Web Push VAPID Key

Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates -> Generate key pair.

Copy the public VAPID key and paste it in:

```js
// js/notifications.js
const FCM_VAPID_KEY = 'PASTE_YOUR_FIREBASE_WEB_PUSH_VAPID_KEY_HERE';
```

## 2. Add Vercel Environment Variables

Create a Firebase service account JSON:

Firebase Console -> Project Settings -> Service accounts -> Generate new private key.

Add these variables in Vercel:

```text
FIREBASE_PROJECT_ID=meatapp-eafe7
FIREBASE_CLIENT_EMAIL=<client_email from service account JSON>
FIREBASE_PRIVATE_KEY=<private_key from service account JSON>
```

For `FIREBASE_PRIVATE_KEY`, keep the line breaks as `\n` if Vercel stores it on one line.

## 3. Enable Notifications

Members must open the dashboard and click **Enable Notifications** once. Their browser FCM token is saved under:

```text
meatAppData/default/notificationTokens/{userId}
```

## 4. Admin Confirmation Flow

Admin Dashboard -> Members Pending Payment This Month -> Confirm Payment.

When admin confirms payment:

1. Contribution status changes to paid.
2. Realtime Database sync updates the record.
3. `/api/send-notification` sends FCM to the member tokens.
4. Member receives:

```text
🔔 Meat Association
Your payment has been confirmed successfully.
```
