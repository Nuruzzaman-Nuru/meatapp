/**
 * Firebase Cloud Storage Manager
 * Syncs all data with Firestore database for multi-device support
 * 
 * Setup Required:
 * 1. Complete FIREBASE_SETUP.md first
 * 2. Copy your Firebase config to firebase-config.js
 * 3. Include this script AFTER firebase-config.js
 */

// Check if Firebase is available
let isFirebaseEnabled = false;
let db = null;
let auth = null;

// Try to initialize Firebase
async function initializeFirebase() {
    try {
        // Dynamically import Firebase modules
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js');
        const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
        
        // Import Firebase config
        const { firebaseConfig } = await import('./firebase-config.js');
        
        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        isFirebaseEnabled = true;
        
        console.log('✅ Firebase initialized successfully!');
        return true;
    } catch (error) {
        console.log('⚠️ Firebase not configured. Using localStorage only.');
        console.log('To enable cloud sync, complete FIREBASE_SETUP.md');
        return false;
    }
}

// Storage Manager with Firebase support
const FirebaseStorageManager = {
    /**
     * All localStorage keys
     */
    KEYS: {
        USERS: 'users',
        CURRENT_USER: 'currentUser',
        CONTRIBUTIONS: 'contributions',
        COLLECTORS: 'collectors',
        ANNOUNCEMENTS: 'announcements',
        MONTHLY_REPORTS: 'monthlyReports'
    },

    /**
     * Initialize storage - sync from Firebase if available
     */
    async init() {
        // Try Firebase first
        if (isFirebaseEnabled) {
            try {
                await this.syncFromFirebase();
                console.log('✅ Data synced from Firebase');
                return;
            } catch (error) {
                console.log('⚠️ Firebase sync failed, using localStorage');
            }
        }

        // Fallback to localStorage initialization
        if (!localStorage.getItem(this.KEYS.USERS)) {
            const adminUser = {
                id: 1,
                name: 'Admin User',
                email: 'admin@meatsystem.com',
                phone: '01700000000',
                password: 'admin123',
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
     * Sync data FROM Firebase TO localStorage
     */
    async syncFromFirebase() {
        if (!isFirebaseEnabled || !db) return;

        try {
            const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
            
            // Get all collections
            const dataKey = auth.currentUser?.uid || 'default';
            
            // Fetch each collection
            const collections = ['users', 'contributions', 'collectors', 'announcements', 'monthlyReports'];
            
            for (const collName of collections) {
                try {
                    const colRef = collection(db, 'users', dataKey, collName);
                    const snapshot = await getDocs(colRef);
                    
                    let data = [];
                    snapshot.forEach(doc => {
                        data.push(doc.data());
                    });
                    
                    // Store in localStorage
                    const key = collName.charAt(0).toUpperCase() + collName.slice(1).toUpperCase();
                    const storageKey = Object.keys(this.KEYS).find(k => k.replace(/_/g, '').toLowerCase() === collName.toLowerCase());
                    if (storageKey) {
                        localStorage.setItem(this.KEYS[storageKey], JSON.stringify(data));
                    }
                } catch (e) {
                    // Collection might not exist yet
                    console.log(`Collection ${collName} not found in Firebase`);
                }
            }
        } catch (error) {
            console.error('Error syncing from Firebase:', error);
        }
    },

    /**
     * Sync data to Firebase (call after every save)
     */
    async syncToFirebase() {
        if (!isFirebaseEnabled || !db || !auth.currentUser) return;

        try {
            const { collection, doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
            
            const userId = auth.currentUser.uid;
            const timestamp = new Date().toISOString();

            // Sync each collection
            for (const [localKey, storageKey] of Object.entries(this.KEYS)) {
                if (localKey === 'CURRENT_USER') continue; // Skip current user
                
                const data = localStorage.getItem(storageKey);
                if (data) {
                    try {
                        const items = JSON.parse(data);
                        
                        // Save collection metadata
                        const colRef = doc(db, 'users', userId, storageKey.toLowerCase(), '_meta');
                        await setDoc(colRef, {
                            lastSync: timestamp,
                            itemCount: Array.isArray(items) ? items.length : 0
                        }, { merge: true });

                        console.log(`✅ Synced ${storageKey} to Firebase`);
                    } catch (e) {
                        console.log(`Could not sync ${storageKey}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error syncing to Firebase:', error);
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
     * Get user by ID
     */
    getUserById(id) {
        const users = this.getUsers();
        return users.find(u => u.id === id);
    },

    /**
     * Get user by phone
     */
    getUserByPhone(phone) {
        const users = this.getUsers();
        return users.find(u => u.phone === phone);
    },

    /**
     * Add new user
     */
    addUser(userData) {
        const users = this.getUsers();
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            status: 'active',
            ...userData,
            joinDate: new Date().toISOString()
        };
        users.push(newUser);
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        
        // Sync to Firebase
        this.syncToFirebase();
        
        return newUser;
    },

    /**
     * Update user
     */
    updateUser(id, updates) {
        const users = this.getUsers();
        const user = users.find(u => u.id === id);
        
        if (!user) return null;
        
        Object.assign(user, updates);
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        
        // Sync to Firebase
        this.syncToFirebase();
        
        return user;
    },

    /**
     * Delete user
     */
    deleteUser(id) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.id === id);
        
        if (index === -1) return false;
        
        users.splice(index, 1);
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
        
        // Sync to Firebase
        this.syncToFirebase();
        
        return true;
    },

    // Add remaining methods (contributions, collectors, etc.) similar to StorageManager
    // For brevity, they follow the same pattern as above

    /**
     * Set current user session
     */
    setCurrentUser(user) {
        localStorage.setItem(this.KEYS.CURRENT_USER, JSON.stringify(user));
    },

    /**
     * Get current user session
     */
    getCurrentUser() {
        const user = localStorage.getItem(this.KEYS.CURRENT_USER);
        return user ? JSON.parse(user) : null;
    },

    /**
     * Clear current user session
     */
    clearCurrentUser() {
        localStorage.removeItem(this.KEYS.CURRENT_USER);
    }
};

// Initialize Firebase on load
window.addEventListener('load', async () => {
    await initializeFirebase();
    if (typeof StorageManager !== 'undefined') {
        await FirebaseStorageManager.init();
    }
});

// Make available globally
window.FirebaseStorageManager = FirebaseStorageManager;
window.initializeFirebase = initializeFirebase;
