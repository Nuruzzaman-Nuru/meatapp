# Firebase vs localStorage Sync Analysis
## Detailed Comparison Report

---

## EXECUTIVE SUMMARY

This codebase uses a dual-storage system with **async one-way sync**: changes are made to localStorage first, then synced to Firebase via REST API. Critical discrepancies exist that can cause data inconsistencies, race conditions, and synchronization failures.

**Key Risk Areas:**
- ⚠️ Asynchronous Firebase sync creates windows where data diverges
- ⚠️ Deleted users may reappear after Firebase refresh
- ⚠️ User indices not properly cleaned up on deletion
- ⚠️ Different merge strategies between Auth and Sync modules
- ⚠️ No transaction support or conflict resolution in merge logic

---

# 1. NEW USER REGISTRATION - DETAILED DIFFERENCES

## Overview
Registration flow differs significantly between initial storage and Firebase persistence.

### A. Registration Flow - localStorage (Immediate)

**File:** [js/storage.js](js/storage.js)  
**Function:** `addUserWithPassword()`  
**Lines:** [188-203]

```javascript
async addUserWithPassword(userData, plainPassword) {
    const users = this.getUsers();  // Line 189: Gets current users
    const passwordHash = await PasswordUtils.hash(plainPassword);
    const now = new Date().toISOString();
    
    const newUser = {
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
        status: 'active',  // Line 194: Creates as 'active', NOT 'pending'
        ...userData,
        passwordHash,
        joinDate: now,
        createdAt: now,
        updatedAt: now
    };
    users.push(newUser);
    localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));  // Line 199: Saves immediately
    return newUser;
}
```

**Issue #1: Status Mismatch**
- localStorage creates users as `'active'` by default (line 194)
- BUT auth.js sets them as `'pending'` (line 76 in register function)
- This is overridden later but creates a momentary inconsistency

---

### B. Registration Flow - Firebase (Conditional)

**File:** [js/auth.js](js/auth.js)  
**Function:** `register()`  
**Lines:** [37-103]

```javascript
async register(formData) {
    // ... validation ...
    
    const newUser = await StorageManager.addUserWithPassword({
        id: nextUserId,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        role: 'member',
        status: 'pending'  // Line 76: Sets to 'pending'
    }, formData.password);

    const savedToFirebase = await this.saveRegisteredUserToFirebase(newUser);  // Line 79
    if (!savedToFirebase) {
        const users = StorageManager.getUsers().filter(user => user.id !== newUser.id);
        localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(users));  // Line 89: REMOVES from localStorage
        return {
            success: false,
            message: 'Registration could not be sent to admin. Please try again.'  // Line 91
        };
    }
    // ...
}
```

**Critical Issue #2: Rollback on Firebase Failure**  
- **Line 88-90**: If Firebase write fails, user is **removed from localStorage**
- User has locally registered but registration is lost
- No permanent record exists in either system
- User cannot retry; must re-enter registration

---

### C. New User Index Creation

**File:** [js/auth.js](js/auth.js)  
**Function:** `saveRegisteredUserToFirebase()`  
**Lines:** [300-321]

```javascript
async saveRegisteredUserToFirebase(newUser) {
    try {
        const response = await this.fetchWithTimeout(
            `${databaseURL}/${usersPath}/${newUser.id}.json`,
            {
                method: 'PUT',
                body: JSON.stringify(newUser)
            }, 6000);
        
        if (!response.ok) throw new Error(`status ${response.status}`);
        
        await this.saveUserIndexesToFirebase(newUser);  // Line 313: Creates phone/email indices
        await this.updateUsersMetaInFirebase();  // Line 314: Updates metadata
        return true;
    } catch (error) {
        console.error('Firebase users write failed', error);
        return false;  // Line 319: Returns false, triggers rollback in storage.js
    }
}
```

### D. User Phone/Email Index Sync

**File:** [js/auth.js](js/auth.js)  
**Function:** `saveUserIndexesToFirebase()`  
**Lines:** [264-280]

```javascript
async saveUserIndexesToFirebase(user) {
    try {
        const writes = [];
        const phoneKey = this.makeFirebaseKey(user.phone);  // Line 269
        const emailKey = this.makeFirebaseKey(user.email);

        if (phoneKey) {
            writes.push(this.putFirebaseValue(`${basePath}/userPhoneIndex/${phoneKey}`, user.id));
        }
        if (emailKey) {
            writes.push(this.putFirebaseValue(`${basePath}/userEmailIndex/${emailKey}`, user.id));
        }
        writes.push(this.putFirebaseValue(
            `${basePath}/pendingUserIds/${user.id}`,
            user.status === 'pending' ? true : null  // Line 278
        ));

        await Promise.all(writes);  // Line 279: All writes must complete
    }
}
```

**Issue #3: Index Creation Window**
- Index update is separate from user write (line 313)
- If user write succeeds but index creation fails, duplicate registrations can occur
- localStorage doesn't track registration indices, only Firebase does

---

### E. User Retrieval Before Auth with Merge

**File:** [js/auth.js](js/auth.js)  
**Function:** `getFirebaseUsers()` with deletion filtering  
**Lines:** [139-172]

```javascript
async getFirebaseUsers() {
    try {
        const response = await this.fetchWithTimeout(
            `${databaseURL}/${usersPath}.json`, 
            { cache: 'no-store' }, 15000);
        
        const value = await response.json();
        const deletedUserIds = new Set(
            StorageManager.getDeletedUserIds ? 
                StorageManager.getDeletedUserIds() : []  // Line 158-159: Gets deleted IDs
        );

        return Object.entries(value)
            .filter(([key]) => key !== '_meta')
            .map(([, user]) => user)
            .filter(user => !deletedUserIds.has(Number(user.id)))  // Line 165: Filters deletions
            .filter(user => this.isValidAppUser(user));
    } catch (error) {
        console.error('Firebase users read failed', error);
        return StorageManager.getUsers();  // Line 171: Falls back to localStorage
    }
}
```

**Issue #4: Deleted User Resurrection**
- Line 165: Filters deleted users using `deletedUserIds` from localStorage
- But if `deletedUserIds` record is lost/corrupted, deleted users reappear
- Firebase itself doesn't track deletion, only localStorage

---

### F. User Merge Strategy for Registration

