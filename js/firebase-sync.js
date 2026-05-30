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
    databaseURL: '',
    ready: null,

    async init() {
        try {
            const configModule = await import('../firebase-config.js');
            this.db = configModule.db;
            this.ref = configModule.ref;
            this.set = configModule.set;
            this.get = configModule.get;
            this.child = configModule.child;
            this.databaseURL = configModule.firebaseConfig?.databaseURL || '';
            this.enabled = Boolean(this.databaseURL || this.hasSdk());

            await this.syncFromFirebase();
            this.patchStorageManager();

            console.log('Firebase Realtime Database sync ready');
            window.dispatchEvent(new CustomEvent('firebase-sync-ready'));

            this.syncAllToFirebase().catch(error => {
                console.warn('Firebase background sync failed', error);
            });
        } catch (error) {
            this.enabled = false;
            console.warn('Firebase sync disabled. Using localStorage only.', error);
            window.dispatchEvent(new CustomEvent('firebase-sync-ready'));
        }
    },

    getKeyMap() {
        if (!window.StorageManager) return {};

        return {
            users: StorageManager.KEYS.USERS,
            deletedUserIds: StorageManager.KEYS.DELETED_USER_IDS,
            contributions: StorageManager.KEYS.CONTRIBUTIONS,
            collectors: StorageManager.KEYS.COLLECTORS,
            announcements: StorageManager.KEYS.ANNOUNCEMENTS,
            monthlyReports: StorageManager.KEYS.MONTHLY_REPORTS
        };
    },

    hasSdk() {
        return Boolean(this.db && this.ref && this.set && this.get && this.child);
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

    getLocalItems(storageKey) {
        const rawItems = localStorage.getItem(storageKey);
        const items = rawItems ? JSON.parse(rawItems) : [];
        return Array.isArray(items) ? items : [];
    },

    mergeUsers(firebaseUsers, localUsers) {
        const deletedUserIds = new Set(
            window.StorageManager?.getDeletedUserIds ? StorageManager.getDeletedUserIds() : []
        );
        const merged = firebaseUsers.filter(user => !deletedUserIds.has(Number(user.id)));
        const userKeys = new Set();
        let maxId = merged.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0);

        merged.forEach(user => {
            if (user.phone) userKeys.add(`phone:${String(user.phone).trim()}`);
            if (user.email) userKeys.add(`email:${String(user.email).trim().toLowerCase()}`);
        });

        localUsers.filter(user => !deletedUserIds.has(Number(user.id))).forEach(user => {
            const phoneKey = user.phone ? `phone:${String(user.phone).trim()}` : '';
            const emailKey = user.email ? `email:${String(user.email).trim().toLowerCase()}` : '';
            if ((phoneKey && userKeys.has(phoneKey)) || (emailKey && userKeys.has(emailKey))) {
                return;
            }

            maxId += 1;
            merged.push({ ...user, id: maxId });
            if (phoneKey) userKeys.add(phoneKey);
            if (emailKey) userKeys.add(emailKey);
        });

        return merged;
    },

    getContributionKey(contribution) {
        return [
            Number(contribution?.userId),
            Number(contribution?.month),
            Number(contribution?.year)
        ].join(':');
    },

    getContributionTimestamp(contribution) {
        const dateValues = [
            contribution?.paymentDate,
            contribution?.paymentRequestedAt,
            contribution?.updatedAt,
            contribution?.createdAt
        ];

        return dateValues.reduce((latest, value) => {
            const time = value ? new Date(value).getTime() : 0;
            return Number.isFinite(time) ? Math.max(latest, time) : latest;
        }, 0);
    },

    getContributionStatusRank(status) {
        if (status === 'paid') return 3;
        if (status === 'pending') return 2;
        return 1;
    },

    mergeContributions(firebaseContributions, localContributions) {
        const mergedByMonth = new Map();

        [...firebaseContributions, ...localContributions].forEach(contribution => {
            if (!contribution) return;

            const key = this.getContributionKey(contribution);
            const existing = mergedByMonth.get(key);
            if (!existing) {
                mergedByMonth.set(key, contribution);
                return;
            }

            const existingTime = this.getContributionTimestamp(existing);
            const nextTime = this.getContributionTimestamp(contribution);
            const existingRank = this.getContributionStatusRank(existing.status);
            const nextRank = this.getContributionStatusRank(contribution.status);

            if (nextTime > existingTime || (nextTime === existingTime && nextRank >= existingRank)) {
                mergedByMonth.set(key, contribution);
            }
        });

        return [...mergedByMonth.values()].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    },

    getAnnouncementKey(announcement) {
        if (announcement?.id !== undefined && announcement?.id !== null) {
            return `id:${announcement.id}`;
        }

        return [
            'content',
            announcement?.createdAt || '',
            announcement?.title || '',
            announcement?.content || ''
        ].join(':');
    },

    getAnnouncementTimestamp(announcement) {
        const time = announcement?.createdAt ? new Date(announcement.createdAt).getTime() : 0;
        return Number.isFinite(time) ? time : 0;
    },

    mergeAnnouncements(firebaseAnnouncements, localAnnouncements) {
        const mergedByKey = new Map();

        [...firebaseAnnouncements, ...localAnnouncements].forEach(announcement => {
            if (!announcement) return;

            const key = this.getAnnouncementKey(announcement);
            const existing = mergedByKey.get(key);
            if (!existing) {
                mergedByKey.set(key, announcement);
                return;
            }

            if (this.getAnnouncementTimestamp(announcement) >= this.getAnnouncementTimestamp(existing)) {
                mergedByKey.set(key, announcement);
            }
        });

        return [...mergedByKey.values()].sort((a, b) => this.getAnnouncementTimestamp(b) - this.getAnnouncementTimestamp(a));
    },

    async syncFromFirebase() {
        if (!this.enabled || !window.StorageManager) return;

        const keyMap = this.getKeyMap();
        if (keyMap.deletedUserIds) {
            const deletedIds = await this.readCollectionFromFirebase('deletedUserIds');
            if (deletedIds.length > 0) {
                const localDeletedIds = this.getLocalItems(keyMap.deletedUserIds);
                const mergedDeletedIds = [...new Set([...localDeletedIds, ...deletedIds].map(id => Number(id)))];
                localStorage.setItem(keyMap.deletedUserIds, JSON.stringify(mergedDeletedIds));
            }
        }

        await Promise.all(Object.entries(keyMap).map(async ([name, storageKey]) => {
            if (name === 'deletedUserIds') return;
            let data = [];

            try {
                data = await this.readCollectionFromFirebase(name);
            } catch (error) {
                console.warn(`Firebase SDK ${name} read failed. Trying REST fallback.`, error);
                data = await this.getCollectionFromFirebaseRest(name);
            }

            if (data.length > 0) {
                const localItems = this.getLocalItems(storageKey);
                let mergedData = data;
                if (name === 'users') {
                    mergedData = this.mergeUsers(data, localItems);
                }
                if (name === 'contributions') {
                    mergedData = this.mergeContributions(data, localItems);
                }
                if (name === 'announcements') {
                    mergedData = this.mergeAnnouncements(data, localItems);
                }
                localStorage.setItem(storageKey, JSON.stringify(mergedData));
            }
        }));
    },

    async readCollectionFromFirebase(name) {
        if (this.hasSdk()) {
            const snapshot = await this.get(this.child(this.ref(this.db), `${this.basePath}/${name}`));
            return snapshot.exists() ? this.firebaseValueToArray(snapshot.val()) : [];
        }

        return await this.getCollectionFromFirebaseRest(name);
    },

    async getCollectionFromFirebaseRest(name) {
        if (!this.databaseURL) return [];

        const response = await fetch(`${this.databaseURL}/${this.basePath}/${name}.json`);
        if (!response.ok) {
            throw new Error(`Firebase REST ${name} read failed with status ${response.status}`);
        }

        return this.firebaseValueToArray(await response.json());
    },

    async syncCollectionToFirebase(name) {
        if (!this.enabled || !window.StorageManager) return;

        const storageKey = this.getKeyMap()[name];
        if (!storageKey) return;

        const safeItems = this.getLocalItems(storageKey);
        const payload = this.arrayToFirebaseObject(safeItems);

        payload._meta = {
            lastSync: new Date().toISOString(),
            itemCount: safeItems.length
        };

        if (this.databaseURL) {
            await this.syncCollectionToFirebaseRest(name, payload);
            return;
        }

        await this.set(this.ref(this.db, `${this.basePath}/${name}`), payload);
    },

    async syncCollectionToFirebaseRest(name, payload = null) {
        if (!this.databaseURL || !window.StorageManager) return;

        const storageKey = this.getKeyMap()[name];
        if (!storageKey) return;

        const data = payload || {
            ...this.arrayToFirebaseObject(this.getLocalItems(storageKey)),
            _meta: {
                lastSync: new Date().toISOString(),
                itemCount: this.getLocalItems(storageKey).length
            }
        };

        const response = await fetch(`${this.databaseURL}/${this.basePath}/${name}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`Firebase REST ${name} sync failed with status ${response.status}`);
        }
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
        patch('deleteUser', ['users', 'deletedUserIds', 'contributions', 'collectors']);
        patch('addContribution', ['contributions']);
        patch('updateContribution', ['contributions']);
        patch('setCollectors', ['collectors']);
        patch('addAnnouncement', ['announcements']);
        patch('deleteAnnouncement', ['announcements']);

        StorageManager.__firebaseSyncPatched = true;
    }
};

window.FirebaseSync = FirebaseSync;

FirebaseSync.ready = FirebaseSync.init();
