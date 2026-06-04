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

    async fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
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

    mergeUsers(firebaseUsers, localUsers) {
        const deletedUserIds = new Set(
            window.StorageManager?.getDeletedUserIds ? StorageManager.getDeletedUserIds() : []
        );
        const mergedByKey = new Map();
        const usersWithoutIdentity = [];

        [...firebaseUsers, ...localUsers]
            .filter(user => user && !deletedUserIds.has(Number(user.id)))
            .forEach(user => {
                const keys = this.getUserIdentityKeys(user);
                const existing = keys.map(key => mergedByKey.get(key)).find(Boolean);

                if (!keys.length) {
                    usersWithoutIdentity.push(user);
                    return;
                }

                const selectedUser = existing && !this.shouldUseUser(user, existing) ? existing : user;
                keys.forEach(key => mergedByKey.set(key, selectedUser));
            });

        const merged = [...new Set(mergedByKey.values()), ...usersWithoutIdentity];
        let maxId = merged.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0);

        return merged.map(user => {
            if (user.id !== undefined && user.id !== null) {
                return user;
            }

            maxId += 1;
            return { ...user, id: maxId };
        });
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
            const deletedIds = await this.readDeletedUserIdsFromFirebase();
            if (deletedIds.length > 0) {
                const localDeletedIds = this.getLocalItems(keyMap.deletedUserIds);
                const mergedDeletedIds = [...new Set([...localDeletedIds, ...deletedIds].map(id => Number(id)))];
                localStorage.setItem(keyMap.deletedUserIds, JSON.stringify(mergedDeletedIds));
                this.purgeDeletedUsersLocally();
            }
        }

        await Promise.all(Object.entries(keyMap).map(async ([name, storageKey]) => {
            if (name === 'deletedUserIds') return;
            let data = [];

            try {
                data = name === 'users'
                    ? await this.readUsersForSync()
                    : name === 'contributions'
                        ? await this.readContributionsForSync()
                        : await this.readCollectionFromFirebase(name);
            } catch (error) {
                console.warn(`Firebase SDK ${name} read failed. Trying REST fallback.`, error);
                data = name === 'users'
                    ? await this.readPendingUsersFromFirebase()
                    : name === 'contributions'
                        ? await this.readPendingContributionsFromFirebase()
                        : await this.getCollectionFromFirebaseRest(name);
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
                try {
                    localStorage.setItem(storageKey, JSON.stringify(mergedData));
                    if (name === 'users' && window.StorageManager?.activatePendingMembers) {
                        this.purgeDeletedUsersLocally();
                        StorageManager.activatePendingMembers();
                    }
                } catch (error) {
                    if (name !== 'users') {
                        throw error;
                    }

                    console.warn('Full users list is too large for localStorage. Keeping local users plus pending cloud users.', error);
                    const pendingUsers = await this.readPendingUsersFromFirebase();
                    const compactUsers = this.mergeUsers(pendingUsers, localItems);
                    localStorage.setItem(storageKey, JSON.stringify(compactUsers));
                    this.purgeDeletedUsersLocally();
                    if (window.StorageManager?.activatePendingMembers) {
                        StorageManager.activatePendingMembers();
                    }
                }
            }
        }));
    },

    purgeDeletedUsersLocally() {
        if (!window.StorageManager?.getDeletedUserIds) return;

        const deletedIds = new Set(StorageManager.getDeletedUserIds().map(id => Number(id)));
        if (deletedIds.size === 0) return;

        const keyMap = this.getKeyMap();
        const users = this.getLocalItems(keyMap.users).filter(user => !deletedIds.has(Number(user.id)));
        const contributions = this.getLocalItems(keyMap.contributions).filter(item => !deletedIds.has(Number(item.userId)));
        const collectors = this.getLocalItems(keyMap.collectors).filter(item => !deletedIds.has(Number(item.userId)));

        localStorage.setItem(keyMap.users, JSON.stringify(users));
        localStorage.setItem(keyMap.contributions, JSON.stringify(contributions));
        localStorage.setItem(keyMap.collectors, JSON.stringify(collectors));
    },

    async readDeletedUserIdsFromFirebase() {
        if (!this.databaseURL) {
            const ids = await this.readCollectionFromFirebase('deletedUserIds');
            return ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
        }

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/deletedUserIds.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) {
            throw new Error(`Firebase deleted user index read failed with status ${response.status}`);
        }

        const value = await response.json();
        if (!value) return [];

        if (Array.isArray(value)) {
            return value.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
        }

        if (typeof value === 'object') {
            return Object.entries(value)
                .map(([key, item]) => item === true ? Number(key) : Number(item))
                .filter(id => Number.isFinite(id) && id > 0);
        }

        const id = Number(value);
        return Number.isFinite(id) && id > 0 ? [id] : [];
    },

    async readUsersForSync() {
        const pendingUsers = await this.readPendingUsersFromFirebase();

        try {
            const allUsers = await this.getCollectionFromFirebaseRest('users', 8000);
            return this.mergeUsers(allUsers, pendingUsers);
        } catch (error) {
            console.warn('Full users read skipped. Using pending users only.', error);
            return pendingUsers;
        }
    },

    async readContributionsForSync() {
        const pendingContributions = await this.readPendingContributionsFromFirebase();

        try {
            const allContributions = await this.getCollectionFromFirebaseRest('contributions', 8000);
            return this.mergeContributions(allContributions, pendingContributions);
        } catch (error) {
            console.warn('Full contributions read skipped. Using pending payment requests only.', error);
            return pendingContributions;
        }
    },

    async readPendingContributionsFromFirebase() {
        if (!this.databaseURL) return [];

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/pendingPaymentIds.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) {
            throw new Error(`Firebase pending payment index read failed with status ${response.status}`);
        }

        const pendingIds = await response.json();
        if (!pendingIds || typeof pendingIds !== 'object') return [];

        const contributions = await Promise.all(Object.keys(pendingIds)
            .filter(contributionId => pendingIds[contributionId])
            .map(contributionId => this.getContributionFromFirebaseRest(contributionId)));

        return contributions.filter(Boolean);
    },

    async getContributionFromFirebaseRest(contributionId) {
        if (!this.databaseURL) return null;

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/contributions/${contributionId}.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) return null;

        const contribution = await response.json();
        return contribution && typeof contribution === 'object' ? contribution : null;
    },

    async readPendingUsersFromFirebase() {
        if (!this.databaseURL) return [];

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/pendingUserIds.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) {
            throw new Error(`Firebase pending user index read failed with status ${response.status}`);
        }

        const pendingIds = await response.json();
        if (!pendingIds || typeof pendingIds !== 'object') return [];

        const users = await Promise.all(Object.keys(pendingIds)
            .filter(userId => pendingIds[userId])
            .map(userId => this.getUserFromFirebaseRest(userId)));

        return users.filter(Boolean);
    },

    async getUserFromFirebaseRest(userId) {
        if (!this.databaseURL) return null;

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/users/${userId}.json`, {
            cache: 'no-store'
        }, 5000);

        if (!response.ok) return null;

        const user = await response.json();
        return user && typeof user === 'object' ? user : null;
    },

    async readCollectionFromFirebase(name) {
        if (this.hasSdk()) {
            const snapshot = await this.get(this.child(this.ref(this.db), `${this.basePath}/${name}`));
            return snapshot.exists() ? this.firebaseValueToArray(snapshot.val()) : [];
        }

        return await this.getCollectionFromFirebaseRest(name);
    },

    async getCollectionFromFirebaseRest(name, timeoutMs = 8000) {
        if (!this.databaseURL) return [];

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${this.basePath}/${name}.json`, {
            cache: 'no-store'
        }, timeoutMs);
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
        let payload = this.arrayToFirebaseObject(safeItems);

        payload._meta = {
            lastSync: new Date().toISOString(),
            itemCount: safeItems.length
        };

        if (this.databaseURL) {
            if (name === 'users') {
                await this.syncUsersIncrementallyToFirebase(safeItems);
                await this.syncUserIndexesToFirebase(safeItems);
                return;
            }

            if (name === 'contributions') {
                await this.syncContributionsIncrementallyToFirebase(safeItems);
                return;
            }

            if (name === 'deletedUserIds') {
                await this.syncDeletedUserIdsToFirebase(safeItems);
                return;
            }

            await this.syncCollectionToFirebaseRest(name, payload);
            return;
        }

        await this.set(this.ref(this.db, `${this.basePath}/${name}`), payload);
    },

    async syncUsersIncrementallyToFirebase(users) {
        if (!this.databaseURL || !Array.isArray(users)) return;

        await Promise.all(users
            .filter(user => user?.id)
            .map(user => this.putFirebaseValue(`${this.basePath}/users/${user.id}`, user)));

        if (window.StorageManager?.getDeletedUserIds) {
            await Promise.all(StorageManager.getDeletedUserIds()
                .filter(userId => userId)
                .map(userId => this.deleteUserEverywhere({ id: userId })));
        }

        await this.putFirebaseValue(`${this.basePath}/users/_meta`, {
            lastSync: new Date().toISOString(),
            itemCount: users.length
        });
    },

    async syncDeletedUserIdsToFirebase(userIds) {
        if (!this.databaseURL || !Array.isArray(userIds)) return;

        const uniqueIds = [...new Set(userIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0))];
        const payload = uniqueIds.reduce((data, userId) => {
            data[userId] = true;
            return data;
        }, {
            _meta: {
                lastSync: new Date().toISOString(),
                itemCount: uniqueIds.length
            }
        });

        await this.putFirebaseValue(`${this.basePath}/deletedUserIds`, payload);
    },

    async syncContributionsIncrementallyToFirebase(contributions) {
        if (!this.databaseURL || !Array.isArray(contributions)) return;

        await Promise.all(contributions
            .filter(contribution => contribution?.id)
            .map(contribution => this.syncContributionToFirebase(contribution)));

        await this.putFirebaseValue(`${this.basePath}/contributions/_meta`, {
            lastSync: new Date().toISOString(),
            itemCount: contributions.length
        });
    },

    async syncContributionIndexesToFirebase(contributions) {
        if (!this.databaseURL || !Array.isArray(contributions)) return;

        await Promise.all(contributions.map(contribution => this.syncSingleContributionIndexesToFirebase(contribution)));
    },

    async syncContributionToFirebase(contribution) {
        if (!this.databaseURL || !contribution?.id) return;

        await Promise.all([
            this.putFirebaseValue(`${this.basePath}/contributions/${contribution.id}`, contribution),
            this.syncSingleContributionIndexesToFirebase(contribution)
        ]);
    },

    async syncSingleContributionIndexesToFirebase(contribution) {
        if (!this.databaseURL || !contribution?.id) return;

        await this.putFirebaseValue(
            `${this.basePath}/pendingPaymentIds/${contribution.id}`,
            contribution.status === 'pending' ? true : null
        );
    },

    async syncUserIndexesToFirebase(users) {
        if (!this.databaseURL || !Array.isArray(users)) return;

        await Promise.all(users.map(user => this.syncSingleUserIndexesToFirebase(user)));
    },

    async syncSingleUserIndexesToFirebase(user) {
        if (!user?.id) return;

        const writes = [];
        const phoneKey = this.makeFirebaseKey(user.phone);
        const emailKey = this.makeFirebaseKey(user.email);

        if (phoneKey) {
            writes.push(this.putFirebaseValue(`${this.basePath}/userPhoneIndex/${phoneKey}`, user.id));
        }
        if (emailKey) {
            writes.push(this.putFirebaseValue(`${this.basePath}/userEmailIndex/${emailKey}`, user.id));
        }
        writes.push(this.putFirebaseValue(`${this.basePath}/pendingUserIds/${user.id}`, user.status === 'pending' ? true : null));

        await Promise.all(writes);
    },

    async deleteUserEverywhere(user) {
        if (!this.databaseURL || !user?.id) return;

        const writes = [
            this.putFirebaseValue(`${this.basePath}/users/${user.id}`, null),
            this.putFirebaseValue(`${this.basePath}/pendingUserIds/${user.id}`, null),
            this.putFirebaseValue(`${this.basePath}/activeSessions/${user.id}`, null)
        ];
        const phoneKey = this.makeFirebaseKey(user.phone);
        const emailKey = this.makeFirebaseKey(user.email);

        if (phoneKey) {
            writes.push(this.putFirebaseValue(`${this.basePath}/userPhoneIndex/${phoneKey}`, null));
        }
        if (emailKey) {
            writes.push(this.putFirebaseValue(`${this.basePath}/userEmailIndex/${emailKey}`, null));
        }

        await Promise.all(writes);
    },

    makeFirebaseKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[.#$/[\]\s]/g, '_');
    },

    async putFirebaseValue(path, value) {
        if (!this.databaseURL) return;

        const response = await this.fetchWithTimeout(`${this.databaseURL}/${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value)
        }, 5000);

        if (!response.ok) {
            throw new Error(`Firebase REST write failed with status ${response.status}`);
        }
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
