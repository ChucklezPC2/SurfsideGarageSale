# Surfside Garage Sale Map

Community map for the Surfside garage sale event. Sellers submit listings with photos and participating days; visitors browse listings on an interactive map.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
```

Create a `.env` file:

```
PORT=3000
SESSION_SECRET=your-random-secret
ADMIN_USER=admin
ADMIN_PASS=your-admin-password
TURNSTILE_SECRET=your-cloudflare-turnstile-secret
```

## Run

```bash
npm start
```

Open `http://localhost:3000` for the public map. Sellers use **Submit/Manage Listing**; each new listing returns a bookmarkable edit URL with a secret token. Admins use `/admin.html` with the credentials from `.env`.

## Project layout

- `server.js` — Express API, SQLite, image uploads
- `garage_sales.db` — SQLite database (created at runtime)
- `uploads/` — Listing photos
- `public/` — Static HTML/CSS/JS frontend
