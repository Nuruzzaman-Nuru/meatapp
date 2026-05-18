/**
 * Storage Management - Handle all localStorage operations
 * This module provides a unified interface for storing and retrieving data
 */

/**
 * Simple Password Utilities for Hashing
 */
const PasswordUtils = {
    /**
     * Simple hash function using SHA-256 simulation
     * Note: For production, use proper bcryptjs library
     */
    hash: async function(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    /**
     * Verify password against hash
     */
    verify: async function(password, hash) {
        const passwordHash = await this.hash(password);
        return passwordHash === hash;
    }
};

const StorageManager = {
    // Key constants
    KEYS: {
        USERS: 'users',
        CURRENT_USER: 'currentUser',
        CONTRIBUTIONS: 'contributions',
        COLLECTORS: 'collectors',
        ANNOUNCEMENTS: 'announcements',
        MONTHLY_REPORTS: 'monthlyReports'
    },

    /**
     * Initialize storage with default data if empty
     */
    init() {
        if (!localStorage.getItem(this.KEYS.USERS)) {
            const adminUser = {
                id: 1,
                name: 'Admin User',
                email: 'admin@meatsystem.com',
                phone: '01737075894',
                // Demo Password: adminnuru1234
                // For production: use bcryptjs or similar library for proper hashing
                password: 'adminnuru1234',
                role: 'admin',
                joinDate: new Date().toISOString(),
                status: 'active'
            };
            localStorage.setItem(this.KEYS.USERS, JSON.stringify([adminUser]));
        }

        if (!localStorage.getItem(this.KEYS.CONTRIBUTIONS)) {
            localStorage.setItem(this.KEYS.CONTRIBUTIONS, JSON.stringify([]));
        }

        if (!localStorage.getItem(this.KEYS.COLLECTORS)) {
            localStorage.setItem(this.KEYS.COLLECTORS, JSON.stringify([]));
        }

        if (!localStorage.getItem(this.KEYS.ANNOUNCEMENTS)) {
            localStorage.setItem(this.KEYS.ANNOUNCEMENTS, JSON.stringify([]));
        }

        if (!localStorage.getItem(this.KEYS.MONTHLY_REPORTS)) {
            localStorage.setItem(this.KEYS.MONTHLY_REPORTS, JSON.stringify([]));
        }
    },

    /**
     * Get all users
     */
    getUsers() {
        const users = localStorage.getItem(this.KEYS.USERS);
        return users ? JSON.parse(users) : [];
    },

    /**
     * Get user by email
     */
    getUserByEmail(email) {
        const users = this.getUsers();
        return users.find(u => u.email === email);
    },

    /**
     * Get user by phone
     */
    getUserByPhone(phone) {
        const users = this.getUsers();
        return users.find(u => u.phone === phone);
    },

    /**
     * Get user by ID
     */
    getUserById(id) {
        const users = this.getUsers();
        return users.find(u => u.id === id);
    },

    /**
     * Verify user password
     * @param {Object} user - User object
     * @param {string} passwordToCheck - Plain password to verify
     * @returns {Promise<boolean>}
     */
    async verifyPassword(user, passwordToCheck) {
        if (!user || !user.passwordHash) {
            return false;
        }
        // For backward compatibility with old records that have plain password
        if (user.password && user.password === passwordToCheck) {
            return true;
        }
        // Verify against hash
        return await PasswordUtils.verify(passwordToCheck, user.passwordHash);
    },

    /**
     * Add new user with hashed password
     */
    async addUserWithPassword(userData, plainPassword) {
        const users = this.getUsers();
        const passwordHash = await PasswordUtils.hash(plainPassword);
        
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            status: 'active',
            ...userData,
            passwordHash,
            joinDate: new Date().toISOString()
        };
        users.push(newUser);
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        return newUser;
    },

    /**
     * Update user password
     */
    async updatePassword(userId, newPassword) {
        const passwordHash = await PasswordUtils.hash(newPassword);
        return this.updateUser(userId, { passwordHash, password: undefined });
    },
        const users = this.getUsers();
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            status: 'active',
            ...userData,
            joinDate: new Date().toISOString()
        };
        users.push(newUser);
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        return newUser;
    },

    /**
     * Update user
     */
    updateUser(userId, updates) {
        const users = this.getUsers();
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            users[userIndex] = { ...users[userIndex], ...updates };
            localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
            return users[userIndex];
        }
        return null;
    },

    /**
     * Delete user and related monthly records
     */
    deleteUser(userId) {
        const user = this.getUserById(userId);
        if (!user || user.role === 'admin') {
            return false;
        }

        const users = this.getUsers().filter(u => u.id !== userId);
        const contributions = this.getContributions().filter(c => c.userId !== userId);
        const collectors = this.getCollectors().filter(c => c.userId !== userId);

        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        localStorage.setItem(this.KEYS.CONTRIBUTIONS, JSON.stringify(contributions));
        localStorage.setItem(this.KEYS.COLLECTORS, JSON.stringify(collectors));

        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.id === userId) {
            this.clearCurrentUser();
        }

        return true;
    },

    /**
     * Set current logged-in user
     */
    setCurrentUser(user) {
        localStorage.setItem(this.KEYS.CURRENT_USER, JSON.stringify(user));
    },

    /**
     * Get current logged-in user
     */
    getCurrentUser() {
        const user = localStorage.getItem(this.KEYS.CURRENT_USER);
        return user ? JSON.parse(user) : null;
    },

    /**
     * Clear current user (logout)
     */
    clearCurrentUser() {
        localStorage.removeItem(this.KEYS.CURRENT_USER);
    },

    /**
     * Get all contributions
     */
    getContributions() {
        const contributions = localStorage.getItem(this.KEYS.CONTRIBUTIONS);
        return contributions ? JSON.parse(contributions) : [];
    },

    /**
     * Add contribution
     */
    addContribution(contribution) {
        const contributions = this.getContributions();
        const newContribution = {
            id: contributions.length > 0 ? Math.max(...contributions.map(c => c.id)) + 1 : 1,
            ...contribution,
            createdAt: new Date().toISOString()
        };
        contributions.push(newContribution);
        localStorage.setItem(this.KEYS.CONTRIBUTIONS, JSON.stringify(contributions));
        return newContribution;
    },

    /**
     * Update contribution
     */
    updateContribution(contributionId, updates) {
        const contributions = this.getContributions();
        const index = contributions.findIndex(c => c.id === contributionId);
        if (index !== -1) {
            contributions[index] = { ...contributions[index], ...updates };
            localStorage.setItem(this.KEYS.CONTRIBUTIONS, JSON.stringify(contributions));
            return contributions[index];
        }
        return null;
    },

    /**
     * Get contributions by user
     */
    getUserContributions(userId) {
        return this.getContributions().filter(c => c.userId === userId);
    },

    /**
     * Get contributions by month
     */
    getMonthContributions(month, year) {
        return this.getContributions().filter(c => c.month === month && c.year === year);
    },

    /**
     * Get or create contribution for user in month
     */
    getOrCreateContribution(userId, month, year) {
        const contributions = this.getContributions();
        let contrib = contributions.find(c => c.userId === userId && c.month === month && c.year === year);
        
        if (!contrib) {
            contrib = this.addContribution({
                userId,
                month,
                year,
                amount: 200,
                status: 'unpaid',
                paymentMethod: null,
                notes: ''
            });
        }
        
        return contrib;
    },

    /**
     * Get all collectors
     */
    getCollectors() {
        const collectors = localStorage.getItem(this.KEYS.COLLECTORS);
        return collectors ? JSON.parse(collectors) : [];
    },

    /**
     * Set collectors for a month (replaces existing)
     */
    setCollectors(month, year, userIds) {
        let collectors = this.getCollectors();
        // Remove existing collectors for this month
        collectors = collectors.filter(c => !(c.month === month && c.year === year));
        
        // Calculate next ID once (not inside map)
        let nextId = collectors.length > 0 ? Math.max(...collectors.map(c => c.id || 0)) + 1 : 1;
        
        // Add new collectors
        const newCollectors = userIds.map(userId => {
            const collector = {
                id: nextId++,
                userId,
                month,
                year,
                assignedDate: new Date().toISOString(),
                collectedAmount: 0
            };
            return collector;
        });
        
        collectors.push(...newCollectors);
        localStorage.setItem(this.KEYS.COLLECTORS, JSON.stringify(collectors));
        return newCollectors;
    },

    /**
     * Get collectors for a month
     */
    getMonthCollectors(month, year) {
        return this.getCollectors().filter(c => c.month === month && c.year === year);
    },

    /**
     * Add announcement
     */
    addAnnouncement(announcement) {
        const announcements = this.getAnnouncements();
        const newAnnouncement = {
            id: announcements.length > 0 ? Math.max(...announcements.map(a => a.id)) + 1 : 1,
            ...announcement,
            createdAt: new Date().toISOString()
        };
        announcements.push(newAnnouncement);
        localStorage.setItem(this.KEYS.ANNOUNCEMENTS, JSON.stringify(announcements));
        return newAnnouncement;
    },

    /**
     * Get all announcements
     */
    getAnnouncements() {
        const announcements = localStorage.getItem(this.KEYS.ANNOUNCEMENTS);
        return announcements ? JSON.parse(announcements) : [];
    },

    /**
     * Delete announcement
     */
    deleteAnnouncement(id) {
        let announcements = this.getAnnouncements();
        announcements = announcements.filter(a => a.id !== id);
        localStorage.setItem(this.KEYS.ANNOUNCEMENTS, JSON.stringify(announcements));
    },

    /**
     * Get monthly stats
     */
    getMonthlyStats(month, year) {
        const contributions = this.getMonthContributions(month, year);
        const totalExpected = contributions.length * 200;
        const totalPaid = contributions.filter(c => c.status === 'paid').reduce((sum, c) => sum + c.amount, 0);
        const totalDue = contributions.filter(c => c.status !== 'paid').reduce((sum, c) => sum + c.amount, 0);
        
        return {
            month,
            year,
            totalMembers: contributions.length,
            paidCount: contributions.filter(c => c.status === 'paid').length,
            unpaidCount: contributions.filter(c => c.status !== 'paid').length,
            pendingCount: contributions.filter(c => c.status === 'pending').length,
            totalExpected,
            totalPaid,
            totalDue,
            contributions
        };
    },

    /**
     * Clear all data (for testing)
     */
    clearAll() {
        localStorage.clear();
        this.init();
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    StorageManager.init();
});
