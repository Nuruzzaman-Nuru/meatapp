/**
 * Authentication Module
 * Handles user registration, login, and session management
 */

const AuthManager = {
    firebaseDatabaseURL: 'https://meatapp-eafe7-default-rtdb.asia-southeast1.firebasedatabase.app',
    firebaseUsersPath: 'meatAppData/default/users',
    firebaseReadyTimeoutMs: 3000,
    sessionGuardTimer: null,
    sessionGuardInProgress: false,

    /**
     * Register a new user with password hashing
     */
    async register(formData) {
        formData = {
            ...formData,
            name: formData.name?.trim(),
            email: formData.email?.trim(),
            phone: formData.phone?.trim()
        };

        // Validate input
        if (!formData.name || !formData.email || !formData.phone || !formData.password || !formData.confirmPassword) {
            return { success: false, message: 'All fields are required' };
        }

        if (!this.isValidGmailAddress(formData.email)) {
            return { success: false, message: 'Please enter a valid Gmail address ending with @gmail.com' };
        }

        if (!this.isValidPhoneNumber(formData.phone)) {
            return { success: false, message: 'Phone number must be exactly 11 digits' };
        }

        if (formData.password !== formData.confirmPassword) {
            return { success: false, message: 'Passwords do not match' };
        }

        if (formData.password.length < 6) {
            return { success: false, message: 'Password must be at least 6 characters' };
        }

        await this.waitForFirebaseSyncReady();

        const firebaseUsers = await this.getFirebaseUsers();
        if (firebaseUsers.length > 0) {
            const mergedUsers = this.mergeUsersForAuth(firebaseUsers, StorageManager.getUsers());
            localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(mergedUsers));
        }

        const nextUserId = await this.getNextUserId(firebaseUsers);

        // Check if phone already exists
        const indexedPhoneUser = await this.getFirebaseUserByIndexedPhone(formData.phone);
        if (indexedPhoneUser) {
            return { success: false, message: 'Phone number already registered' };
        }

        const existingUser = StorageManager.getUserByPhone(formData.phone);
        if (existingUser) {
            return { success: false, message: 'Phone number already registered' };
        }

        const indexedEmailUser = await this.getFirebaseUserByIndexedEmail(formData.email);
        if (indexedEmailUser) {
            return { success: false, message: 'Email already registered' };
        }

        const existingEmailUser = StorageManager.getUserByEmail(formData.email);
        if (existingEmailUser) {
            return { success: false, message: 'Email already registered' };
        }

        const beforeUsers = localStorage.getItem(StorageManager.KEYS.USERS);

        // Create user with hashed password
        const newUser = await StorageManager.addUserWithPassword({
            id: nextUserId,
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            role: 'member',
            status: 'active'
        }, formData.password);

        // Registration must reach Firebase, otherwise other devices/admin cannot see it.
        try {
            const savedToFirebase = await this.saveRegisteredUserToFirebase(newUser);
            if (!savedToFirebase) {
                throw new Error('Firebase registration save returned false');
            }

            const verifiedUser = await this.getUserFromFirebaseById(newUser.id);
            if (!verifiedUser || Number(verifiedUser.id) !== Number(newUser.id)) {
                throw new Error('Firebase registration verification failed');
            }
        } catch (error) {
            console.error('Firebase registration save failed', error);
            if (beforeUsers === null) {
                localStorage.removeItem(StorageManager.KEYS.USERS);
            } else {
                localStorage.setItem(StorageManager.KEYS.USERS, beforeUsers);
            }

            return {
                success: false,
                message: 'Registration failed because Firebase sync failed. Please check internet and try again.'
            };
        }

        return { 
            success: true, 
            message: 'Registration successful. Your account is active. You can login now.',
            user: newUser
        };
    },

    isValidGmailAddress(email) {
        return /^[^\s@]+@gmail\.com$/i.test(String(email || '').trim());
    },

    isValidPhoneNumber(phone) {
        return /^\d{11}$/.test(String(phone || '').trim());
    },

    getFirebaseDatabaseURL() {
        return window.FirebaseSync?.databaseURL || this.firebaseDatabaseURL;
    },

    getFirebaseUsersPath() {
        const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
        return `${basePath}/users`;
    },

    async waitForFirebaseSyncReady(timeoutMs = this.firebaseReadyTimeoutMs) {
        if (!window.FirebaseSync?.ready) {
            await Promise.race([
                new Promise(resolve => {
                    window.addEventListener('firebase-sync-ready', resolve, { once: true });
                }),
                new Promise(resolve => setTimeout(resolve, timeoutMs))
            ]);

            if (!window.FirebaseSync?.ready) {
                return;
            }
        }

        await Promise.race([
            window.FirebaseSync.ready.catch(error => {
                console.warn('Firebase sync was not ready before auth action', error);
            }),
            new Promise(resolve => setTimeout(resolve, timeoutMs))
        ]);
    },

    async getFirebaseUsers() {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const usersPath = this.getFirebaseUsersPath();

            if (!databaseURL) {
                return StorageManager.getUsers();
            }

            const response = await this.fetchWithTimeout(`${databaseURL}/${usersPath}.json`, {
                cache: 'no-store'
            }, 15000);

            if (!response.ok) {
                throw new Error(`Firebase users read failed: ${response.status}`);
            }

            const value = await response.json();
            if (!value) return StorageManager.getUsers();
            const deletedUserIds = new Set(
                StorageManager.getDeletedUserIds ? StorageManager.getDeletedUserIds() : []
            );

            return Object.entries(value)
                .filter(([key]) => key !== '_meta')
                .map(([, user]) => user)
                .filter(user => !deletedUserIds.has(Number(user.id)))
                .filter(user => this.isValidAppUser(user));
        } catch (error) {
            console.error('Firebase users read failed', error);
            return StorageManager.getUsers();
        }
    },

    async getNextUserId(firebaseUsers = []) {
        const localMaxId = StorageManager.getUsers().reduce((max, user) => {
            return Math.max(max, Number(user.id) || 0);
        }, 0);
        const firebaseMaxId = firebaseUsers.reduce((max, user) => {
            return Math.max(max, Number(user.id) || 0);
        }, 0);
        const keyMaxId = await this.getFirebaseUserKeyMaxId();
        const metaCount = await this.getFirebaseUsersMetaCount();
        const maxKnownId = Math.max(localMaxId, firebaseMaxId, keyMaxId, metaCount);

        if (maxKnownId > 0) {
            return maxKnownId + 1;
        }

        return Date.now();
    },

    async getFirebaseUserKeyMaxId() {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const usersPath = this.getFirebaseUsersPath();
            if (!databaseURL) return 0;

            const response = await this.fetchWithTimeout(`${databaseURL}/${usersPath}.json?shallow=true`, {
                cache: 'no-store'
            }, 8000);

            if (!response.ok) return 0;

            const value = await response.json();
            if (!value || typeof value !== 'object') return 0;

            return Object.keys(value).reduce((max, key) => {
                if (key === '_meta') return max;
                return Math.max(max, Number(key) || 0);
            }, 0);
        } catch (error) {
            console.warn('Firebase user key scan failed', error);
            return 0;
        }
    },

    async getFirebaseUsersMetaCount() {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const usersPath = this.getFirebaseUsersPath();
            if (!databaseURL) return 0;

            const response = await this.fetchWithTimeout(`${databaseURL}/${usersPath}/_meta/itemCount.json`, {
                cache: 'no-store'
            }, 4000);

            if (!response.ok) return 0;

            const count = Number(await response.json());
            return Number.isFinite(count) ? count : 0;
        } catch (error) {
            console.warn('Firebase users meta count read failed', error);
            return 0;
        }
    },

    makeFirebaseKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[.#$/[\]\s]/g, '_');
    },

    async getFirebaseUserByIndexedPhone(phone) {
        const phoneKey = this.makeFirebaseKey(phone);
        if (!phoneKey) return null;

        return await this.getFirebaseUserByIndex(`userPhoneIndex/${phoneKey}`);
    },

    async getFirebaseUserByIndexedEmail(email) {
        const emailKey = this.makeFirebaseKey(email);
        if (!emailKey) return null;

        return await this.getFirebaseUserByIndex(`userEmailIndex/${emailKey}`);
    },

    async getFirebaseUserByIndex(indexPath) {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
            if (!databaseURL) return null;

            const indexResponse = await this.fetchWithTimeout(`${databaseURL}/${basePath}/${indexPath}.json`, {
                cache: 'no-store'
            }, 5000);

            if (!indexResponse.ok) return null;

            const userId = await indexResponse.json();
            if (!userId) return null;

            const userResponse = await this.fetchWithTimeout(`${databaseURL}/${basePath}/users/${userId}.json`, {
                cache: 'no-store'
            }, 5000);

            if (!userResponse.ok) return null;

            const user = await userResponse.json();
            return this.isValidAppUser(user) ? user : null;
        } catch (error) {
            console.warn('Firebase indexed user lookup failed', error);
            return null;
        }
    },

    async getUserFromFirebaseById(userId) {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
            if (!databaseURL || !userId) return null;

            const response = await this.fetchWithTimeout(`${databaseURL}/${basePath}/users/${userId}.json`, {
                cache: 'no-store'
            }, 5000);

            if (!response.ok) return null;

            const user = await response.json();
            return this.isValidAppUser(user) ? user : null;
        } catch (error) {
            console.warn('Firebase user verification failed', error);
            return null;
        }
    },

    async saveUserIndexesToFirebase(user) {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
            if (!databaseURL || !user?.id) return;

            const writes = [];
            const phoneKey = this.makeFirebaseKey(user.phone);
            const emailKey = this.makeFirebaseKey(user.email);

            if (phoneKey) {
                writes.push(this.putFirebaseValue(`${basePath}/userPhoneIndex/${phoneKey}`, user.id));
            }
            if (emailKey) {
                writes.push(this.putFirebaseValue(`${basePath}/userEmailIndex/${emailKey}`, user.id));
            }
            writes.push(this.putFirebaseValue(`${basePath}/pendingUserIds/${user.id}`, user.status === 'pending' ? true : null));
            writes.push(this.putFirebaseValue(`${basePath}/recentUserIds/${user.id}`, true));

            await Promise.all(writes);
        } catch (error) {
            console.warn('Firebase user index update failed', error);
        }
    },

    async deleteUserIndexesFromFirebase(user) {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
            if (!databaseURL || !user?.id) return;

            const writes = [
                this.putFirebaseValue(`${basePath}/pendingUserIds/${user.id}`, null),
                this.putFirebaseValue(`${basePath}/recentUserIds/${user.id}`, null)
            ];
            const phoneKey = this.makeFirebaseKey(user.phone);
            const emailKey = this.makeFirebaseKey(user.email);

            if (phoneKey) {
                writes.push(this.putFirebaseValue(`${basePath}/userPhoneIndex/${phoneKey}`, null));
            }
            if (emailKey) {
                writes.push(this.putFirebaseValue(`${basePath}/userEmailIndex/${emailKey}`, null));
            }

            await Promise.all(writes);
        } catch (error) {
            console.warn('Firebase user index delete failed', error);
        }
    },

    async putFirebaseValue(path, value) {
        const databaseURL = this.getFirebaseDatabaseURL();
        if (!databaseURL) return;

        const response = await this.fetchWithTimeout(`${databaseURL}/${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value)
        }, 5000);

        if (!response.ok) {
            throw new Error(`Firebase write failed: ${response.status}`);
        }
    },

    isValidAppUser(user) {
        if (!user || typeof user !== 'object') {
            return false;
        }

        const validRole = user.role === 'admin' || user.role === 'member';
        const hasAuthIdentity = Boolean(user.phone || user.email);
        return validRole && hasAuthIdentity;
    },

    async fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
    },

    async saveRegisteredUserToFirebase(newUser) {
        try {
            const databaseURL = this.getFirebaseDatabaseURL();
            const usersPath = this.getFirebaseUsersPath();

            if (!databaseURL) {
                throw new Error('Firebase databaseURL is missing');
            }

            const response = await this.fetchWithTimeout(`${databaseURL}/${usersPath}/${newUser.id}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser)
            }, 6000);

            if (!response.ok) {
                throw new Error(`Firebase users write failed: ${response.status}`);
            }

            await this.saveUserIndexesToFirebase(newUser);
            await this.updateUsersMetaInFirebase();
            return true;
        } catch (error) {
            console.error('Firebase users write failed', error);
            return false;
        }
    },

    async updateUsersMetaInFirebase() {
        const databaseURL = this.getFirebaseDatabaseURL();
        const usersPath = this.getFirebaseUsersPath();
        const users = StorageManager.getUsers();
        if (!databaseURL) return;

        await fetch(`${databaseURL}/${usersPath}/_meta.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lastSync: new Date().toISOString(),
                itemCount: users.length
            })
        }).catch(error => {
            console.warn('Firebase users meta update failed', error);
        });
    },

    /**
     * Login user with password verification
     */
    async login(phone, password) {
        phone = phone?.trim();

        // Validate input
        if (!phone || !password) {
            return { success: false, message: 'Phone number and password are required' };
        }

        await this.waitForFirebaseSyncReady();
        if (!window.FirebaseSync?.enabled) {
            console.warn('FirebaseSync is not enabled. Trying Firebase REST auth fallback.');
        }

        const indexedUser = await this.refreshIndexedUserBeforeAuth(phone);
        let authResult = await this.getAuthenticatedLocalUser(phone, password, indexedUser);

        if (!authResult.user && authResult.canRefresh) {
            const refreshedUser = await this.refreshUsersBeforeAuth(phone);
            authResult = await this.getAuthenticatedLocalUser(phone, password, refreshedUser || indexedUser);
        }

        if (!authResult.user) {
            return { success: false, message: authResult.message };
        }

        const user = authResult.user;

        const activeSession = await this.createActiveSession(user);

        // Store current user (without password/hash)
        const sessionUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            joinDate: user.joinDate,
            status: user.status,
            sessionId: activeSession.sessionId,
            deviceId: activeSession.deviceId
        };
        StorageManager.setCurrentUser(sessionUser);

        return { 
            success: true, 
            message: 'Login successful',
            user: sessionUser 
        };
    },

    async getAuthenticatedLocalUser(phone, password, preferredUser = null) {
        const user = preferredUser || StorageManager.getUserByPhone(phone);
        if (!user) {
            return {
                user: null,
                canRefresh: true,
                message: 'Invalid phone number or password'
            };
        }

        const passwordValid = await StorageManager.verifyPassword(user, password);
        if (!passwordValid) {
            return {
                user: null,
                canRefresh: true,
                message: 'Invalid phone number or password'
            };
        }

        if (user.role === 'member' && user.status === 'pending') {
            const activatedUser = {
                ...user,
                status: 'active',
                updatedAt: new Date().toISOString()
            };

            StorageManager.updateUser(user.id, activatedUser);
            this.saveRegisteredUserToFirebase(activatedUser).catch(error => {
                console.warn('Pending account activation sync failed', error);
            });

            return {
                user: activatedUser,
                canRefresh: false,
                message: 'Login successful'
            };
        }

        if (user.role !== 'admin' && user.status !== 'active') {
            return {
                user: null,
                canRefresh: true,
                message: user.status === 'pending'
                    ? 'Your account is being activated. Please try again.'
                    : 'Your account is inactive. Please contact admin.'
            };
        }

        return {
            user,
            canRefresh: false,
            message: 'Login successful'
        };
    },

    async refreshIndexedUserBeforeAuth(phone = '') {
        try {
            const indexedUser = await this.getFirebaseUserByIndexedPhone(phone);
            if (!indexedUser) return null;

            this.saveCanonicalUserToLocal(indexedUser);
            return indexedUser;
        } catch (error) {
            console.warn('Unable to refresh indexed user before login. Using local data.', error);
            return null;
        }
    },

    async refreshUsersBeforeAuth(phone = '') {
        try {
            const refreshedIndexedUser = await this.refreshIndexedUserBeforeAuth(phone);
            if (refreshedIndexedUser) {
                return refreshedIndexedUser;
            }

            if (window.FirebaseSync?.ready) {
                await this.waitForFirebaseSyncReady(3000);
            }

            const firebaseUsers = await this.getFirebaseUsers();
            if (firebaseUsers.length > 0) {
                const mergedUsers = this.mergeUsersForAuth(firebaseUsers, StorageManager.getUsers());
                localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(mergedUsers));
                return StorageManager.getUserByPhone(phone);
            }
        } catch (error) {
            console.warn('Unable to refresh users before login. Using local data.', error);
        }

        return null;
    },

    saveCanonicalUserToLocal(user) {
        if (!user || !this.isValidAppUser(user)) return;

        const keys = new Set(this.getUserIdentityKeys(user));
        const users = StorageManager.getUsers().filter(localUser => {
            if (Number(localUser.id) === Number(user.id)) return false;
            return !this.getUserIdentityKeys(localUser).some(key => keys.has(key));
        });

        users.push(user);
        localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(users));
    },

    mergeUsersForAuth(firebaseUsers, localUsers) {
        const deletedUserIds = new Set(
            StorageManager.getDeletedUserIds ? StorageManager.getDeletedUserIds() : []
        );
        const mergedByKey = new Map();
        const usersWithoutIdentity = [];
        const users = [...firebaseUsers, ...localUsers]
            .filter(user => this.isValidAppUser(user) && !deletedUserIds.has(Number(user.id)));

        users.forEach(user => {
            const keys = this.getUserIdentityKeys(user);
            const existing = keys.map(key => mergedByKey.get(key)).find(Boolean);

            if (!keys.length) {
                usersWithoutIdentity.push(user);
                return;
            }

            const selectedUser = existing && !this.shouldUseUser(user, existing) ? existing : user;
            keys.forEach(key => mergedByKey.set(key, selectedUser));
        });

        return [...new Set(mergedByKey.values()), ...usersWithoutIdentity];
    },

    getUserIdentityKeys(user) {
        const keys = [];
        if (user?.phone) keys.push(`phone:${String(user.phone).trim()}`);
        if (user?.email) keys.push(`email:${String(user.email).trim().toLowerCase()}`);
        return keys;
    },

    getUserTimestamp(user) {
        const dateValues = [
            user?.updatedAt,
            user?.joinDate,
            user?.createdAt
        ];

        return dateValues.reduce((latest, value) => {
            const time = value ? new Date(value).getTime() : 0;
            return Number.isFinite(time) ? Math.max(latest, time) : latest;
        }, 0);
    },

    getUserStatusRank(status) {
        if (status === 'active') return 3;
        if (status === 'inactive') return 2;
        if (status === 'pending') return 1;
        return 0;
    },

    shouldUseUser(nextUser, existingUser) {
        const nextTime = this.getUserTimestamp(nextUser);
        const existingTime = this.getUserTimestamp(existingUser);

        if (nextTime !== existingTime) {
            return nextTime > existingTime;
        }

        return this.getUserStatusRank(nextUser?.status) >= this.getUserStatusRank(existingUser?.status);
    },

    /**
     * Logout user
     */
    logout() {
        const user = this.getCurrentUser();
        if (user) {
            this.clearActiveSession(user).catch(error => {
                console.warn('Unable to clear active session', error);
            });
        }
        StorageManager.clearCurrentUser();
        return { success: true, message: 'Logged out successfully' };
    },

    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        return StorageManager.getCurrentUser() !== null;
    },

    /**
     * Get current user
     */
    getCurrentUser() {
        return StorageManager.getCurrentUser();
    },

    /**
     * Check if current user is admin
     */
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.role === 'admin';
    },

    /**
     * Redirect to login if not authenticated
     */
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'index.html';
            return false;
        }

        const sessionUser = this.getCurrentUser();
        const savedUser = StorageManager.getUserById(sessionUser.id);
        if (!savedUser || (savedUser.role !== 'admin' && savedUser.status !== 'active')) {
            this.logout();
            window.location.href = 'index.html';
            return false;
        }

        return true;
    },

    /**
     * Redirect to home if the current user is not an admin
     */
    requireAdmin() {
        if (!this.requireAuth()) {
            return false;
        }

        if (!this.isAdmin()) {
            alert('Admin access required');
            window.location.href = 'index.html';
            return false;
        }

        return true;
    },

    /**
     * Redirect to dashboard if already logged in
     */
    blockIfLoggedIn() {
        if (this.isLoggedIn()) {
            const user = this.getCurrentUser();
            const savedUser = StorageManager.getUserById(user.id);

            if (!savedUser || (savedUser.role !== 'admin' && savedUser.status !== 'active')) {
                this.logout();
                return true;
            }

            window.location.href = savedUser.role === 'admin' ? 'admin-dashboard.html' : 'dashboard.html';
            return false;
        }
        return true;
    },

    getFirebaseBasePath() {
        return window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
    },

    getDeviceId() {
        const key = 'meatAppDeviceId';
        let deviceId = localStorage.getItem(key);

        if (!deviceId) {
            deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(key, deviceId);
        }

        return deviceId;
    },

    async createActiveSession(user) {
        const session = {
            userId: user.id,
            deviceId: this.getDeviceId(),
            sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            updatedAt: new Date().toISOString()
        };

        await this.putFirebaseValue(`${this.getFirebaseBasePath()}/activeSessions/${user.id}`, session)
            .catch(error => {
                console.warn('Firebase active session write failed', error);
            });

        return session;
    },

    async getActiveSession(userId) {
        const databaseURL = this.getFirebaseDatabaseURL();
        if (!databaseURL || !userId) return null;

        const response = await this.fetchWithTimeout(`${databaseURL}/${this.getFirebaseBasePath()}/activeSessions/${userId}.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) return null;

        const session = await response.json();
        return session && typeof session === 'object' ? session : null;
    },

    async clearActiveSession(user) {
        if (!user?.id || !user?.sessionId) return;

        const activeSession = await this.getActiveSession(user.id).catch(() => null);
        if (!activeSession || activeSession.sessionId !== user.sessionId) return;

        await this.putFirebaseValue(`${this.getFirebaseBasePath()}/activeSessions/${user.id}`, null);
    },

    async validateCurrentSession() {
        return true;
    },

    startSessionGuard() {
        return;
    }
};

window.AuthManager = AuthManager;

document.addEventListener('DOMContentLoaded', () => {
    AuthManager.startSessionGuard();
});

window.addEventListener('focus', () => {
    AuthManager.validateCurrentSession();
});