**File:** [js/auth.js](js/auth.js)  
**Function:** `mergeUsersForAuth()`  
**Lines:** [526-560]

```javascript
mergeUsersForAuth(firebaseUsers, localUsers) {
    const deletedUserIds = new Set(
        StorageManager.getDeletedUserIds ? 
            StorageManager.getDeletedUserIds() : []  // Line 528: Gets deleted set
    );
    const mergedByKey = new Map();
    const usersWithoutIdentity = [];
    const users = [...firebaseUsers, ...localUsers]
        .filter(user => this.isValidAppUser(user) && 
            !deletedUserIds.has(Number(user.id)));  // Line 534: Filters deleted

    users.forEach(user => {
        const keys = this.getUserIdentityKeys(user);  // Phone and email
        const existing = keys.map(key => 
            mergedByKey.get(key)).find(Boolean);

        if (!keys.length) {
            usersWithoutIdentity.push(user);
            return;
        }

        // Line 544-545: Uses timestamp + status rank to decide which version to keep
        const selectedUser = existing && 
            !this.shouldUseUser(user, existing) ? existing : user;
        keys.forEach(key => mergedByKey.set(key, selectedUser));
    });

    return [...new Set(mergedByKey.values()), ...usersWithoutIdentity];
}
```

**Issue #5: Inconsistent Merge with FirebaseSync**  
- `mergeUsersForAuth()` merges by identity keys (phone + email)
- `FirebaseSync.mergeUsers()` uses different strategy (see below)
- Both are called in different contexts, creating two different merge results

---

### G. User Merge Strategy in FirebaseSync

**File:** [js/firebase-sync.js](js/firebase-sync.js)  
**Function:** `mergeUsers()`  
**Lines:** [157-196]

```javascript
mergeUsers(firebaseUsers, localUsers) {
    const deletedUserIds = new Set(
        window.StorageManager?.getDeletedUserIds ? 
            StorageManager.getDeletedUserIds() : []  // Line 160
    );
    const mergedByKey = new Map();
    const usersWithoutIdentity = [];

    [...firebaseUsers, ...localUsers]
        .filter(user => user && !deletedUserIds.has(Number(user.id)))
        .forEach(user => {
            const keys = this.getUserIdentityKeys(user);
            const existing = keys.map(key => 
                mergedByKey.get(key)).find(Boolean);

            if (!keys.length) {
                usersWithoutIdentity.push(user);
                return;
            }

            // Line 174-175: Decides which version based on timestamp + status rank
            const selectedUser = existing && 
                !this.shouldUseUser(user, existing) ? existing : user;
            keys.forEach(key => mergedByKey.set(key, selectedUser));
        });

    const merged = [...new Set(mergedByKey.values()), ...usersWithoutIdentity];
    let maxId = merged.reduce((max, user) => 
        Math.max(max, Number(user.id) || 0), 0);

    // Line 180-185: Reassigns IDs if missing
    return merged.map(user => {
        if (user.id !== undefined && user.id !== null) {
            return user;
        }
        maxId += 1;
        return { ...user, id: maxId };
    });
}
```

**Difference from Auth Merge:**
- `FirebaseSync.mergeUsers()` **reassigns IDs** if missing (lines 180-185)
- `AuthManager.mergeUsersForAuth()` does NOT reassign IDs
- Can cause duplicate ID assignments in race conditions

---

## SUMMARY - REGISTRATION DIFFERENCES

| Aspect | localStorage | Firebase | Issue |
|--------|--------------|----------|-------|
| Timing | Immediate (sync) | After validation (async) | User exists locally then Firebase may reject |
| Rollback | User removed if Firebase fails | N/A | User must re-register |
| Initial Status | 'active' then overridden to 'pending' | 'pending' via auth.js | Momentary inconsistency |
| Indices | Not tracked | Phone + Email indices | Index creation can fail separately |
| Merge Strategy | By identity keys (auth.js) | By identity + ID reassign (firebase-sync.js) | Different results |
| ID Assignment | Max existing ID + 1 | Considers Firebase max ID + 1 | ID conflicts possible |

---

---

# 2. USER APPROVAL/STATUS CHANGES - DETAILED DIFFERENCES

## Overview
Admin status changes use different sync paths and timing that can cause divergence.

### A. Approve User - localStorage Update

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `approveUser()`  
**Lines:** [533-560]

```javascript
async function approveUser(userId) {
    const updated = StorageManager.updateUser(userId, {  // Line 534: Direct localStorage update
        status: 'active',
        updatedAt: new Date().toISOString()
    });
    if (!updated) {
        App.showToast('User not found', 'error');
        return;
    }

    let firebaseSyncFailed = false;
    if (window.FirebaseSync?.enabled) {  // Line 542: Sync ONLY if FirebaseSync is enabled
        try {
            await FirebaseSync.syncCollectionToFirebase('users');  // Line 544: Syncs all users
            await AuthManager.saveUserIndexesToFirebase(updated);  // Line 545: Updates indices
        } catch (error) {
            firebaseSyncFailed = true;  // Line 547: Marks sync as failed
            console.error('Firebase user approval sync failed', error);
        }
    }
    // ... UI updates ...
    if (firebaseSyncFailed) {
        App.showToast('User approved locally, but Firebase sync failed', 'warning');  // Line 560
        return;
    }
}
```

**Issue #1: Sync is Optional**
- Line 542: Sync only happens `if (window.FirebaseSync?.enabled)`
- User can be approved but not synced if FirebaseSync disabled
- Admin dashboard can't force sync or verify completion

---

### B. Storage Update Implementation

**File:** [js/storage.js](js/storage.js)  
**Function:** `updateUser()`  
**Lines:** [207-216]

```javascript
updateUser(userId, updates) {
    const users = this.getUsers();  // Line 208: Gets all users
    const userIndex = users.findIndex(u => Number(u.id) === Number(userId));
    if (userIndex !== -1) {
        users[userIndex] = { 
            ...users[userIndex], 
            ...updates, 
            updatedAt: new Date().toISOString()  // Line 213: Updates timestamp
        };
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));  // Line 214: Saves immediately
        return users[userIndex];
    }
    return null;
}
```

**Issue #2: Timestamp Overwritten**
- Line 213: Function always adds/overwrites `updatedAt`
- Prevents tracing when user actually changed status vs when update was recorded
- Conflicts with merge logic that uses `updatedAt` to determine which version to keep

