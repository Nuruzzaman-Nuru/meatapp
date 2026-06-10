# Meatapp - Payment Security Update

**CRITICAL SECURITY FIX**

## What Changed

### Before (❌ VULNERABLE)
- Hardcoded phone number in frontend code
- Sensitive data exposed in JavaScript
- No authentication checks
- Payment logic on client-side
- Visible to anyone viewing page source

### After (✅ SECURE)
- All sensitive data in backend `.env` file
- Frontend only handles UI
- Authentication required (JWT tokens)
- Payment processing server-side
- Secure API endpoints

## Files Added

### Backend Files
- **server.js** - Express backend for payment processing
- **package.json** - Node.js dependencies
- **.env.example** - Environment variable template
- **SECURITY.md** - Security implementation guide

### Frontend Files
- **secure-payment.js** - Safe payment handler for frontend

## Quick Start

### 1. Setup Backend
```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your values
# Start server
npm start
```

### 2. Update Frontend
- Remove inline payment code from dashboard.html
- Include secure-payment.js instead
- Update API_BASE_URL to your backend server

### 3. Test
```bash
# Test backend is running
curl http://localhost:3000/health

# Should respond: {"status":"ok",...}
```

## Environment Variables

Create `.env` file (never commit to git):
```
PAYMENT_PHONE=01931634792
BKASH_APP_PACKAGE=com.bKash.customerapp
NAGAD_APP_PACKAGE=com.konasl.nagad
JWT_SECRET=your_random_secret_key_here
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-url.com
```

## API Endpoints

All endpoints require `Authorization: Bearer <token>` header

### GET /health
- Health check (no auth required)
- Response: `{"status":"ok"}`

### GET /api/payment/phone
- Get payment phone number
- Response: `{"phone":"01931634792","masked":"0193****92"}`

### POST /api/payment/initiate
Request:
```json
{
  "method": "bkash",
  "amount": 500,
  "orderId": "order123"
}
```

Response:
```json
{
  "success": true,
  "payment": {
    "method": "bKash",
    "amount": 500,
    "phone": "01931634792",
    "orderId": "order123"
  },
  "wallet": {
    "androidPackage": "com.bKash.customerapp",
    "appUrl": "bkash://start",
    "fallbackUrl": "https://www.bkash.com"
  }
}
```

### POST /api/payment/verify
Request:
```json
{
  "transactionId": "txn123456",
  "orderId": "order123",
  "method": "bkash"
}
```

## Frontend Usage

```html
<!-- Include secure payment handler -->
<script src="secure-payment.js"></script>

<!-- Payment form -->
<select id="paymentMethod" onchange="PaymentHandler.handlePaymentMethodChange()">
  <option value="">Select payment method</option>
  <option value="bkash">bKash</option>
  <option value="nagad">Nagad</option>
</select>

<input type="number" id="paymentAmount" placeholder="Amount">
<input type="text" id="orderId" placeholder="Order ID">
```

## Security Checklist

- [x] Move sensitive data to backend
- [x] Add authentication requirement
- [x] Remove hardcoded credentials
- [x] Implement API endpoints
- [ ] Integrate actual payment gateways
- [ ] Setup database for transactions
- [ ] Generate JWT tokens on login
- [ ] Add rate limiting
- [ ] Setup HTTPS/SSL
- [ ] Enable monitoring
- [ ] Get security audit

## Next Steps

1. Deploy backend server
2. Update frontend to use secure-payment.js
3. Integrate with payment gateway APIs
4. Setup database
5. Add webhook handlers
6. Test thoroughly
7. Deploy to production

## Support

For questions about:
- Backend setup: Check server.js comments
- Frontend integration: See secure-payment.js
- Payment gateways: Contact bKash/Nagad support

---

**⚠️ DO NOT commit .env file to git!**
**⚠️ Store sensitive keys securely!**