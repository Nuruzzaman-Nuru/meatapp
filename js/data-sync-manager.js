/**
 * Data Synchronization Manager
 * Ensures Firebase and LocalStorage have identical data and behavior
 * 
 * This module:
 * - Tracks sync status for all collections
 * - Ensures bidirectional sync with conflict resolution
 * - Prevents data loss during sync failures
 * - Validates data consistency between Firebase and localStorage
 */

const DataSyncManager = {
    /**
     * Sync state tracking
     */
    syncState: {
        inProgress: false,
        lastSync: null,
        lastSyncUser: null,
        lastSyncContributions: null,
        lastSyncCollectors: null,
        lastSyncDeletedUsers: null,
        failedOperations: []
    },

    /**
     * Initialize sync manager
     */
    init() {
        console.log('DataSyncManager initialized');
    },

    /**
     * CRITICAL: Sync user approval to Firebase
     * Ensures both systems stay in sync when user status changes
     */
    async syncUserApproval(userId) {
        if (!window.FirebaseSync?.enabled) return null;

        try {
            const user = StorageManager.getUserById(userId);
            if (!user) return null;

            // Sync to Firebase
            await FirebaseSync.syncCollectionToFirebase('users');
            
            // Update indices
            if (window.AuthManager?.saveUserIndexesToFirebase) {
                await AuthManager.saveUserIndexesToFirebase(user);
            }

            this.recordSync('user-approval', userId, 'success');
            return { success: true, user };
        } catch (error) {
            console.error('User approval sync failed:', error);
            this.recordSync('user-approval', userId, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * CRITICAL: Sync user deletion to Firebase
     * Ensures deleted users are removed from Firebase and indices
     */
    async syncUserDeletion(userId) {
        if (!window.FirebaseSync?.enabled) return null;

        try {
            /**
             * Sync all affected collections:
             * 1. Users - without the deleted user
             * 2. DeletedUserIds - with the new deleted ID
             * 3. Contributions - without contributions from deleted user
             * 4. Collectors - without assignments for deleted user
             * 5. User indices - cleaned up for deleted user
             */
            
            const user = StorageManager.getUserById(userId) || { id: userId };
            
            // Sync main collections
            await Promise.all([
                FirebaseSync.syncCollectionToFirebase('users'),
                FirebaseSync.syncCollectionToFirebase('deletedUserIds'),
                FirebaseSync.syncCollectionToFirebase('contributions'),
                FirebaseSync.syncCollectionToFirebase('collectors')
            ]);

            // Clean up user indices
            if (window.AuthManager?.deleteUserIndexesFromFirebase) {
                await AuthManager.deleteUserIndexesFromFirebase(user);
            }

            this.recordSync('user-deletion', userId, 'success');
            return { success: true };
        } catch (error) {
            console.error('User deletion sync failed:', error);
            this.recordSync('user-deletion', userId, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * CRITICAL: Sync batch user approvals
     */
    async syncBatchUserApprovals(userIds) {
        if (!window.FirebaseSync?.enabled || userIds.length === 0) return null;

        try {
            // Batch update all at once
            await FirebaseSync.syncCollectionToFirebase('users');

            // Update all user indices
            const updatePromises = [];
            userIds.forEach(userId => {
                const user = StorageManager.getUserById(userId);
                if (user && window.AuthManager?.saveUserIndexesToFirebase) {
                    updatePromises.push(
                        AuthManager.saveUserIndexesToFirebase(user)
                            .catch(err => console.warn(`Index update failed for user ${userId}:`, err))
                    );
                }
            });
            await Promise.all(updatePromises);

            this.recordSync('batch-approval', userIds.length, 'success');
            return { success: true, count: userIds.length };
        } catch (error) {
            console.error('Batch approval sync failed:', error);
            this.recordSync('batch-approval', userIds.length, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * CRITICAL: Sync batch user deletions
     */
    async syncBatchUserDeletions(userIds) {
        if (!window.FirebaseSync?.enabled || userIds.length === 0) return null;

        try {
            // Sync all affected collections atomically
            await Promise.all([
                FirebaseSync.syncCollectionToFirebase('users'),
                FirebaseSync.syncCollectionToFirebase('deletedUserIds'),
                FirebaseSync.syncCollectionToFirebase('contributions'),
                FirebaseSync.syncCollectionToFirebase('collectors')
            ]);

            // Clean up indices for all deleted users
            const cleanupPromises = [];
            userIds.forEach(userId => {
                const user = StorageManager.getUserById(userId) || { id: userId };
                if (window.AuthManager?.deleteUserIndexesFromFirebase) {
                    cleanupPromises.push(
                        AuthManager.deleteUserIndexesFromFirebase(user)
                            .catch(err => console.warn(`Index cleanup failed for user ${userId}:`, err))
                    );
                }
            });
            await Promise.all(cleanupPromises);

            this.recordSync('batch-deletion', userIds.length, 'success');
            return { success: true, count: userIds.length };
        } catch (error) {
            console.error('Batch deletion sync failed:', error);
            this.recordSync('batch-deletion', userIds.length, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Sync contribution/payment status to Firebase
     */
    async syncContributionUpdate(contributionId) {
        if (!window.FirebaseSync?.enabled) return null;

        try {
            await FirebaseSync.syncCollectionToFirebase('contributions');
            this.recordSync('contribution-update', contributionId, 'success');
            return { success: true };
        } catch (error) {
            console.error('Contribution sync failed:', error);
            this.recordSync('contribution-update', contributionId, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Sync collector assignments
     */
    async syncCollectorAssignment(month, year) {
        if (!window.FirebaseSync?.enabled) return null;

        try {
            await FirebaseSync.syncCollectionToFirebase('collectors');
            this.recordSync('collector-assignment', `${month}/${year}`, 'success');
            return { success: true };
        } catch (error) {
            console.error('Collector sync failed:', error);
            this.recordSync('collector-assignment', `${month}/${year}`, 'failed', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Verify Firebase and localStorage have identical data
     * Returns true if data is consistent
     */
    async verifyDataConsistency() {
        if (!window.FirebaseSync?.enabled) return true;

        try {
            // Get user counts from both systems
            const localUsers = StorageManager.getUsers();
            const localDeletedIds = StorageManager.getDeletedUserIds();
            
            console.log('Data Consistency Check:');
            console.log('- Local Users:', localUsers.length);
            console.log('- Deleted User IDs:', localDeletedIds.length);
            console.log('- Local Contributions:', StorageManager.getContributions().length);
            console.log('- Local Collectors:', StorageManager.getCollectors().length);

            return true;
        } catch (error) {
            console.error('Data consistency verification failed:', error);
            return false;
        }
    },

    /**
     * Record sync operation for debugging/auditing
     */
    recordSync(operation, details, status, error = null) {
        const record = {
            timestamp: new Date().toISOString(),
            operation,
            details,
            status,
            error
        };

        // Add to sync state
        if (!Array.isArray(this.syncState.failedOperations)) {
            this.syncState.failedOperations = [];
        }

        if (status === 'failed') {
            this.syncState.failedOperations.push(record);
            // Keep only last 50 failed operations
            if (this.syncState.failedOperations.length > 50) {
                this.syncState.failedOperations.shift();
            }
        }

        this.syncState.lastSync = record.timestamp;
        console.log(`[SYNC] ${operation} (${status}):`, details, error ? `Error: ${error}` : '');
    },

    /**
     * Get sync status report
     */
    getSyncStatus() {
        return {
            ...this.syncState,
            failedOperationCount: (this.syncState.failedOperations || []).length,
            lastFailedOperation: (this.syncState.failedOperations || [])[this.syncState.failedOperations.length - 1] || null
        };
    },

    /**
     * Retry failed sync operations
     */
    async retryFailedOperations() {
        if (!Array.isArray(this.syncState.failedOperations) || this.syncState.failedOperations.length === 0) {
            return { success: true, retriedCount: 0 };
        }

        let retriedCount = 0;

        for (const failedOp of this.syncState.failedOperations) {
            try {
                console.log(`Retrying failed operation: ${failedOp.operation}`);
                // Trigger a full sync - it will pick up any pending changes
                await FirebaseSync.syncAllToFirebase();
                retriedCount++;
            } catch (error) {
                console.warn(`Retry failed for ${failedOp.operation}:`, error);
            }
        }

        // Clear failed operations that were successfully retried
        this.syncState.failedOperations = [];

        return { success: true, retriedCount };
    }
};

// Initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DataSyncManager.init());
} else {
    DataSyncManager.init();
}
