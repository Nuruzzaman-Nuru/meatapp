# SMS Notification Feature Guide

## Overview
The SMS Notification feature automatically sends confirmation SMS messages to members when their payment is successfully recorded for a monthly contribution. This provides instant confirmation and improves member communication.

## Features

✅ **Automatic Payment Confirmation SMS** - SMS sent immediately when payment is marked as paid
✅ **Multiple SMS Gateway Support** - Demo mode, SSH (Bangladesh), Twilio, and Custom API
✅ **SMS Preview** - See what the notification message will look like
✅ **Test SMS with Custom Phone** - Enter any phone number and test SMS delivery through your API
✅ **Easy Configuration** - One-click setup in admin dashboard
✅ **Demo Mode** - Test without a real SMS provider (logs to console)
✅ **Real API Testing** - Send actual test SMS through your configured provider

## How It Works

### Flow Diagram
```
Member Makes Payment 
    ↓
Click "Record Payment" / "Mark Payment"
    ↓
App.recordPayment() executes
    ↓
Payment marked as "PAID" in system
    ↓
SMSService.sendPaymentConfirmation() triggered
    ↓
SMS sent to member's phone
    ↓
Success message shown on screen
```

### Success Screen
When a payment is successfully recorded:
- ✅ Green checkmark confirmation
- 📋 Payment details displayed
- 📱 SMS notification status shown
- Message indicating SMS was sent to member's phone

## Configuration

### Admin Dashboard SMS Settings

1. **Enable/Disable SMS Notifications**
   - Checkbox at top of SMS configuration section
   - Enable to activate SMS for all payments

2. **SMS Gateway Type Selection**
   - **Demo Mode** (Default) - Perfect for testing, logs SMS to browser console
   - **SSH** - For Bangladesh market (www.sshclick.com)
   - **Twilio** - International SMS provider (www.twilio.com)
   - **Custom API** - Your own SMS API endpoint

3. **Sender Name**
   - Maximum 11 characters
   - Appears at the beginning of SMS: "MEAT-APP: Your payment received..."
   - Customize with your business name

### Configuration Steps

#### Demo Mode (Testing)
1. Go to Admin Dashboard
2. Scroll to "SMS Notification Configuration"
3. Check "Enable SMS Notifications"
4. Select "Demo Mode (Test/Development)"
5. Click "Send Test SMS to Your Phone"
6. Check browser console (F12) to see logged SMS

#### SSH Integration (Bangladesh) - Recommended for BD
1. Get API key from https://sshclick.com/
2. Go to Admin Dashboard → SMS Configuration
3. Enable SMS Notifications
4. Select "SSH (Bangladesh)"
5. Enter your SSH API Key in "SSH API Key" field
6. Update Sender Name if desired
7. **Enter your phone number in "Test Phone Number"**
8. Click "Send Test SMS" to verify
9. Check your phone for the test SMS

#### Twilio Integration (International)
1. Sign up at https://www.twilio.com/
2. Get Account SID and Auth Token from Twilio Console
3. Go to Admin Dashboard → SMS Configuration
4. Enable SMS Notifications
5. Select "Twilio (International)"
6. Enter Account SID in "Twilio Account SID" field
7. Enter Auth Token in "Twilio Auth Token" field
8. Update Sender Name
9. **Enter your phone number in "Test Phone Number"**
10. Click "Send Test SMS" to verify
11. **Note:** Twilio may show CORS error from browser, but SMS will work fine on production server

#### Custom API Integration
1. Prepare your SMS API endpoint
2. Go to Admin Dashboard → SMS Configuration
3. Enable SMS Notifications
4. Select "Custom API"
5. Enter API Endpoint URL (must accept POST requests)
6. Enter API Key
7. **Enter your phone number in "Test Phone Number"**
8. Click "Send Test SMS" to verify

### API Endpoint Requirements (Custom API)

Your custom API endpoint should accept POST requests with the following JSON body:
```json
{
  "phone": "+8801701234567",
  "message": "Dear John, Your payment of 5000 BDT for May 2024 has been successfully confirmed via Cash.",
  "sender": "MEAT-APP"
}
```

Response should be JSON with:
```json
{
  "success": true,
  "messageId": "unique-message-id"
}
```

## SMS Message Format

The SMS message is automatically generated with:
- Member's name
- Payment amount (BDT)
- Month and year
- Payment method (Cash, Card, Bank Transfer, etc.)
- Sender name (your business name, max 11 chars)

**Example SMS:**
```
Dear John, Your payment of 5000 BDT for May 2024 has been successfully confirmed via Cash. Thank you for your contribution. - MEAT-APP
```

**Character Limit:** ~160 characters (standard SMS)

## Implementation Details

### Files Modified/Created

1. **js/sms.js** (New)
   - Main SMS service module
   - Handles all SMS-related operations
   - Supports multiple gateway integrations
   - Improved error handling and validation

