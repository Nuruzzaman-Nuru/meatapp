/**
 * Firebase Realtime Database Sync
 * Mirrors StorageManager localStorage data to Realtime Database.
 */

const FirebaseSync = {
    enabled: false,
    db: null,
    ref: null,
    set: null,
    get: null,
    child: null,
    basePath: 'meatAppData/default',

    async init() {
        try {
            const configModule = await import('../firebase-config.js');
            this.db = configModule.db;
            this.ref = configModule.ref;
            this.set = configModule.set;
            this.get = configModule.get;
            this.child = configModule.child;
            this.enabled = Boolean(this.db && this.ref && this.set && this.get && this.child);

            await this.syncFromFirebase();
            this.patchStorageManager();
            await this.syncAllToFirebase();

            console.log('Firebase Realtime Database sync ready');
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

    getItemKey(item, index) {
        return String(item?.id ?? index + 1);
    },

    arrayToFirebaseObject(items) {
        return items.reduce((data, item, index) => {
            data[this.getItemKey(item, index)] = item;
            return data;
        }, {});
    },

    firebaseValueToArray(value) {
        if (!value) return [];

        return Object.entries(value)
            .filter(([key]) => key !== '_meta')
            .map(([, item]) => item);
    },

    async syncFromFirebase() {
        if (!this.enabled || !window.StorageManager) return;

        const keyMap = this.getKeyMap();

        for (const [name, storageKey] of Object.entries(keyMap)) {
            const snapshot = await this.get(this.child(this.ref(this.db), `${this.basePath}/${name}`));
            if (!snapshot.exists()) continue;

            const data = this.firebaseValueToArray(snapshot.val());
            if (data.length > 0) {
                localStorage.setItem(storageKey, JSON.stringify(data));
            }
        }
    },

    async syncCollectionToFirebase(name) {
        if (!this.enabled || !window.StorageManager) return;

        const storageKey = this.getKeyMap()[name];
        if (!storageKey) return;

        const rawData = localStorage.getItem(storageKey);
        const items = rawData ? JSON.parse(rawData) : [];
        const safeItems = Array.isArray(items) ? items : [];
        const payload = this.arrayToFirebaseObject(safeItems);

        payload._meta = {
            lastSync: new Date().toISOString(),
            itemCount: safeItems.length
        };

        await this.set(this.ref(this.db, `${this.basePath}/${name}`), payload);
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

                if (result && typeof result.then === 'function') {
                    return result.then(value => {
                        collections.forEach(collectionName => FirebaseSync.syncSoon(collectionName));
                        return value;
                    });
                }

                collections.forEach(collectionName => FirebaseSync.syncSoon(collectionName));
                return result;
            };
        };

        patch('addUser', ['users']);
        patch('addUserWithPassword', ['users']);
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
