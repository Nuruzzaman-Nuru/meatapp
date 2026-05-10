/**
 * Firebase Cloud Sync
 * Mirrors StorageManager localStorage data to Firestore.
 */

const FirebaseSync = {
    enabled: false,
    db: null,
    collectionPaths: {
        users: 'users',
        contributions: 'contributions',
        collectors: 'collectors',
        announcements: 'announcements',
        monthlyReports: 'monthlyReports'
    },

    async init() {
        try {
            const configModule = await import('../firebase-config.js');
            this.db = configModule.db;
            this.enabled = Boolean(this.db);

            await this.syncFromFirebase();
            this.patchStorageManager();
            await this.syncAllToFirebase();

            console.log('Firebase sync ready');
        } catch (error) {
            this.enabled = false;
            console.warn('Firebase sync disabled. Using localStorage only.', error);
        }
    },

    getKeyMap() {
        if (!window.StorageManager) return {};

        return {
            users: StorageManager.KEYS.USERS,
            contributions: StorageManager.KEYS.CONTRIBUTIONS,
            collectors: StorageManager.KEYS.COLLECTORS,
            announcements: StorageManager.KEYS.ANNOUNCEMENTS,
            monthlyReports: StorageManager.KEYS.MONTHLY_REPORTS
        };
    },

    getDocId(item, index) {
        return String(item?.id ?? index + 1);
    },

    async syncFromFirebase() {
        if (!this.enabled || !window.StorageManager) return;

        const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const keyMap = this.getKeyMap();

        for (const [name, storageKey] of Object.entries(keyMap)) {
            const snapshot = await getDocs(collection(this.db, 'meatAppData', 'default', name));
            if (snapshot.empty) continue;

            const data = [];
            snapshot.forEach(docSnap => {
                if (docSnap.id !== '_meta') {
                    data.push(docSnap.data());
                }
            });

            if (data.length > 0) {
                localStorage.setItem(storageKey, JSON.stringify(data));
            }
        }
    },

    async syncCollectionToFirebase(name) {
        if (!this.enabled || !window.StorageManager) return;

        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const storageKey = this.getKeyMap()[name];
        if (!storageKey) return;

        const rawData = localStorage.getItem(storageKey);
        const items = rawData ? JSON.parse(rawData) : [];
        const safeItems = Array.isArray(items) ? items : [];

        await setDoc(doc(this.db, 'meatAppData', 'default', name, '_meta'), {
            lastSync: new Date().toISOString(),
            itemCount: safeItems.length
        }, { merge: true });

        await Promise.all(safeItems.map((item, index) => {
            return setDoc(
                doc(this.db, 'meatAppData', 'default', name, this.getDocId(item, index)),
                item,
                { merge: true }
            );
        }));
    },

    async syncAllToFirebase() {
        await Promise.all(Object.keys(this.getKeyMap()).map(name => this.syncCollectionToFirebase(name)));
    },

    syncSoon(name) {
        if (!this.enabled) return;
        setTimeout(() => {
            this.syncCollectionToFirebase(name).catch(error => {
                console.error(`Firebase ${name} sync failed`, error);
            });
        }, 0);
    },

    patchStorageManager() {
        if (!window.StorageManager || StorageManager.__firebaseSyncPatched) return;

        const patch = (methodName, collections) => {
            const original = StorageManager[methodName];
            if (typeof original !== 'function') return;

            StorageManager[methodName] = function patchedStorageMethod(...args) {
                const result = original.apply(this, args);
                collections.forEach(collectionName => FirebaseSync.syncSoon(collectionName));
                return result;
            };
        };

        patch('addUser', ['users']);
        patch('updateUser', ['users']);
        patch('deleteUser', ['users', 'contributions', 'collectors']);
        patch('addContribution', ['contributions']);
        patch('updateContribution', ['contributions']);
        patch('setCollectors', ['collectors']);
        patch('addAnnouncement', ['announcements']);
        patch('deleteAnnouncement', ['announcements']);

        StorageManager.__firebaseSyncPatched = true;
    }
};

window.FirebaseSync = FirebaseSync;

window.addEventListener('load', () => {
    FirebaseSync.init();
});