---

### C. Firebase Sync for Status Change

**File:** [js/firebase-sync.js](js/firebase-sync.js)  
**Automatic Sync Patch:**  
**Lines:** [614-627]

```javascript
patchStorageManager() {
    if (!window.StorageManager || StorageManager.__firebaseSyncPatched) return;

    const patch = (methodName, collections) => {
        const original = StorageManager[methodName];
        StorageManager[methodName] = function patchedStorageMethod(...args) {
            const result = original.apply(this, args);

            if (result && typeof result.then === 'function') {
                return result.then(value => {
                    collections.forEach(collectionName => 
                        FirebaseSync.syncSoon(collectionName));  // Line 621
                    return value;
                });
            }

            collections.forEach(collectionName => 
                FirebaseSync.syncSoon(collectionName));  // Line 625
            return result;
        };
    };

    patch('updateUser', ['users']);  // Line 628
}
```

**Issue #3: Two Sync Paths**
- `updateUser()` is patched to call `syncSoon()` (line 628)
- BUT `approveUser()` also calls `syncCollectionToFirebase()` explicitly (admin-dashboard.html:544)
- Double-sync can happen if both patch and explicit call execute

---

### D. Status Change Index Update

**File:** [js/auth.js](js/auth.js)  
**Function:** `saveUserIndexesToFirebase()`  
**Lines:** [264-280]

```javascript
async saveUserIndexesToFirebase(user) {
    // ... phone/email indices ...
    writes.push(this.putFirebaseValue(
        `${basePath}/pendingUserIds/${user.id}`,
        user.status === 'pending' ? true : null  // Line 278: TRUE if pending, NULL if not
    ));

    await Promise.all(writes);  // Line 279: All writes together
}
```

**Issue #4: Pending Index Cleanup**
- When status changes from 'pending' → 'active', index is set to NULL
- NULL removal in Firebase is async
- Other queries may still see user in `pendingUserIds` temporarily

---

### E. Batch Approval Status Updates

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `approveAllPendingUsers()`  
**Lines:** [1770-1810]

```javascript
function approveAllPendingUsers() {
    const users = StorageManager.getUsers();
    const pendingUsers = users.filter(u => 
        u.role === 'member' && u.status === 'pending');
    
    if (pendingUsers.length === 0) {
        App.showToast('No pending users to approve', 'info');
        return;
    }

    const message = `Approve all ${pendingUsers.length} pending member(s)?...`;
    if (!confirm(message)) {
        return;
    }

    let approveCount = 0;
    pendingUsers.forEach(user => {  // Line 1791: Iterates, no Promise.all()
        const updated = StorageManager.updateUser(user.id, {
            status: 'active',
            updatedAt: new Date().toISOString()
        });
        if (updated) {
            approveCount++;
        }
    });

    initializeCollectorSelects();
    initializeEditSelects();
    loadAdminUsers();
    refreshReport();

    // Line 1806: NO Firebase sync after batch update!
    App.showToast(`Successfully approved ${approveCount} user(s)`, 'success');
}
```

**Critical Issue #5: Missing Firebase Sync for Batch Approval**
- Line 1791-1801: Updates all users but NO async/await
- NO Firebase sync after batch update (unlike individual `approveUser()`)
- Users approved locally but NOT synced to Firebase
- If page refreshes before manual sync, approvals are lost

---

## SUMMARY - STATUS CHANGE DIFFERENCES

| Aspect | localStorage | Firebase | Issue |
|--------|--------------|----------|-------|
| Update Timing | Immediate (sync) | After validation (async) | Users see status change before Firebase knows |
| Batch Operations | All in one localStorage update | Missing Firebase sync in batch | Batch approvals not persisted |
| Timestamp | Overwritten on every update | Used in merge logic | Merge logic unreliable |
| Index Updates | None | Async + separate write | Pending index cleanup delayed |
| Sync Guarantee | None | Optional (if FirebaseSync enabled) | Can approve without syncing |
| Double-Sync | Patch hook + explicit call | Both trigger independently | Wasted API calls |

---

---

# 3. USER DELETION - DETAILED DIFFERENCES

## Overview
User deletion uses a separate deleted tracking system that doesn't fully integrate with Firebase.

### A. Delete User - localStorage Implementation

**File:** [js/storage.js](js/storage.js)  
**Function:** `deleteUser()`  
**Lines:** [218-243]

```javascript
deleteUser(userId) {
    const user = this.getUserById(userId);
    if (!user || user.role === 'admin') {
        return false;
    }

    this.rememberDeletedUser(userId);  // Line 224: Marks as deleted

    const users = this.getUsers()
        .filter(u => Number(u.id) !== Number(userId));  // Line 226: Removes from users
    const contributions = this.getContributions()
        .filter(c => Number(c.userId) !== Number(userId));  // Line 227: Removes contributions
    const collectors = this.getCollectors()
        .filter(c => Number(c.userId) !== Number(userId));  // Line 228: Removes from collectors

    localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));      // Line 230
    localStorage.setItem(this.KEYS.CONTRIBUTIONS, JSON.stringify(contributions));  // Line 231
    localStorage.setItem(this.KEYS.COLLECTORS, JSON.stringify(collectors));  // Line 232

    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.id === userId) {
        this.clearCurrentUser();  // Line 236: Clears session
    }

    return true;
}
```

**Issue #1: Triple Delete Operation**
- User removed from users list (line 226)
- Contributions removed (line 227)  
- Collectors removed (line 228)
- Each is a separate localStorage write - consistency not atomic

---

### B. Deleted User ID Tracking

**File:** [js/storage.js](js/storage.js)  
**Functions:** `rememberDeletedUser()`, `getDeletedUserIds()`, `isDeletedUser()`  
**Lines:** [167-180]

```javascript
rememberDeletedUser(userId) {
    const deletedIds = new Set(this.getDeletedUserIds());  // Line 169: Gets existing
    deletedIds.add(Number(userId));  // Line 170: Adds new ID
    localStorage.setItem(this.KEYS.DELETED_USER_IDS, 
        JSON.stringify([...deletedIds]));  // Line 171: Saves as JSON array
}

getDeletedUserIds() {
    const deletedIds = localStorage.getItem(this.KEYS.DELETED_USER_IDS);  // Line 175
    const parsedIds = deletedIds ? JSON.parse(deletedIds) : [];
    return Array.isArray(parsedIds) ? parsedIds.map(id => Number(id)) : [];
}

isDeletedUser(userId) {
    return this.getDeletedUserIds()
        .includes(Number(userId));  // Line 181: Checks if in deleted set
}
```

