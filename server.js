const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// ============= ENVIRONMENT VARIABLES =============
// Ensure all required env vars are set
const requiredEnvVars = ['PAYMENT_PHONE', 'BKASH_APP_PACKAGE', 'NAGAD_APP_PACKAGE', 'JWT_SECRET'];
requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        console.error(`Missing required environment variable: ${varName}`);
        process.exit(1);
    }
});

// ============= MIDDLEWARE =============
const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    try {
        // TODO: In production, verify JWT token
        // const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // req.userId = decoded.id;
        req.userId = 'user123'; // Placeholder
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
};

// ============= SECURE WALLET CONFIGURATION =============
const getWalletConfig = (method) => {
    const wallets = {
        bkash: {
            name: 'bKash',
            androidPackage: process.env.BKASH_APP_PACKAGE,
            fallbackUrl: 'https://www.bkash.com',
            appUrl: 'bkash://start'
        },
        nagad: {
            name: 'Nagad',
            androidPackage: process.env.NAGAD_APP_PACKAGE,
            fallbackUrl: 'https://www.nagad.com.bd',
            appUrl: 'nagad://start'
        }
    };
    
    return wallets[method] || null;
};

// ============= PAYMENT ENDPOINTS =============

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get payment phone (requires authentication)
app.get('/api/payment/phone', authenticateUser, (req, res) => {
    res.json({ 
        phone: process.env.PAYMENT_PHONE,
        masked: maskPhoneNumber(process.env.PAYMENT_PHONE)
    });
});

// Initiate payment
app.post('/api/payment/initiate', authenticateUser, (req, res) => {
    const { method, amount, orderId } = req.body;
    
    // Validation
    if (!method || !amount || !orderId) {
        return res.status(400).json({ error: 'Missing required fields: method, amount, orderId' });
    }
    
    if (!['bkash', 'nagad'].includes(method)) {
        return res.status(400).json({ error: 'Invalid payment method. Use: bkash or nagad' });
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount. Must be greater than 0' });
    }
    
    // Validate order ID format
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid order ID' });
    }
    
    const wallet = getWalletConfig(method);
    
    if (!wallet) {
        return res.status(500).json({ error: 'Payment method not configured' });
    }
    
    try {
        // TODO: Store payment transaction in database
        // TODO: Call actual payment gateway API (bKash/Nagad)
        
        res.json({
            success: true,
            payment: {
                method: wallet.name,
                amount: numAmount,
                phone: process.env.PAYMENT_PHONE,
                orderId: orderId,
                timestamp: new Date().toISOString()
            },
            wallet: {
                androidPackage: wallet.androidPackage,
                appUrl: wallet.appUrl,
                fallbackUrl: wallet.fallbackUrl
            }
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({ error: 'Payment initiation failed' });
    }
});

// Verify payment
app.post('/api/payment/verify', authenticateUser, (req, res) => {
    const { transactionId, orderId, method } = req.body;
    
    // Validation
    if (!transactionId || !orderId || !method) {
        return res.status(400).json({ error: 'Missing required fields: transactionId, orderId, method' });
    }
    
    try {
        // TODO: Verify transaction with payment gateway
        // TODO: Update order status in database
        
        res.json({
            success: true,
            message: 'Payment verification started. Transaction status will be updated.'
        });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ============= UTILITY FUNCTIONS =============
function maskPhoneNumber(phone) {
    if (!phone || phone.length < 8) return '****';
    return phone.substring(0, 4) + '****' + phone.substring(phone.length - 2);
}

// ============= ERROR HANDLING =============
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ============= START SERVER =============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Payment server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    process.exit(0);
});

module.exports = app;