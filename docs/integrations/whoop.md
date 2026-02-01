# Whoop Integration Setup

This guide walks through connecting your Whoop account to IronClaude.

## Prerequisites

- A Whoop account with an active membership
- Whoop developer access (see below)

## Step 1: Create a Whoop Developer Application

1. Go to **https://developer-dashboard.whoop.com**
2. Sign in with your Whoop account
3. Click **"Create New Application"**

4. Fill in the application details:
   | Field | Value |
   |-------|-------|
   | App Name | `IronClaude` (or your preferred name) |
   | Description | Personal fitness coaching bot |
   | Redirect URI | `https://your-app.fly.dev/api/integrations/whoop/callback` |
   | Logo | Optional |

5. Select the required **OAuth Scopes**:
   - `read:recovery` - Recovery scores, HRV, resting heart rate
   - `read:sleep` - Sleep duration, stages, sleep score
   - `read:workout` - Workout strain, heart rate, duration
   - `read:profile` - Basic profile info (for user ID verification)

6. Save the application and copy:
   - **Client ID**
   - **Client Secret**

## Step 2: Configure Webhooks (Recommended)

Webhooks automatically sync your data as it becomes available.

1. In your app settings, find the **Webhooks** section
2. Set the webhook URL:
   ```
   https://your-app.fly.dev/api/integrations/whoop/webhook
   ```
3. Generate a **Webhook Secret** and copy it
4. Enable these webhook events:
   - `sleep.created`
   - `sleep.updated`
   - `recovery.created`
   - `recovery.updated`
   - `workout.created`
   - `workout.updated`

## Step 3: Add Credentials to IronClaude

### For Local Development

Add to your `.env` file:
```bash
WHOOP_CLIENT_ID=your_client_id
WHOOP_CLIENT_SECRET=your_client_secret
WHOOP_WEBHOOK_SECRET=your_webhook_secret
```

### For Production (Fly.io)

```bash
~/.fly/bin/fly secrets set \
  WHOOP_CLIENT_ID=your_client_id \
  WHOOP_CLIENT_SECRET=your_client_secret \
  WHOOP_WEBHOOK_SECRET=your_webhook_secret
```

## Step 4: Authorize Your Account

Run the interactive setup wizard:

```bash
npm run setup:whoop
```

The wizard will:
1. Verify your credentials are configured
2. Generate an authorization URL
3. Open your browser to approve access
4. Exchange the authorization code for tokens
5. Verify the connection by fetching your profile
6. Save the tokens

### Manual Token Setup

If the wizard doesn't work, you can manually:

1. Visit the authorization URL:
   ```
   https://api.prod.whoop.com/oauth/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&response_type=code&scope=read:recovery%20read:sleep%20read:workout%20read:profile
   ```

2. Approve access and copy the `code` parameter from the redirect URL

3. Exchange the code for tokens (the setup wizard handles this)

## Step 5: Verify the Integration

### Check Connection Status

```bash
# Local
curl http://localhost:3000/api/integrations/whoop/status

# Production
curl https://your-app.fly.dev/api/integrations/whoop/status
```

### Manual Data Sync

Trigger a sync for a specific date:

```bash
curl -X POST "https://your-app.fly.dev/api/integrations/sync?date=2026-01-31" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Check the Data

Look for your data in the fitness-data repo:
```
weeks/2026-W05/2026-01-31.md
```

The frontmatter should contain:
```yaml
---
date: "2026-01-31"
whoop:
  recovery:
    score: 78
    hrv: 45.2
    restingHeartRate: 52
  sleep:
    durationMinutes: 420
    score: 85
---
```

## How Data Flows

1. **Webhooks** (real-time): Whoop sends events when you complete sleep/workouts
2. **Manual sync** (on-demand): Call the `/api/integrations/sync` endpoint
3. **Storage**: Data is added to the workout file's frontmatter for that date

## Troubleshooting

### "Whoop OAuth not configured"
- Verify `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` are set
- Check for typos or extra whitespace

### "No tokens to refresh"
- Run `npm run setup:whoop` to complete the OAuth flow
- Tokens may have expired - re-authorize

### Webhooks not arriving
- Verify the webhook URL is correct and publicly accessible
- Check that `WHOOP_WEBHOOK_SECRET` matches what's in the Whoop dashboard
- Check Fly.io logs: `~/.fly/bin/fly logs`

### "User ID mismatch" in webhook logs
- Set `WHOOP_USER_ID` to your Whoop user ID (found in profile API response)
- This is optional but adds security by rejecting webhooks for other users

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `WHOOP_CLIENT_ID` | Yes | OAuth client ID from developer dashboard |
| `WHOOP_CLIENT_SECRET` | Yes | OAuth client secret |
| `WHOOP_WEBHOOK_SECRET` | Recommended | Secret for verifying webhook signatures |
| `WHOOP_ACCESS_TOKEN` | Auto | Set by setup wizard, refreshed automatically |
| `WHOOP_REFRESH_TOKEN` | Auto | Set by setup wizard |
| `WHOOP_TOKEN_EXPIRES` | Auto | Token expiration timestamp |
| `WHOOP_USER_ID` | Optional | Your Whoop user ID for webhook verification |
| `WHOOP_TOKEN_FILE` | Optional | Path to store refreshed tokens (default: `/data/whoop-tokens.json`) |

## Resources

- [Whoop Developer Dashboard](https://developer-dashboard.whoop.com)
- [Whoop API Documentation](https://developer.whoop.com/docs)
- [OAuth 2.0 Guide](https://developer.whoop.com/docs/developing/oauth)
- [Webhooks Guide](https://developer.whoop.com/docs/developing/webhooks)