**Issue #2: localStorage-only Tracking**
- Line 171: `deletedUserIds` stored only in localStorage
- Firebase doesn't track deletions natively
- Only way Firebase knows is through sync of this array

---

### C. Admin Delete User Flow

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `deleteUser()`  
**Lines:** [677-738]

```javascript
async function deleteUser(userId, button = null) {
    const user = StorageManager.getUserById(userId);
    if (!user || user.role === 'admin') {
        return;
    }

    const summary = App.getUserContributionSummary(userId);
    const detailsMessage = `...${summary.totalContributions}...`;
    
    if (!confirm(`Delete ${user.name}?...${detailsMessage}`)) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = 'Deleting...';  // Line 699: UI feedback
    }

    const deleted = StorageManager.deleteUser(userId);  // Line 701: localStorage delete
    if (!deleted) {
        if (button) {
            button.disabled = false;
            button.textContent = 'Delete';
        }
        App.showToast('User could not be deleted', 'error');
        return;
    }

    let firebaseSyncFailed = false;
    if (window.FirebaseSync?.enabled) {  // Line 710: Conditional Firebase sync
        try {
            await FirebaseSync.syncCollectionToFirebase('users');  // Line 712
            await AuthManager.deleteUserIndexesFromFirebase(user);  // Line 713: Deletes indices
            await FirebaseSync.syncCollectionToFirebase('deletedUserIds');  // Line 714
            await FirebaseSync.syncCollectionToFirebase('contributions');  // Line 715
            await FirebaseSync.syncCollectionToFirebase('collectors');  // Line 716
        } catch (error) {
            firebaseSyncFailed = true;
            console.error('Firebase user delete sync failed', error);
        }
    }

    initializeCollectorSelects();
    initializeEditSelects();
    loadAdminUsers();
    refreshReport();

    if (firebaseSyncFailed) {
        App.showToast(
            'User deleted locally, but Firebase sync failed. Refresh may bring it back.',
            'warning'  // Line 728: User can reappear on refresh!
        );
        return;
    }

    App.showToast('User deleted successfully', 'success');
}
```

**Critical Issue #3: Deleted User Resurrection**
- Line 728 warning: "Refresh may bring it back"
- If Firebase sync fails but localStorage delete succeeds
- Next Firebase refresh will re-populate user from Firebase
- Because Firebase has the user but not the deletion record

---

### D. Delete User Indices from Firebase

**File:** [js/auth.js](js/auth.js)  
**Function:** `deleteUserIndexesFromFirebase()`  
**Lines:** [275-295]

```javascript
async deleteUserIndexesFromFirebase(user) {
    try {
        const databaseURL = this.getFirebaseDatabaseURL();
        const basePath = window.FirebaseSync?.basePath || this.firebaseUsersPath.replace(/\/users$/, '');
        if (!databaseURL || !user?.id) return;

        const writes = [
            this.putFirebaseValue(`${basePath}/pendingUserIds/${user.id}`, null)  // Line 283
        ];
        const phoneKey = this.makeFirebaseKey(user.phone);
        const emailKey = this.makeFirebaseKey(user.email);

        if (phoneKey) {
            writes.push(this.putFirebaseValue(
                `${basePath}/userPhoneIndex/${phoneKey}`, null));  // Line 288
        }
        if (emailKey) {
            writes.push(this.putFirebaseValue(
                `${basePath}/userEmailIndex/${emailKey}`, null));  // Line 291
        }

        await Promise.all(writes);  // Line 293
    } catch (error) {
        console.warn('Firebase user index delete failed', error);  // Line 295: Silently logs
    }
}
```

**Issue #4: Index Deletion Not Guaranteed**
- Line 295: Errors are silently logged only
- No retry logic
- If any index deletion fails, user can be re-added via indices

---

### E. Batch Delete Inactive Users

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `deleteAllInactiveUsers()`  
**Lines:** [1731-1767]

```javascript
function deleteAllInactiveUsers() {
    const users = StorageManager.getUsers();
    const inactiveUsers = users.filter(u => 
        u.role === 'member' && u.status === 'inactive');
    
    if (inactiveUsers.length === 0) {
        App.showToast('No inactive users to delete', 'info');
        return;
    }

    const message = `Delete all ${inactiveUsers.length} inactive member(s)?...`;
    if (!confirm(message)) {
        return;
    }

    let deleteCount = 0;
    let errorCount = 0;

    inactiveUsers.forEach(user => {  // Line 1750: forEach, no async/await
        const deleted = StorageManager.deleteUser(user.id);  // Line 1751: Each deletion separate
        if (deleted) {
            deleteCount++;
        } else {
            errorCount++;
        }
    });

    if (errorCount === 0) {
        loadAdminUsers();
        refreshReport();
        App.showToast(
            `Successfully deleted ${deleteCount} inactive user(s)`, 
            'success');  // Line 1759: No Firebase sync!
    } else {
        App.showToast(`Deleted ${deleteCount}, failed ${errorCount}`, 'warning');
        loadAdminUsers();
        refreshReport();
    }
}
```

**Critical Issue #5: Missing Firebase Sync for Batch Delete**
- Line 1750-1759: Batch delete with NO Firebase sync
- localStorage is cleared but Firebase still has users
- Next refresh brings inactive users back

---

### F. Deleted User Filtering in getUsers()

**File:** [js/storage.js](js/storage.js)  
**Function:** `getUsers()`  
**Lines:** [151-159]

```javascript
getUsers() {
    const users = localStorage.getItem(this.KEYS.USERS);
    const parsedUsers = users ? JSON.parse(users) : [];
    const deletedIds = new Set(this.getDeletedUserIds());  // Line 154: Get deleted IDs
    return Array.isArray(parsedUsers)
        ? parsedUsers.filter(user => !deletedIds.has(Number(user.id)))  // Line 157: Filter
        : [];
}
```

**Issue #6: Filtering is Defense, Not Primary**
- Line 157: Filters based on `deletedUserIds` set
- But users should have already been removed (line 226 in deleteUser)
- Double-filtering indicates inconsistency

