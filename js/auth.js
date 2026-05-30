/**
 * Authentication Module
 * Handles user registration, login, and session management
 */

const AuthManager = {
    firebaseDatabaseURL: 'https://meatapp-eafe7-default-rtdb.asia-southeast1.firebasedatabase.app',
    firebaseUsersPath: 'meatAppData/default/users',

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

        const firebaseUsers = await this.getFirebaseUsers();
        if (firebaseUsers.length > 0) {
            const mergedUsers = this.mergeUsersForAuth(firebaseUsers, StorageManager.getUsers());
            localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(mergedUsers));
        }

        // Check if phone already exists
        const existingUser = StorageManager.getUserByPhone(formData.phone);
        if (existingUser) {
            return { success: false, message: 'Phone number already registered' };
        }

        const existingEmailUser = StorageManager.getUserByEmail(formData.email);
        if (existingEmailUser) {
            return { success: false, message: 'Email already registered' };
        }

        // Create user with hashed password
        const newUser = await StorageManager.addUserWithPassword({
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            role: 'member',
            status: 'pending'
        }, formData.password);

        const savedToFirebase = await this.saveRegisteredUserToFirebase(newUser);
        if (!savedToFirebase) {
            const users = StorageManager.getUsers().filter(user => user.id !== newUser.id);
            localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(users));
            return {
                success: false,
                message: 'Registration could not be sent to admin. Please try again.'
            };
        }

        if (window.FirebaseSync?.enabled) {
            FirebaseSync.syncCollectionToFirebase('users').catch(error => {
                console.warn('Background Firebase sync failed after registration', error);
            });
        }

        return { 
            success: true, 
            message: 'Registration submitted. Please wait for admin approval.', 
            user: newUser 
        };
    },

    isValidGmailAddress(email) {
        return /^[^\s@]+@gmail\.com$/i.test(String(email || '').trim());
    },

    isValidPhoneNumber(phone) {
        return /^\d{11}$/.test(String(phone || '').trim());
    },

    async getFirebaseUsers() {
        try {
            const response = await this.fetchWithTimeout(`${this.firebaseDatabaseURL}/${this.firebaseUsersPath}.json`, {
                cache: 'no-store'
            }, 4000);

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
            const response = await this.fetchWithTimeout(`${this.firebaseDatabaseURL}/${this.firebaseUsersPath}/${newUser.id}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser)
            }, 6000);

            if (!response.ok) {
                throw new Error(`Firebase users write failed: ${response.status}`);
            }

            await this.updateUsersMetaInFirebase();
            return true;
        } catch (error) {
            console.error('Firebase users write failed', error);
            return false;
        }
    },

    async updateUsersMetaInFirebase() {
        const users = StorageManager.getUsers();
        await fetch(`${this.firebaseDatabaseURL}/${this.firebaseUsersPath}/_meta.json`, {
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

        let authResult = await this.getAuthenticatedLocalUser(phone, password);

        if (!authResult.user && authResult.canRefresh) {
            await this.refreshUsersBeforeAuth();
            authResult = await this.getAuthenticatedLocalUser(phone, password);
        }

        if (!authResult.user) {
            return { success: false, message: authResult.message };
        }

        const user = authResult.user;

        // Store current user (without password/hash)
        const sessionUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            joinDate: user.joinDate,
            status: user.status
        };
        StorageManager.setCurrentUser(sessionUser);

        return { 
            success: true, 
            message: 'Login successful',
            user: sessionUser 
        };
    },

    async getAuthenticatedLocalUser(phone, password) {
        const user = StorageManager.getUserByPhone(phone);
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
                canRefresh: false,
                message: 'Invalid phone number or password'
            };
        }

        if (user.role !== 'admin' && user.status !== 'active') {
            return {
                user: null,
                canRefresh: true,
                message: 'Your account is waiting for admin approval'
            };
        }

        return {
            user,
            canRefresh: false,
            message: 'Login successful'
        };
    },

    async refreshUsersBeforeAuth() {
        try {
            if (window.FirebaseSync?.ready) {
                await window.FirebaseSync.ready;
            }

            const firebaseUsers = await this.getFirebaseUsers();
            if (firebaseUsers.length > 0) {
                const mergedUsers = this.mergeUsersForAuth(firebaseUsers, StorageManager.getUsers());
                localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(mergedUsers));
            }
        } catch (error) {
            console.warn('Unable to refresh users before login. Using local data.', error);
        }
    },

    mergeUsersForAuth(firebaseUsers, localUsers) {
        const deletedUserIds = new Set(
            StorageManager.getDeletedUserIds ? StorageManager.getDeletedUserIds() : []
        );
        const merged = firebaseUsers.filter(user => !deletedUserIds.has(Number(user.id)));
        const userKeys = new Set();

        merged.forEach(user => {
            if (user.phone) userKeys.add(`phone:${String(user.phone).trim()}`);
            if (user.email) userKeys.add(`email:${String(user.email).trim().toLowerCase()}`);
        });

        localUsers
            .filter(user => this.isValidAppUser(user) && !deletedUserIds.has(Number(user.id)))
            .forEach(user => {
            const phoneKey = user.phone ? `phone:${String(user.phone).trim()}` : '';
            const emailKey = user.email ? `email:${String(user.email).trim().toLowerCase()}` : '';

            if ((phoneKey && userKeys.has(phoneKey)) || (emailKey && userKeys.has(emailKey))) {
                return;
            }

            merged.push(user);
        });

        return merged;
    },

    /**
     * Logout user
     */
    logout() {
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
    }
};

window.AuthManager = AuthManager;
