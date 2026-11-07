# Buildedlabs website

The site runs through an Express server. Project applications and contact messages are validated and saved to MongoDB. The private owner inbox is available at `/admin`.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD_HASH`.
3. Configure SMTP as described below.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the owner panel.

Never commit `.env`. It is excluded by `.gitignore`; `.env.example` contains variable names only.

## Deploy to Vercel

1. Import this GitHub repository into Vercel and deploy it as an Express app. Keep the project root as the Root Directory; `vercel.json` includes the HTML, CSS, JavaScript and favicon files used by the Express function.
2. Add the required environment variables in **Project Settings → Environment Variables**:
   - `MONGODB_URI`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH`
3. Add `MONGODB_DB` if you want a database name other than `buildedlabs`. Add the SMTP variables below if the admin panel should send email.
4. Make sure your MongoDB Atlas network access rules allow connections from your Vercel deployment. Use Vercel static egress when available; avoid opening the database to all IP addresses.
5. Redeploy after setting or changing environment variables. Once deployed, the public site is at `/` and the owner panel is at `/admin`.

Vercel sets `NODE_ENV=production` for production deployments, which enables the Secure admin cookie. The app connects to MongoDB lazily and reuses a client within each warm function instance. Admin sessions and API rate limits are stored in MongoDB so they work across serverless instances; admin sessions expire after 12 hours. Monitor MongoDB Atlas connection usage as Vercel scales function instances.

Vercel Functions limit request payloads, so application attachments are limited to 4 MB (including multipart request overhead) and remain stored in MongoDB. Larger uploads require direct-to-object-storage uploads.

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

Applications, contact messages, admin sessions and attached files are stored in the `buildedlabs` MongoDB database by default. Attachments are only downloadable after admin authentication. Deploy behind HTTPS so the admin session cookie is Secure.