---

### G. Deleted Users in Firebase Sync

**File:** [js/firebase-sync.js](js/firebase-sync.js)  
**Function:** `syncFromFirebase()`  
**Lines:** [318-335]

```javascript
async syncFromFirebase() {
    if (!this.enabled || !window.StorageManager) return;

    const keyMap = this.getKeyMap();
    if (keyMap.deletedUserIds) {
        const deletedIds = await this.readCollectionFromFirebase('deletedUserIds');
        if (deletedIds.length > 0) {
            const localDeletedIds = this.getLocalItems(keyMap.deletedUserIds);
            const mergedDeletedIds = [...new Set(
                [...localDeletedIds, ...deletedIds]
                    .map(id => Number(id)))];  // Line 326: Merges deleted IDs
            localStorage.setItem(keyMap.deletedUserIds, 
                JSON.stringify(mergedDeletedIds));  // Line 327: Updates localStorage
        }
    }

    // ... Then processes users with merged deletedIds ...
}
```

**Issue #7: Delayed Deletion Sync**
- Line 326-327: Deleted IDs merged AFTER reading from Firebase
- Then users read with old deleted set, then new deleted set applies
- Window where wrong users appear

---

## SUMMARY - DELETION DIFFERENCES

| Aspect | localStorage | Firebase | Issue |
|--------|--------------|----------|-------|
| Deletion Method | Remove + mark deleted | No native delete | User stays in DB |
| Deletion Tracking | `deletedUserIds` array | Synced via sync.js | Async tracking |
| Related Data | Removed (users, contributions, collectors) | Only user removed | Orphaned records |
| Batch Delete | No Firebase sync | Missing | Deleted users resurface |
| Index Cleanup | Handled by auth.js | Async + unguarded | Silent failures |
| Resurrection Risk | High (refresh brings back) | Data exists in Firebase | Tracked in deletedUserIds |
| Indices | Not cleaned | Cleared separately | Can re-add via index |

---

---

# 4. DATA RETRIEVAL - DETAILED DIFFERENCES

## Overview
User lists are retrieved via different code paths with different filtering logic.

### A. Primary Retrieval - localStorage Direct Read

**File:** [js/storage.js](js/storage.js)  
**Function:** `getUsers()`  
**Lines:** [151-159]

```javascript
getUsers() {
    const users = localStorage.getItem(this.KEYS.USERS);  // Line 152: Raw read
    const parsedUsers = users ? JSON.parse(users) : [];
    const deletedIds = new Set(this.getDeletedUserIds());  // Line 154
    return Array.isArray(parsedUsers)
        ? parsedUsers.filter(user => !deletedIds.has(Number(user.id)))  // Line 157: Filters deleted
        : [];
}
```

**Characteristics:**
- Synchronous operation
- Filters deleted users by checking `deletedUserIds` set
- Returns cached data

---

### B. Firebase Retrieval - Full Users Read

**File:** [js/auth.js](js/auth.js)  
**Function:** `getFirebaseUsers()`  
**Lines:** [139-172]

```javascript
async getFirebaseUsers() {
    try {
        const databaseURL = this.getFirebaseDatabaseURL();
        const usersPath = this.getFirebaseUsersPath();

        if (!databaseURL) {
            return StorageManager.getUsers();  // Line 143: Falls back to localStorage
        }

        const response = await this.fetchWithTimeout(
            `${databaseURL}/${usersPath}.json`,  // Line 146: Full REST read
            { cache: 'no-store' }, 15000);

        if (!response.ok) {
            throw new Error(`Firebase users read failed: ${response.status}`);
        }

        const value = await response.json();
        if (!value) return StorageManager.getUsers();  // Line 153: Falls back
        
        const deletedUserIds = new Set(
            StorageManager.getDeletedUserIds ? 
                StorageManager.getDeletedUserIds() : []  // Line 158: Gets from localStorage
        );

        return Object.entries(value)
            .filter(([key]) => key !== '_meta')  // Line 161: Skips metadata
            .map(([, user]) => user)
            .filter(user => !deletedUserIds.has(Number(user.id)))  // Line 164: Filters deleted
            .filter(user => this.isValidAppUser(user));  // Line 165: Validates
    } catch (error) {
        console.error('Firebase users read failed', error);
        return StorageManager.getUsers();  // Line 170: Falls back
    }
}
```

**Characteristics:**
- Async operation (REST cache-bust)
- 15-second timeout (line 149)
- Also filters deleted users from localStorage deletedIds
- Falls back to localStorage on any error

**Issue #1: Filtering Uses localStorage Deletion Record**
- Line 158-164: Filters Firebase users using localStorage deletedUserIds
- If deletedUserIds is stale, deleted users still appear from Firebase

---

### C. Pending Users Read (Sync Only)

**File:** [js/firebase-sync.js](js/firebase-sync.js)  
**Function:** `readPendingUsersFromFirebase()`  
**Lines:** [376-397]

```javascript
async readPendingUsersFromFirebase() {
    if (!this.databaseURL) return [];

    const response = await this.fetchWithTimeout(
        `${this.databaseURL}/${this.basePath}/pendingUserIds.json`,  // Line 380: Reads pending index
        { cache: 'no-store' }, 5000);

    if (!response.ok) {
        throw new Error(`Firebase pending user index read failed with status ${response.status}`);
    }

    const pendingIds = await response.json();
    if (!pendingIds || typeof pendingIds !== 'object') return [];

    const users = await Promise.all(Object.keys(pendingIds)
        .filter(userId => pendingIds[userId])  // Line 389: Filters TRUE values
        .map(userId => this.getUserFromFirebaseRest(userId)));  // Line 390: Gets each user

    return users.filter(Boolean);  // Line 392: Filters null responses
}
```

**Issue #2: Pending Index Mismatch**
- Line 389-390: Reads pendingUserIds index, then gets each user separately
- If user is NOT in pendingUserIds but status is 'pending', won't be found
- If user IS in pendingUserIds but not in /users node, returns null

---

### D. User Merge for Auth (Different from Sync)

**File:** [js/auth.js](js/auth.js)  
**Function:** `refreshUsersBeforeAuth()`  
**Lines:** [503-523]