2. **js/app.js** (Modified)
   - `recordPayment()` now triggers SMS
   - Automatically gets member phone and sends SMS
   - Non-blocking async SMS send

3. **dashboard.html** (Modified)
   - Shows SMS status in success screen
   - SMS script included
   - Updated success message display

4. **admin-dashboard.html** (Modified)
   - SMS Configuration UI section with test phone field
   - Configuration functions added
   - Test SMS functionality with custom phone number
   - CORS warning for Twilio
   - Real API testing capability

5. **profile.html** (Modified)
   - SMS script included for consistency

### Phone Number Storage
- Members' phone numbers are stored in user profile
- Required field for SMS to work
- Admin can edit in member management section

### Error Handling
- If members have no phone number, SMS silently skips
- If SMS service is disabled, payment still processes
- SMS failures don't block payment confirmation
- Errors logged to browser console for debugging

## Testing & Troubleshooting

### Test SMS Feature
1. Go to Admin Dashboard
2. Navigate to SMS Configuration section
3. Select your SMS provider (SSH, Twilio, or Custom)
4. Enter API credentials for the provider
5. **Enter your phone number in "Test Phone Number" field**
6. Click "Send Test SMS"
7. Check your phone for SMS (usually arrives within 1-5 seconds)

### Debugging

#### Check Console
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. You'll see SMS logs like:
```
📱 Demo SMS Sent: {
  phone: "+8801701234567",
  message: "Dear...",
  timestamp: "5/17/2024, 10:30:25 AM"
}
```

#### View SMS Logs
In browser console:
```javascript
SMSService.getSMSLogs()  // View all SMS logs
SMSService.clearSMSLogs()  // Clear logs
```

#### Check Configuration
In browser console:
```javascript
SMSService.getConfig()  // See current SMS config
```

### Common Issues

**Issue: Test SMS not sent**
- ✓ Make sure "Enable SMS Notifications" is checked
- ✓ Select an actual provider (not Demo Mode)
- ✓ Enter API credentials for your provider
- ✓ Enter a valid phone number in "Test Phone Number"
- ✓ Check provider account has credits/balance
- ✓ For SSH: verify API key is correct
- ✓ For Twilio: verify Account SID and Auth Token from console

**Issue: Twilio shows CORS error**
- ✓ This is expected from browser due to security restrictions
- ✓ SMS will work fine on production server
- ✓ Try SSH or Custom API if testing with real SMS is needed

**Issue: SSH SMS not received**
- ✓ Verify phone number format (must be valid BD number)
- ✓ Ensure API key is correct at sshclick.com
- ✓ Check account balance on SSH website
- ✓ SMS takes 1-5 seconds to arrive

**Issue: SMS not sending for payments**
- ✓ Check if SMS is enabled in admin dashboard
- ✓ Verify member has phone number in profile
- ✓ Verify SMS provider is configured with API credentials
- ✓ Check SMS provider account status and balance
- ✓ Check browser console for errors

**Issue: SMS contains wrong information**
- ✓ SMS message is auto-generated from payment data
- ✓ Verify payment details before confirming
- ✓ Check member's phone number is correct

## Security Considerations

1. **API Credentials**
   - Stored in browser localStorage
   - Recommended: Use environment variables for production
   - Keep API keys confidential

2. **Phone Numbers**
   - Stored with user profile
   - Used only for SMS notifications
   - Not shared with external services

3. **SMS Logs**
   - Stored in browser localStorage
   - Can be cleared anytime
   - Contains personal phone numbers

## Future Enhancements

Potential additions:
- Scheduled SMS reminders for unpaid contributions
- SMS notifications for collector assignments
- Bulk SMS for announcements
- SMS delivery status tracking
- Two-way SMS (members reply to confirm)
- SMS logs in admin panel with pagination
- Custom message templates per admin

## Support

### For Demo Mode
- Works immediately without any setup
- Perfect for testing
- Logs visible in browser console

### For SMS Providers
- **SSH Support:** https://sshclick.com/docs
- **Twilio Support:** https://www.twilio.com/docs
- **Custom API:** Follow your provider's documentation

### Getting API Credentials
- **SSH:** Register at https://sshclick.com/ → Get API key from dashboard
- **Twilio:** Sign up at https://www.twilio.com/ → Auth credentials in Console

## Disabling SMS

To disable SMS notifications:
1. Go to Admin Dashboard
2. Uncheck "Enable SMS Notifications"
3. SMS will not be sent for future payments
4. Previous SMS logs remain in localStorage

---

**Note:** SMS notifications depend on member phone numbers being present and valid. Ensure members have updated their phone numbers in their profiles for SMS to work properly.

**Tip:** Always test SMS with a real provider before relying on it for production. Use Test Phone Number feature to verify delivery before enabling for all members.
