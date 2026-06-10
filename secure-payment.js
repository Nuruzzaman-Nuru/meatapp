// ============= SECURE CLIENT-SIDE PAYMENT HANDLER =============
// This file contains ONLY frontend logic
// All sensitive data is handled by the backend server

const PaymentHandler = {
    // Configure based on your backend URL
    apiBaseUrl: window.API_BASE_URL || 'http://localhost:3000/api',
    
    /**
     * Get authentication token from localStorage
     * Set during login process
     */
    getAuthToken() {
        return localStorage.getItem('authToken');
    },
    
    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        const token = this.getAuthToken();
        if (!token) {
            this.showError('Please log in to make a payment');
            return false;
        }
        return true;
    },
    
    /**
     * Handle payment method change
     */
    async handlePaymentMethodChange() {
        console.log('Payment method changed');
        
        const method = document.getElementById('paymentMethod')?.value;
        
        if (method === 'bkash' || method === 'nagad') {
            // Small delay to ensure UI update
            setTimeout(() => {
                this.initiatePayment(method);
            }, 300);
        }
    },
    
    /**
     * Initiate payment with backend
     */
    async initiatePayment(method) {
        // Check authentication
        if (!this.isAuthenticated()) {
            return;
        }
        
        // Get form data
        const amount = document.getElementById('paymentAmount')?.value;
        const orderId = document.getElementById('orderId')?.value;
        
        // Validate
        if (!amount || !orderId) {
            this.showError('Please enter amount and order ID');
            return;
        }
        
        if (parseFloat(amount) <= 0) {
            this.showError('Amount must be greater than 0');
            return;
        }
        
        try {
            this.showLoading('Initiating payment...');
            
            const response = await fetch(`${this.apiBaseUrl}/payment/initiate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    method: method,
                    amount: parseFloat(amount),
                    orderId: orderId
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                this.showError(error.error || 'Payment initiation failed');
                return;
            }
            
            const data = await response.json();
            console.log('Payment initiated:', data);
            
            this.hideLoading();
            this.openWalletApp(data.wallet, data.payment.phone, method);
            
            // Store payment info for verification later
            sessionStorage.setItem('pendingPayment', JSON.stringify({
                method: method,
                orderId: orderId,
                amount: amount,
                timestamp: Date.now()
            }));
            
        } catch (error) {
            console.error('Payment error:', error);
            this.showError('Payment processing failed. Please check your connection and try again.');
        }
    },
    
    /**
     * Open wallet app
     */
    openWalletApp(walletConfig, phone, method) {
        const walletName = method === 'bkash' ? 'bKash' : 'Nagad';
        
        this.showSuccess(`Opening ${walletName}. Pay to ${phone}, then enter the transaction ID.`);
        
        // For Android devices
        if (/Android/i.test(navigator.userAgent)) {
            console.log('Android device detected');
            
            const intentUrl = `intent://#Intent;scheme=${method};package=${walletConfig.androidPackage};action=android.intent.action.VIEW;end`;
            
            console.log('Opening wallet app via intent');
            window.location.href = intentUrl;
            
            // Fallback if app doesn't open
            setTimeout(() => {
                if (document.visibilityState === 'visible') {
                    console.log('App did not open, showing fallback');
                    this.showWarning(
                        `${walletName} app may not be installed. Please install it and try again, or visit ${walletConfig.fallbackUrl}`
                    );
                }
            }, 2500);
            
            return;
        }
        
        // For iOS and other devices
        console.log('Non-Android device detected');
        window.location.href = walletConfig.appUrl;
        
        setTimeout(() => {
            if (document.visibilityState === 'visible') {
                this.showWarning(
                    `${walletName} app may not be installed. Please install it first.`
                );
            }
        }, 2500);
    },
    
    /**
     * Verify payment after user completes transaction
     */
    async verifyPayment(transactionId, orderId, method) {
        if (!this.isAuthenticated()) {
            return false;
        }
        
        try {
            this.showLoading('Verifying payment...');
            
            const response = await fetch(`${this.apiBaseUrl}/payment/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    transactionId: transactionId,
                    orderId: orderId,
                    method: method
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                this.showError(error.error || 'Verification failed');
                this.hideLoading();
                return false;
            }
            
            const data = await response.json();
            this.hideLoading();
            this.showSuccess('Payment verified successfully!');
            
            // Clear pending payment
            sessionStorage.removeItem('pendingPayment');
            
            return true;
            
        } catch (error) {
            console.error('Verification error:', error);
            this.showError('Payment verification failed. Please try again.');
            this.hideLoading();
            return false;
        }
    },
    
    /**
     * UI Helper: Show error message
     */
    showError(message) {
        console.error(message);
        if (window.App && window.App.showToast) {
            App.showToast(message, 'error');
        } else {
            alert('Error: ' + message);
        }
        this.hideLoading();
    },
    
    /**
     * UI Helper: Show success message
     */
    showSuccess(message) {
        console.log(message);
        if (window.App && window.App.showToast) {
            App.showToast(message, 'success');
        } else {
            alert('Success: ' + message);
        }
    },
    
    /**
     * UI Helper: Show warning message
     */
    showWarning(message) {
        console.warn(message);
        if (window.App && window.App.showToast) {
            App.showToast(message, 'warning');
        } else {
            alert('Warning: ' + message);
        }
    },
    
    /**
     * UI Helper: Show loading state
     */
    showLoading(message = 'Loading...') {
        if (window.App && window.App.showToast) {
            App.showToast(message, 'info');
        }
    },
    
    /**
     * UI Helper: Hide loading state
     */
    hideLoading() {
        // Implementation depends on your UI framework
        // Could hide a spinner or overlay
    }
};

// ============= EVENT INITIALIZATION =============
document.addEventListener('DOMContentLoaded', () => {
    const paymentMethodSelect = document.getElementById('paymentMethod');
    
    if (paymentMethodSelect) {
        paymentMethodSelect.addEventListener('change', () => {
            PaymentHandler.handlePaymentMethodChange();
        });
    }
    
    // Optional: Setup payment verification form
    const verifyForm = document.getElementById('paymentVerifyForm');
    if (verifyForm) {
        verifyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const transactionId = document.getElementById('transactionId')?.value;
            const orderId = document.getElementById('orderId')?.value;
            const method = sessionStorage.getItem('pendingPayment') 
                ? JSON.parse(sessionStorage.getItem('pendingPayment')).method 
                : 'bkash';
            
            if (transactionId && orderId) {
                PaymentHandler.verifyPayment(transactionId, orderId, method);
            }
        });
    }
});

// Expose to global scope for inline usage
window.PaymentHandler = PaymentHandler;