```javascript
async refreshUsersBeforeAuth(phone = '') {
    try {
        const refreshedIndexedUser = await this.refreshIndexedUserBeforeAuth(phone);
        if (refreshedIndexedUser) {
            return refreshedIndexedUser;
        }

        if (window.FirebaseSync?.ready) {
            await this.waitForFirebaseSyncReady(3000);  // Line 512: Waits for sync
        }

        const firebaseUsers = await this.getFirebaseUsers();  // Line 515: Gets Firebase users
        if (firebaseUsers.length > 0) {
            const mergedUsers = this.mergeUsersForAuth(
                firebaseUsers, 
                StorageManager.getUsers());  // Line 517: Merges
            localStorage.setItem(
                StorageManager.KEYS.USERS, 
                JSON.stringify(mergedUsers));  // Line 518: Updates localStorage
            return StorageManager.getUserByPhone(phone);
        }
    } catch (error) {
        console.warn('Unable to refresh users before login. Using local data.', error);
    }

    return null;
}
```

**Issue #3: Merge Called During Auth**
- Line 517-518: Calls merge and updates localStorage during login
- Different merge logic than FirebaseSync.mergeUsers()
- Can overwrite properly synced data

---

### E. User Retrieval by Lookup Methods

**File:** [js/storage.js](js/storage.js)  
**Functions:** `getUserByPhone()`, `getUserByEmail()`, `getUserById()`  
**Lines:** [163-180]

```javascript
getUserByEmail(email) {
    const users = this.getUsers();  // Line 164: Gets from localStorage
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return users.find(u => 
        String(u.email || '').trim().toLowerCase() === normalizedEmail);
}

getUserByPhone(phone) {
    const users = this.getUsers();  // Line 172: Gets from localStorage
    const normalizedPhone = String(phone || '').trim();
    return users.find(u => String(u.phone || '').trim() === normalizedPhone);
}

getUserById(id) {
    const users = this.getUsers();  // Line 179: Gets from localStorage
    return users.find(u => Number(u.id) === Number(id));  // Line 180
}
```

**Characteristics:**
- Always retrieves from localStorage via `getUsers()`
- No Firebase lookup for individual users
- Normalizes phone/email for matching

**Issue #4: Firebase Users Not Directly Queryable**
- No direct Firebase phone/email lookup in storage.js
- Must use indexed lookups in auth.js instead (different code path)
- Storage.js methods miss newly-synced Firebase users

---

### F. Statistics Calculation

**File:** [js/storage.js](js/storage.js)  
**Function:** `getMonthlyStats()`  
**Lines:** [476-493]

```javascript
getMonthlyStats(month, year) {
    const contributions = this.getMonthContributions(month, year);  // Line 477
    const totalExpected = contributions.reduce((sum, c) => sum + c.amount, 0);
    const totalPaid = contributions
        .filter(c => c.status === 'paid')
        .reduce((sum, c) => sum + c.amount, 0);
    const totalDue = contributions
        .filter(c => c.status !== 'paid')
        .reduce((sum, c) => sum + c.amount, 0);
    
    return {
        month,
        year,
        totalMembers: contributions.length,  // Line 486: Count of contributions
        paidCount: contributions.filter(c => c.status === 'paid').length,
        unpaidCount: contributions.filter(c => c.status !== 'paid').length,
        pendingCount: contributions.filter(c => c.status === 'pending').length,
        totalExpected,
        totalPaid,
        totalDue,
        contributions
    };
}
```

**Issue #5: Statistics Based on Contributions, Not Users**
- Line 486: `totalMembers` is `contributions.length`, not unique users
- If a user missed a month, they won't be counted
- If a user has multiple contributions, could be counted multiple times

---

### G. Month Contributions Retrieval

**File:** [js/storage.js](js/storage.js)  
**Function:** `getMonthContributions()`  
**Lines:** [415-425]

```javascript
getMonthContributions(month, year) {
    const contributions = this.getContributions()  // Line 416: Gets all contributions
        .filter(c => c.month === month && c.year === year);
    
    // Filter to only include users who joined in this month or before
    return contributions.filter(c => {
        return this.isAccountableMember(c.userId) && 
            this.isValidContributionMonth(c.userId, month, year);  // Line 421
    });
}
```

**Characteristics:**
- Filters both by accountability and validity
- Doesn't create missing contributions
- Returns only existing records

---

## SUMMARY - DATA RETRIEVAL DIFFERENCES

| Method | Source | Sync | Returns | Issue |
|--------|--------|------|---------|-------|
| `getUsers()` | localStorage | Sync | Filtered by deleted | May miss Firebase users |
| `getFirebaseUsers()` | Firebase | Async | With deletion filter | Uses old deletedIds |
| Firebase indices | Firebase | Async | User IDs only | Separate from main query |
| Lookup methods | localStorage | Sync | Single user | Same source as getUsers |
| Month stats | localStorage | Sync | Contribution count | Not unique user count |
| Pending users | Firebase | Async | Via index | Can miss unmarked pending |

---

---

# 5. STATISTICS CALCULATION - DETAILED DIFFERENCES

## Overview
User statistics are calculated differently in different contexts, leading to inconsistent counts.

### A. Admin Dashboard - User Count Calculation

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `loadAdminUsers()`  
**Lines:** [434-465]

```javascript
function loadAdminUsers() {
    const users = StorageManager.getUsers();  // Line 435: Gets from localStorage
    const members = users.filter(user => user.role === 'member');  // Line 436
    const activeCount = members
        .filter(user => user.status === 'active').length;  // Line 437: Counts active
    const pendingCount = members
        .filter(user => user.status === 'pending').length;  // Line 438: Counts pending
    const inactiveCount = members
        .filter(user => user.status === 'inactive').length;  // Line 439: Counts inactive

    document.getElementById('activeUserCount').textContent = activeCount;  // Line 441
    document.getElementById('pendingUserCount').textContent = pendingCount;  // Line 442
    document.getElementById('inactiveUserCount').textContent = inactiveCount;  // Line 443
}
```

**Characteristics:**
- Line 435: Uses only localStorage users
- Filters by role === 'member' (excludes admins)
- Counts by status: active, pending, inactive
- Direct count of users, not contributions

---

### B. Month Statistics - Contribution Count

**File:** [js/storage.js](js/storage.js)  
**Function:** `getMonthlyStats()`  
**Lines:** [476-493]

