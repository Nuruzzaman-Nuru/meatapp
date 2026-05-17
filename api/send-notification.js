const crypto = require('crypto');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(payload));
}

function base64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function createJwt(clientEmail, privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };
    const claimSet = {
        iss: clientEmail,
        scope: FCM_SCOPE,
        aud: TOKEN_URL,
        exp: now + 3600,
        iat: now
    };

    const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claimSet))}`;
    const signature = crypto
        .createSign('RSA-SHA256')
        .update(unsignedJwt)
        .sign(privateKey);

    return `${unsignedJwt}.${base64Url(signature)}`;
}

async function getAccessToken(clientEmail, privateKey) {
    const jwt = createJwt(clientEmail, privateKey);
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error_description || data.error || 'Could not create Google access token');
    }

    return data.access_token;
}

async function sendToToken({ projectId, accessToken, token, title, body, data, link }) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
            message: {
                token,
                notification: {
                    title,
                    body
                },
                webpush: {
                    notification: {
                        title,
                        body,
                        icon: '/logo.png',
                        badge: '/logo.png'
                    },
                    fcm_options: {
                        link
                    }
                },
                data
            }
        })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error?.message || 'FCM send failed');
    }

    return result;
}

module.exports = async function handler(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || 'meatapp-eafe7';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        sendJson(response, 503, {
            error: 'FCM server credentials are missing. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel.'
        });
        return;
    }

    let body = request.body || {};
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            sendJson(response, 400, { error: 'Invalid JSON body' });
            return;
        }
    }

    const tokens = Array.isArray(body.tokens) ? [...new Set(body.tokens.filter(Boolean))] : [];
    const title = body.title || '\uD83D\uDD14 Meat Association';
    const notificationBody = body.body || 'Your payment has been confirmed successfully.';
    const data = Object.fromEntries(
        Object.entries(body.data || {}).map(([key, value]) => [key, String(value)])
    );
    const host = request.headers.host;
    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const origin = request.headers.origin || (host ? `${protocol}://${host}` : '');
    const targetPath = data.url || '/dashboard.html';
    const link = targetPath.startsWith('http') ? targetPath : `${origin}${targetPath}`;

    if (tokens.length === 0) {
        sendJson(response, 400, { error: 'No FCM tokens provided' });
        return;
    }

    try {
        const accessToken = await getAccessToken(clientEmail, privateKey);
        const results = await Promise.allSettled(tokens.map(token => sendToToken({
            projectId,
            accessToken,
            token,
            title,
            body: notificationBody,
            data,
            link
        })));

        const failures = results
            .map((result, index) => ({ result, index }))
            .filter(({ result }) => result.status === 'rejected')
            .map(({ result, index }) => ({
                index,
                error: result.reason.message
            }));

        sendJson(response, 200, {
            successCount: results.length - failures.length,
            failureCount: failures.length,
            failures
        });
    } catch (error) {
        console.error('Notification send failed', error);
        sendJson(response, 500, { error: error.message || 'Notification send failed' });
    }
};
