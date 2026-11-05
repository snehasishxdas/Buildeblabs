# Buildedlabs website

The site runs through an Express server. Project applications and contact messages are validated and saved to MongoDB. The private owner inbox is available at `/admin`.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD_HASH`.
3. Configure SMTP as described below.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the owner panel.

Never commit `.env`. It is excluded by `.gitignore`; `.env.example` contains variable names only.

## Admin password

`ADMIN_PASSWORD_HASH` uses a salted scrypt hash in this format: `scrypt$<base64-salt>$<base64-hash>`. Generate one without saving the clear-text password:

```powershell
$password = Read-Host "Admin password" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $password).Password
$env:ADMIN_PASSWORD = $plain
$hashLine = node -e "const c=require('node:crypto'); const s=c.randomBytes(16); const h=c.scryptSync(process.env.ADMIN_PASSWORD,s,64); process.stdout.write('ADMIN_PASSWORD_HASH=scrypt$'+s.toString('base64')+'$'+h.toString('base64'))"
$lines = Get-Content .env
$updated = foreach ($line in $lines) { if ($line.StartsWith('ADMIN_PASSWORD_HASH=')) { $hashLine } else { $line } }
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), [string[]]$updated, [System.Text.UTF8Encoding]::new($false))
Remove-Item Env:ADMIN_PASSWORD
$plain = $null
$hashLine = $null
```

Set `ADMIN_USERNAME` in `.env` to the username you want to use.

## SMTP

Set these server-only variables in `.env`:

- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE`
- `SMTP_USER` and `SMTP_PASSWORD` (use a provider app password where supported)
- `SMTP_FROM` (a sender address verified by your provider)
- `OWNER_EMAIL` (the reply-to address)

For the Gmail sender configured in the local `.env`, use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, and a Google App Password in `SMTP_PASSWORD`. Gmail requires 2-Step Verification before an App Password can be created. Do not use your regular Google account password.

The reply button records the reply in the application and sends it to the applicant using SMTP. If delivery fails, the panel shows an error and the reply remains marked failed. SMTP is deliberately disabled until valid settings are configured.

## Data and deployment

Applications, contact messages and attached files are stored in the `buildedlabs` MongoDB database by default. Attachments are limited to 10 MB and are only downloadable after admin authentication. Deploy behind HTTPS and set `NODE_ENV=production` so the admin session cookie is Secure. Session tokens are held in server memory and expire after 12 hours; restarting the server signs out the admin.
