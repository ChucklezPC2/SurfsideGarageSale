require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const session = require('express-session');


const app = express();
const db = new sqlite3.Database('./garage_sales.db');

/* ==========================
   CONFIG
========================== */
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

/* ==========================
   MIDDLEWARE
========================== */
app.use(express.json());
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));


/* ==========================
   ADMIN AUTH
========================== */
app.post('/api/admin/login', (req, res) => {

  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }

  res.status(401).json({ error: "Invalid credentials" });
});

app.get('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}



/* ==========================
   ADMIN: ALL SUBMISSIONS
========================== */
app.get('/api/submissions', (req, res) => {

  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin login required' });
  }

  db.all("SELECT * FROM submissions", [], (err, rows) => {

    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows);
  });

});

/* ==========================
   SAFE DELETE
========================== */
function safeDelete(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn("Delete failed:", filePath, err);
  }
}

/* ==========================
   DATABASE
========================== */
db.run(`
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT,
  address_normalized TEXT,
  latitude REAL,
  longitude REAL,
  items TEXT,
  photos TEXT,
  participating_days TEXT,
  edit_token TEXT
)
`);

/* ==========================
   STATIC
========================== */

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));


/* ==========================
   MULTER (HASHED FILENAMES)
========================== */
const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      const hash = crypto.randomBytes(16).toString('hex');
      const ext = path.extname(file.originalname);
      cb(null, `${hash}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files allowed'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5
  }
});

/* ==========================
   IMAGE OPTIMIZATION
========================== */
async function optimizeImage(filePath) {

  try {
    const tempPath = filePath + '-tmp.jpg';

    await sharp(filePath)
      .resize({ width: 2000, height: 2000, fit: 'inside' })
      .jpeg({ quality: 90 })
      .toFile(tempPath);

    fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);

  } catch (err) {
    console.error("Image processing error:", err);
    throw err;
  }
}

/* ==========================
   API ROUTES
========================== */

/* ---------- PUBLIC (INDEX) ---------- */
app.get('/api/public-submissions', (req, res) => {
  db.all("SELECT * FROM submissions", [], (err, rows) => {
    res.json(rows);
  });
});

app.get('/api/submissions/by-token', (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  db.get(
    "SELECT * FROM submissions WHERE edit_token = ?",
    [token],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Invalid edit token' });
      }

      res.json(row);
    }
  );
});

/* ==========================
   CREATE
========================== */
app.post('/api/submissions', upload.array('photos'), async (req, res) => {

  try {

const turnstileToken = req.body['cf-turnstile-response'];

if (!turnstileToken) {
  return res.status(400).json({ error: 'Security check required' });
}

const valid = await verifyTurnstile(turnstileToken, req.ip);

if (!valid) {
  return res.status(400).json({ error: 'Security check failed' });
}

    const { addressFull, latitude, longitude, items } = req.body;
    let participatingDays = req.body.participatingDays || [];

    if (!Array.isArray(participatingDays)) {
      participatingDays = [participatingDays];
    }


    if (!addressFull || !latitude || !longitude) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const normalized = addressFull.toLowerCase().replace(/\s+/g, ' ').trim();

    db.get(`
      SELECT * FROM submissions WHERE address_normalized = ?
    `, [normalized], async (err, existing) => {

      if (existing) {
        return res.status(400).json({ error: 'Duplicate location' });
      }

      const photos = [];

      for (const file of req.files || []) {
        await optimizeImage(file.path);
        photos.push(file.path);
      }

      const editToken = generateToken();

      db.run(`
        INSERT INTO submissions
        (address, address_normalized, latitude, longitude, items, photos, participating_days, edit_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        addressFull,
        normalized,
        latitude,
        longitude,
        items || '',
        JSON.stringify(photos),
        JSON.stringify(participatingDays),
        editToken
      ], () => {
        res.json({ success: true, editToken });
      });



    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ==========================
   UPDATE
========================== */
app.put('/api/submissions/:id',
  upload.array('newPhotos'),
  async (req, res) => {

    db.get(
      "SELECT * FROM submissions WHERE id = ?",
      [req.params.id],
      async (err, row) => {

        if (err || !row) {
          return res.status(404).json({ error: 'Not found' });
        }

        const token = req.query.token;

        if (!req.session.isAdmin && row.edit_token !== token) {
          return res.status(403).json({ error: 'Not allowed' });
        }

        const originalPhotos = JSON.parse(row.photos || '[]');
        const keptPhotos = req.body.existingPhotos
          ? Array.isArray(req.body.existingPhotos)
            ? req.body.existingPhotos
            : [req.body.existingPhotos]
          : [];

        const removedPhotos = originalPhotos.filter(p => !keptPhotos.includes(p));
        removedPhotos.forEach(p => safeDelete(p));

        let photos = [...keptPhotos];

        if (photos.length + (req.files?.length || 0) > 5) {
          return res.status(400).json({ error: 'Maximum 5 photos allowed' });
        }

        for (const file of req.files || []) {
          await optimizeImage(file.path);
          photos.push(file.path);
        }

        let participatingDays = req.body.participatingDays || [];
        if (!Array.isArray(participatingDays)) {
          participatingDays = [participatingDays];
        }
        participatingDays = [...new Set(participatingDays)];

        db.run(
          `UPDATE submissions
           SET items = ?, photos = ?, participating_days = ?
           WHERE id = ?`,
          [
            req.body.items || '',
            JSON.stringify(photos),
            JSON.stringify(participatingDays),
            req.params.id
          ],
          () => res.json({ success: true })
        );
      }
    );
});

/* ==========================
   DELETE
========================== */
app.delete('/api/submissions/:id', (req, res) => {
  db.get(
    "SELECT * FROM submissions WHERE id = ?",
    [req.params.id],
    (err, row) => {

      if (err || !row) {
        return res.status(404).json({ error: 'Not found' });
      }

      const token = req.query.token;

      if (!req.session.isAdmin && row.edit_token !== token) {
        return res.status(403).json({ error: 'Not allowed' });
      }

      const photos = JSON.parse(row.photos || '[]');
      photos.forEach(p => safeDelete(p));

      db.run(
        "DELETE FROM submissions WHERE id = ?",
        [req.params.id],
        () => res.json({ success: true })
      );
    }
  );
});

async function verifyTurnstile(token, ip) {
  const formData = new URLSearchParams();
  formData.append('secret', process.env.TURNSTILE_SECRET);
  formData.append('response', token);
  if (ip) formData.append('remoteip', ip);

  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    }
  );

  const data = await res.json();
  return data.success === true;
}

/* ==========================
   START
========================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});