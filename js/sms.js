/**
 * SMS Notification Service
 * Handles SMS notifications for payment confirmations
 */

const SMSService = {
    // Configuration
    config: {
        enabled: true,
        apiType: 'demo', // 'demo', 'twilio', 'ssh', 'custom'
        apiKey: '',
        apiSecret: '',
        senderName: 'MEAT-APP'
    },

    /**
     * Initialize SMS Service
     */
    init() {
        const saved = localStorage.getItem('smsConfig');
        if (saved) {
            this.config = JSON.parse(saved);
        } else {
            this.saveConfig();
        }
    },

    /**
     * Save SMS configuration
     */
    saveConfig(config = null) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
        localStorage.setItem('smsConfig', JSON.stringify(this.config));
    },

    /**
     * Send payment confirmation SMS
     */
    async sendPaymentConfirmation(memberPhone, memberName, month, year, amount, methodName = 'Cash') {
        if (!this.config.enabled || !memberPhone) {
            console.log('SMS service disabled or no phone number');
            return { success: true, sent: false, message: 'SMS service disabled' };
        }

        try {
            const message = this.generatePaymentMessage(memberName, month, year, amount, methodName);
            
            // Based on API type, route to appropriate service
            switch (this.config.apiType) {
                case 'twilio':
                    return await this.sendViaTwilio(memberPhone, message);
                case 'ssh':
                    return await this.sendViaSSH(memberPhone, message);
                case 'custom':
                    return await this.sendViaCustomAPI(memberPhone, message);
                case 'demo':
                default:
                    return this.sendDemoSMS(memberPhone, message);
            }
        } catch (error) {
            console.error('SMS sending error:', error);
            return { success: false, message: 'Failed to send SMS: ' + error.message };
        }
    },

    /**
     * Generate payment confirmation message
     */
    generatePaymentMessage(memberName, month, year, amount, method = 'Cash') {
        const monthName = this.getMonthName(month);
        const amountBDT = Math.round(amount);
        
        return `Dear ${memberName}, Your payment of ${amountBDT} BDT for ${monthName} ${year} has been successfully confirmed via ${method}. Thank you for your contribution. - ${this.config.senderName}`;
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
     * Send via Twilio
     */
    async sendViaTwilio(phoneNumber, message) {
        try {
            if (!this.config.apiKey || !this.config.apiSecret) {
                throw new Error('Twilio credentials not configured');
            }

            const accountSid = this.config.apiKey; // apiKey stores the Account SID
            const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + btoa(this.config.apiKey + ':' + this.config.apiSecret),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    'From': this.config.senderName,
                    'To': phoneNumber,
                    'Body': message
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Twilio API error: ' + response.statusText);
            }
            const data = await response.json();
            
            return {
                success: true,
                sent: true,
                messageId: data.sid,
                message: 'SMS sent successfully'
            };
        } catch (error) {
            console.error('Twilio error:', error);
            return { success: false, message: 'Twilio API error: ' + error.message };
        }
    },

    /**
     * Send via SSH (Sri Lankan SMS gateway)
     */
    async sendViaSSH(phoneNumber, message) {
        try {
            if (!this.config.apiKey) {
                throw new Error('SSH API Key not configured');
            }

            // Ensure phone number is in proper format for SSH
            let formattedPhone = phoneNumber.replace(/\D/g, '');
            if (formattedPhone.startsWith('0')) {
                formattedPhone = '88' + formattedPhone.substring(1);
            } else if (!formattedPhone.startsWith('88')) {
                formattedPhone = '88' + formattedPhone;
            }

            const response = await fetch('https://api.sshclick.com/api/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    'api_key': this.config.apiKey,
                    'message_type': 'text',
                    'phone': formattedPhone,
                    'message': message
                })
            });

            const data = await response.json();
            
            if (data.success || data.status === 'success') {
                return {
                    success: true,
                    sent: true,
                    messageId: data.message_id || data.id,
                    message: 'SMS sent successfully via SSH'
                };
            } else {
                return { success: false, message: 'SSH API error: ' + (data.error || data.message || 'Unknown error') };
            }
        } catch (error) {
            console.error('SSH error:', error);
            return { success: false, message: 'SSH API error: ' + error.message };
        }
    },

    /**
     * Send via Custom API
     */
    async sendViaCustomAPI(phoneNumber, message) {
        try {
            if (!this.config.apiEndpoint) {
                throw new Error('API Endpoint not configured');
            }
            if (!this.config.apiKey) {
                throw new Error('API Key not configured');
            }

            const response = await fetch(this.config.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.config.apiKey
                },
                body: JSON.stringify({
                    phone: phoneNumber,
                    message: message,
                    sender: this.config.senderName
                })
            });

            const data = await response.json();
            
            if (data.success || response.ok) {
                return {
                    success: true,
                    sent: true,
                    messageId: data.messageId || data.id,
                    message: 'SMS sent successfully'
                };
            } else {
                return { success: false, message: 'Custom API error: ' + (data.error || 'Unknown error') };
            }
        } catch (error) {
            console.error('Custom API error:', error);
            return { success: false, message: 'Custom API error: ' + error.message };
        }
    },

    /**
     * Demo SMS - log to console and storage
     */
    sendDemoSMS(phoneNumber, message) {
        const smsLog = {
            id: Date.now(),
            phone: phoneNumber,
            message: message,
            timestamp: new Date().toISOString(),
            status: 'sent'
        };

        // Save to demo SMS log
        const existingLogs = JSON.parse(localStorage.getItem('smsLogs') || '[]');
        existingLogs.push(smsLog);
        localStorage.setItem('smsLogs', JSON.stringify(existingLogs));

        console.log('📱 Demo SMS Sent:', {
            phone: phoneNumber,
            message: message,
            timestamp: new Date().toLocaleString()
        });

        return {
            success: true,
            sent: true,
            messageId: smsLog.id,
            message: 'Demo SMS logged successfully',
            isDemo: true
        };
    },

    /**
     * Get SMS logs
     */
    getSMSLogs() {
        return JSON.parse(localStorage.getItem('smsLogs') || '[]');
    },

    /**
     * Clear SMS logs
     */
    clearSMSLogs() {
        localStorage.removeItem('smsLogs');
    },

    /**
     * Update SMS configuration
     */
    updateConfig(newConfig) {
        this.saveConfig(newConfig);
        return this.config;
    },

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
};

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        SMSService.init();
    });
} else {
    SMSService.init();
}
