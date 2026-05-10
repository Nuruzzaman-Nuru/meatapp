/**
 * Authentication Module
 * Handles user registration, login, and session management
 */

const AuthManager = {
    /**
     * Register a new user
     */
    register(formData) {
        // Validate input
        if (!formData.name || !formData.email || !formData.phone || !formData.password || !formData.confirmPassword) {
            return { success: false, message: 'All fields are required' };
        }

        if (formData.password !== formData.confirmPassword) {
            return { success: false, message: 'Passwords do not match' };
        }

        if (formData.password.length < 6) {
            return { success: false, message: 'Password must be at least 6 characters' };
        }

        // Check if phone already exists
        const existingUser = StorageManager.getUserByPhone(formData.phone);
        if (existingUser) {
            return { success: false, message: 'Phone number already registered' };
        }

        // Create user
        const newUser = StorageManager.addUser({
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            password: formData.password, // In production, hash this
            role: 'member',
            status: 'pending'
        });

        return { 
            success: true, 
            message: 'Registration submitted. Please wait for admin approval.', 
            user: newUser 
        };
    },

    /**
     * Login user
     */
    login(phone, password) {
        // Validate input
        if (!phone || !password) {
            return { success: false, message: 'Phone number and password are required' };
        }

        // Find user
        const user = StorageManager.getUserByPhone(phone);
        if (!user) {
            return { success: false, message: 'Invalid phone number or password' };
        }

        // Verify password (in production, compare hashes)
        if (user.password !== password) {
            return { success: false, message: 'Invalid phone number or password' };
        }

        if (user.role !== 'admin' && user.status !== 'active') {
            return { success: false, message: 'Your account is waiting for admin approval' };
        }

        // Store current user
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
