/**
 * Main Application Logic
 * Handles business logic and utility functions
 */

const App = {
    /**
     * Generate monthly contributions for all active members
     */
    generateMonthlyContributions(month, year) {
        const users = StorageManager.getUsers();
        const activeMembers = users.filter(u => u.status === 'active' && u.role === 'member');
        
        const newContributions = [];
        activeMembers.forEach(user => {
            const existing = StorageManager.getOrCreateContribution(user.id, month, year);
            if (existing) newContributions.push(existing);
        });

        return newContributions;
    },

    /**
     * Assign collectors randomly (rotate fairly)
     */
    assignCollectors(month, year, selectedUserIds = null) {
        const users = StorageManager.getUsers();
        const activeMembers = users.filter(u => u.status === 'active' && u.role === 'member');

        if (activeMembers.length < 2) {
            return { success: false, message: 'Need at least 2 active members' };
        }

        if (selectedUserIds) {
            const selectedMembers = selectedUserIds
                .map(id => activeMembers.find(member => member.id === Number(id)))
                .filter(Boolean);

            if (selectedMembers.length !== 2 || selectedMembers[0].id === selectedMembers[1].id) {
                return { success: false, message: 'Please select 2 different active members' };
            }

            const newCollectors = StorageManager.setCollectors(
                month,
                year,
                selectedMembers.map(member => member.id)
            );

            return { success: true, collectors: newCollectors };
        }

        // Sort by last assignment date to rotate fairly
        const collectors = StorageManager.getCollectors();
        const sortedMembers = activeMembers.sort((a, b) => {
            const aLastAssignment = collectors
                .filter(c => c.userId === a.id)
                .map(c => new Date(c.assignedDate))
                .sort((d1, d2) => d2 - d1)[0] || new Date(0);
            
            const bLastAssignment = collectors
                .filter(c => c.userId === b.id)
                .map(c => new Date(c.assignedDate))
                .sort((d1, d2) => d2 - d1)[0] || new Date(0);

            return aLastAssignment - bLastAssignment;
        });

        const newCollectors = StorageManager.setCollectors(
            month, 
            year, 
            [sortedMembers[0].id, sortedMembers[1].id]
        );

        return { success: true, collectors: newCollectors };
    },

    /**
     * Submit a member payment request for admin confirmation.
     */
    recordPayment(contributionId, paymentMethod = 'cash', paidBy = '', paymentProof = null) {
        const contribution = StorageManager.getContributions().find(c => c.id === contributionId);
        if (!contribution) {
            console.error('Contribution not found with ID:', contributionId);
            console.log('Available contributions:', StorageManager.getContributions());
            return { success: false, message: 'Contribution not found' };
        }

        const updateData = {
            status: 'pending',
            paymentMethod,
            paymentRequestedAt: new Date().toISOString()
        };

        if (paidBy) {
            updateData.paidBy = paidBy;
        }
        if (paymentProof) {
            updateData.paymentProof = paymentProof;
        }

        console.log('Submitting payment request:', contributionId, 'with data:', updateData);
        const updated = StorageManager.updateContribution(contributionId, updateData);

        // Check if update was successful
        if (!updated) {
            console.error('Failed to update contribution:', contributionId);
            return { success: false, message: 'Failed to submit payment request' };
        }

        console.log('Payment request submitted successfully:', updated);

        return { success: true, contribution: updated };
    },

    /**
     * Confirm a payment request from the admin dashboard.
     */
    confirmPayment(contributionId, confirmedBy = 'Admin') {
        const contribution = StorageManager.getContributions().find(c => c.id === contributionId);
        if (!contribution) {
            return { success: false, message: 'Contribution not found' };
        }

        const updateData = {
            status: 'paid',
            paymentDate: new Date().toISOString(),
            confirmedBy
        };

        if (!contribution.paymentMethod) {
            updateData.paymentMethod = 'admin-confirmed';
        }

        const updated = StorageManager.updateContribution(contributionId, updateData);
        if (!updated) {
            return { success: false, message: 'Failed to confirm payment' };
        }

        return { success: true, contribution: updated };
    },

    /**
     * Get user contribution summary
     */
    getUserContributionSummary(userId) {
        const contributions = StorageManager.getUserContributions(userId);
        
        return {
            totalContributions: contributions.length,
            paidCount: contributions.filter(c => c.status === 'paid').length,
            unpaidCount: contributions.filter(c => c.status !== 'paid').length,
            totalPaid: contributions.filter(c => c.status === 'paid').reduce((sum, c) => sum + c.amount, 0),
            totalDue: contributions.filter(c => c.status !== 'paid').reduce((sum, c) => sum + c.amount, 0),
            contributions
        };
    },

    /**
     * Get current month and year
     */
    getCurrentMonthYear() {
        const now = new Date();
        return {
            month: now.getMonth() + 1,
            year: now.getFullYear()
        };
    },

    /**
     * Format date to readable format
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    },

    /**
     * Format currency
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-BD', {
            style: 'currency',
            currency: 'BDT'
        }).format(amount);
    },

    /**
     * Get month name
     */
    getMonthName(monthNumber) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        return monthNames[monthNumber - 1];
    },

    /**
     * Get member with details
     */
    getMemberDetails(userId) {
        const user = StorageManager.getUserById(userId);
        if (!user) return null;

        const summary = this.getUserContributionSummary(userId);
        return {
            ...user,
            ...summary
        };
    },

    /**
     * Get all members with their contribution summary
     */
    getAllMembersWithSummary() {
        const users = StorageManager.getUsers();
        const members = users.filter(u => u.role === 'member' && u.status === 'active');

        return members.map(user => ({
            ...user,
            ...this.getUserContributionSummary(user.id)
        }));
    },

    /**
     * Get collector names for a month
     */
    getMonthCollectorNames(month, year) {
        const collectors = StorageManager.getMonthCollectors(month, year);
        return collectors
            .map(c => {
                const user = StorageManager.getUserById(c.userId);
                if (!user || user.status !== 'active') return null;

                return {
                    id: c.id,
                    userId: c.userId,
                    name: user.name,
                    email: user.email || 'N/A',
                    phone: user.phone || 'N/A'
                };
            })
            .filter(Boolean);
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;

        toast.textContent = message;
        toast.className = `alert alert-${type}`;
        toast.style.display = 'block';

        setTimeout(() => {
            toast.style.display = 'none';
        }, 4000);
    }
};