```javascript
getMonthlyStats(month, year) {
    const contributions = this.getMonthContributions(month, year);  // Line 477
    
    return {
        totalMembers: contributions.length,  // Line 486: Contribution count, not user count!
        paidCount: contributions.filter(c => c.status === 'paid').length,
        unpaidCount: contributions.filter(c => c.status !== 'paid').length,
        pendingCount: contributions.filter(c => c.status === 'pending').length,
        totalExpected,
        totalPaid,
        totalDue
    };
}
```

**Critical Issue #1: Different "Member" Definitions**
- `loadAdminUsers()` line 437-439: Counts users
- `getMonthlyStats()` line 486: Counts contributions
- If a user has no contribution record, they're not counted in month stats
- If a user has multiple contributions (bug), they're counted multiple times

---

### C. Active Members Filter

**File:** [js/app.js](js/app.js)  
**Function:** `generateMonthlyContributions()`  
**Lines:** [11-22]

```javascript
generateMonthlyContributions(month, year) {
    const users = StorageManager.getUsers();  // Line 11: Gets from localStorage
    const activeMembers = users.filter(u => 
        u.status === 'active' && u.role === 'member');  // Line 12: Filters status + role
    
    const newContributions = [];
    activeMembers.forEach(user => {  // Line 15: Creates contribution per user
        const existing = StorageManager.getOrCreateContribution(
            user.id, month, year);  // Line 16
        if (existing) newContributions.push(existing);
    });

    return newContributions;
}
```

**Issue #2: Only Active Members**
- Line 12: Only 'active' members get contributions
- 'pending' and 'inactive' don't generate records
- Monthly stats won't include them even if they should be accountable

---

### D. Admin Dashboard Stats Display

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `refreshReport()`  
**Lines:** [336-359]

```javascript
function refreshReport() {
    const { month, year } = getCurrentMonthYear();

    // Generate contributions if not exist
    App.generateMonthlyContributions(month, year);  // Line 340: Creates records

    // Get stats
    const stats = StorageManager.getMonthlyStats(month, year);  // Line 343: Gets stats
    document.getElementById('totalMembers').textContent = stats.totalMembers;  // Line 344
    document.getElementById('totalCollected')
        .textContent = App.formatCurrency(stats.totalPaid);  // Line 345
    document.getElementById('totalDueAmount')
        .textContent = App.formatCurrency(stats.totalDue);  // Line 346
    document.getElementById('expectedAmount')
        .textContent = App.formatCurrency(stats.totalExpected);  // Line 347
}
```

**Issue #3: Generation Dependency**
- Line 340: Generates contributions for current month
- Line 343: Gets stats using those just-generated records
- If this function doesn't run, stats may be stale
- No guarantee it runs before display

---

### E. Firebase Refresh Before Stats

**File:** [admin-dashboard.html](admin-dashboard.html)  
**Function:** `refreshReportFromFirebase()`  
**Lines:** [377-395]

```javascript
async function refreshReportFromFirebase() {
    if (!window.FirebaseSync?.enabled || adminContributionRefreshInProgress) return;

    adminContributionRefreshInProgress = true;
    try {
        await FirebaseSync.syncFromFirebase();  // Line 383: Syncs from Firebase
        initializeCollectorSelects();
        initializeEditSelects();
        loadAdminUsers();  // Line 386: Reloads user counts
        refreshReport();  // Line 387: Recalculates stats
    } catch (error) {
        console.error('Admin report Firebase refresh failed', error);
    } finally {
        adminContributionRefreshInProgress = false;
    }
}
```

**Issue #4: Async Refresh May Be Stale**
- Line 383: Syncs from Firebase
- But sync is async and can take time
- Display may show stale stats until sync completes
- No progress indicator

---

### F. User Count vs Contribution Count in Dashboard

**File:** [admin-dashboard.html](admin-dashboard.html)  
**HTML Element IDs:**

```html
<!-- User Management stats (direct user count) -->
<div class="stat-box primary">
    <div class="stat-label">Active Users</div>
    <div class="stat-value" id="activeUserCount">0</div>  <!-- Line 443: From loadAdminUsers() -->
</div>

<!-- Monthly stats (contribution count) -->
<div class="stat-box primary">
    <div class="stat-label">Total Members</div>
    <div class="stat-value" id="totalMembers">0</div>  <!-- Line 344: From getMonthlyStats() -->
</div>
```

**Critical Issue #5: Two Different "Members" Numbers**
- "Active Users": Count of users with status === 'active'
- "Total Members" (month): Count of contribution records for that month
- These can be different:
  - New user joins month 2, month 1 stats won't include them
  - User deleted, but contribution records remain
  - User pending, not included in active count or month stats

---

### G. Member Summary Statistics

**File:** [js/app.js](js/app.js)  
**Function:** `getUserContributionSummary()`  
**Lines:** [145-155]

```javascript
getUserContributionSummary(userId) {
    const contributions = 
        StorageManager.getUserContributions(userId);  // Line 146: Gets user's contributions
    
    return {
        totalContributions: contributions.length,  // Line 148: Count of contributions
        paidCount: contributions.filter(c => c.status === 'paid').length,  // Line 149
        unpaidCount: contributions.filter(c => c.status !== 'paid').length,
        totalPaid: contributions.filter(c => c.status === 'paid')
            .reduce((sum, c) => sum + c.amount, 0),  // Line 151
        totalDue: contributions.filter(c => c.status !== 'paid')
            .reduce((sum, c) => sum + c.amount, 0),  // Line 152
        contributions  // Line 153: Including all records
    };
}
```

**Issue #6: Only Counts Valid Contributions**
- Line 146: Uses `getUserContributions()` which only returns valid months
- Contributions only valid from user's join date forward (storage.js:461)
- A user's total count may not match actual records if joined mid-year

---

### H. Contribution Validity Filter

**File:** [js/storage.js](js/storage.js)  
**Function:** `isValidContributionMonth()`  
**Lines:** [454-471]

