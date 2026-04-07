# AIDock — Your AI Tools Dashboard

Save, organize, and share your favorite AI tools. Discover what tools others are using.

## 🚀 Quick Start (Local Development)

```bash
npm install
npm run dev:local
```

Visit http://localhost:3000

## 📦 Deployment to Vercel + Turso

### Step 1: Create a Turso Database (Free)

1. Sign up at https://turso.tech (free tier includes 500 databases, 9GB storage)
2. Install Turso CLI:
   ```bash
   # macOS/Linux
   curl -sSfL https://get.tur.so/install.sh | bash
   
   # Windows (PowerShell)
   irm https://get.tur.so/install.ps1 | iex
   ```
3. Login to Turso:
   ```bash
   turso auth login
   ```
4. Create a database:
   ```bash
   turso db create aidock
   ```
5. Get your database URL:
   ```bash
   turso db show aidock --url
   ```
   Example: `libsql://aidock-yourusername.turso.io`

6. Create an auth token:
   ```bash
   turso db tokens create aidock
   ```

### Step 2: Deploy to Vercel

1. Push your code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/aidock.git
   git push -u origin main
   ```

2. Go to https://vercel.com and import your GitHub repository

3. Add Environment Variables in Vercel project settings:
   - `TURSO_DATABASE_URL` → Your Turso database URL (from step 5)
   - `TURSO_AUTH_TOKEN` → Your Turso auth token (from step 6)
   - `JWT_SECRET` → A random 64-character string (generate with: `openssl rand -hex 32`)

4. Deploy! Vercel will automatically build and deploy.

### Step 3: Update Chrome Extension

After deployment, update the extension to point to your live URL:

1. Open `extension/popup.js`
2. Find `API_BASE` and update it:
   ```javascript
   const API_BASE = 'https://your-app.vercel.app';
   ```
3. Reload the extension in Chrome

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TURSO_DATABASE_URL` | Turso database URL | Production only |
| `TURSO_AUTH_TOKEN` | Turso auth token | Production only |
| `JWT_SECRET` | Secret for JWT tokens | Recommended |
| `USE_LOCAL_DB` | Set to `true` for local SQLite | Development only |

## 📁 Project Structure

```
aidock/
├── server.js           # Express API server
├── public/             # Static frontend files
│   ├── index.html      # Landing page
│   ├── auth.html       # Login/signup
│   ├── dashboard.html  # Main app
│   ├── shared-stack.html
│   ├── invite.html
│   ├── css/
│   └── js/
├── extension/          # Chrome extension
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── vercel.json         # Vercel config
└── package.json
```

## 🔌 Chrome Extension

To install the extension locally:

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension` folder

For production:
1. Update `API_BASE` in `popup.js` to your Vercel URL
2. Create a .zip of the extension folder
3. Submit to Chrome Web Store

## 📝 License

MIT