```javascript
isValidContributionMonth(userId, month, year) {
    const user = this.getUserById(userId);
    if (!user || user.role !== 'member' || !user.joinDate) {
        return false;  // Line 459: Rejects non-members or missing joinDate
    }

    const joinDate = new Date(user.joinDate);
    const joinMonth = joinDate.getMonth();  // Line 462: 0-11
    const joinYear = joinDate.getFullYear();

    // Create date for first of the month being checked
    const checkDate = new Date(year, month, 1);
    const joinMonthStart = new Date(joinYear, joinMonth, 1);

    // Contribution is valid if it's from the month the user joined onwards
    return checkDate >= joinMonthStart;  // Line 470: Only valid from join month onward
}
```

**Issue #7: Validation Logic Inconsistency**
- Line 470: Only accepts contributions from join date forward
- But `getUserContributions()` filters with this (line 421 in storage.js)
- While `getMonthContributions()` also filters with this (line 421)
- Same logic in two places = maintenance risk

---

## SUMMARY - STATISTICS DIFFERENCES

| Statistic | Source | Calculation | Issue |
|-----------|--------|-------------|-------|
| Active Users | User list | Count by status | User count, not contribution count |
| Total Members (month) | Contributions | Contribution count | May not equal active users |
| User Contributions | Valid records | By join date | Missing records may not be counted |
| Paid Amount | Contributions | Sum of 'paid' | Only existing records counted |
| Expected Amount | Contributions | Sum of all | Contributions must exist first |
| Pending Count | Contributions | Filter status | Only if contribution exists |
| Monthly Stats | Contributions | Generated | Requires generation call first |

---

---

# CRITICAL ISSUES SUMMARY

## Race Conditions

| # | Issue | Impact |
|---|----|--------|
| RC1 | User created in localStorage, Firebase write fails | User discarded, must re-register |
| RC2 | Status updated in localStorage, Firebase sync pending | User sees change before admin sees in Firebase |
| RC3 | User deleted in localStorage, deleted index not synced | User reappears on Firebase refresh |
| RC4 | Index write fails after user write | User can re-register via old index |
| RC5 | Batch operations sync missing | Multiple users lost on Firebase |

## Data Inconsistencies

| # | Issue | Impact |
|----|--------|--------|
| DI1 | Different merge strategies (Auth vs Sync) | ID conflicts possible |
| DI2 | Different user counts (user list vs contributions) | Dashboard shows multiple "members" |
| DI3 | Deleted users in deletedUserIds but not removed from Firebase | Users resurface |
| DI4 | Contributions created only for active members | Month stats incomplete |
| DI5 | Pending users tracked in Firebase but not in localStorage | Inconsistent visibility |

## Missing Sync Operations

| # | Location | Operation | Impact |
|----|---------|-----------|--------|
| MS1 | [admin-dashboard.html:1806](admin-dashboard.html#L1806) | Batch approve missing sync | Approvals lost |
| MS2 | [admin-dashboard.html:1759](admin-dashboard.html#L1759) | Batch delete missing sync | Deleted users return |
| MS3 | [admin-dashboard.html:654](admin-dashboard.html#L654) | Status change missing collectors sync | Orphaned assignments |
| MS4 | Multiple locations | Error handling missing retries | Failed syncs not recovered |

## Data Validation Differences

| # | localStorage | Firebase | Impact |
|------|--------------|----------|--------|
| DV1 | Filters deleted via deletedUserIds | Uses REST response | Deleted users may appear |
| DV2 | No phone/email index | Index-based lookups | Duplicate registrations possible |
| DV3 | No status validation | Expects valid roles | Invalid states can persist |
| DV4 | Contribution validation by join date | No validation | Orphaned records possible |

---

---

# RECOMMENDATIONS FOR FIXES

## Priority 1: Critical (Implement Immediately)

1. **Batch Operation Firebase Sync**
   - Add await Firebase sync after batch approve/delete
   - Add error handling with retry logic

2. **Deleted User Index Cleanup**
   - Add retry logic for Firebase index deletion
   - Don't mark user deleted until indices confirmed clear

3. **Transaction-like Compound Operations**
   - Group localStorage + Firebase writes
   - Implement undo/rollback mechanism

## Priority 2: High (Within 1 Sprint)

4. **Unified Merge Strategy**
   - Single merge function used everywhere
   - Consistent conflict resolution logic

5. **Sync Failure Recovery**
   - Queue failed syncs
   - Automatic retry with exponential backoff

6. **Atomic Deletion**
   - Delete user only after related records cleanup
   - Update deletedUserIds atomically

## Priority 3: Medium (Within 1-2 Sprints)

7. **Firebase-backed Indices**
   - Use Firebase indices instead of localStorage for lookups
   - Deprecate localStorage phone/email tracking

8. **Firestore Migration**
   - Replace Realtime Database with Firestore
   - Use transactions for atomic operations

9. **Audit Logging**
   - Log all user changes with timestamps
   - Track which system (local vs Firebase) made change

---

# SPECIFIC CODE LOCATIONS TO REVIEW

## Files with Most Risk
1. **[admin-dashboard.html](admin-dashboard.html)** - Lines 677-738, 1731-1810, operations missing Firebase sync
2. **[js/auth.js](js/auth.js)** - Lines 47-103, merge/registration logic
3. **[js/firebase-sync.js](js/firebase-sync.js)** - Lines 318-335, sync coordination
4. **[js/storage.js](js/storage.js)** - Lines 218-243, deletion logic

## High-Risk Functions
- `StorageManager.deleteUser()` - No transaction, multiple writes
- `approveAllPendingUsers()` - Batch op without Firebase sync
- `deleteAllInactiveUsers()` - Batch op without Firebase sync
- `mergeUsersForAuth()` vs `FirebaseSync.mergeUsers()` - Different logic
- `getFirebaseUsers()` - Falls back after timeout, may use stale data

---

# TEST SCENARIOS TO VALIDATE

1. **Register user, Firebase times out** - User should persist or clear atomically
2. **Approve user, Firebase sync fails** - User must remain approved locally with warning
3. **Delete user, connection drops during index cleanup** - User marked deleted, indices cleaned on retry
4. **Batch approve 10 users** - All must sync to Firebase before success message
5. **Read during Firebase refresh** - Should see consistent data (either old or new, not mixed)
6. **Two admins approve same user** - No double-counting, consistent status
7. **User counts: user list vs month stats** - Should be documented as different or equal

---

**Analysis Generated:** June 1, 2026  
**Codebase Version:** meat-app-management-system-main  
**Files Analyzed:** 5 primary files, 8 functions analyzed for sync behavior
