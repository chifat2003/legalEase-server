const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require('dotenv').config();

// ── CORS: allow credentials so the session cookie is forwarded ─────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('LegalEase API is running!');
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// ── Auth middleware ─────────────────────────────────────────────────────────
// Verifies the better-auth session by calling the Next.js auth API.
// Attaches req.user on success, returns 401 on failure.
async function verifySession(req, res, next) {
  const cookieHeader = req.headers['cookie'] || '';
  const sessionTokenMatch =
    cookieHeader.match(/better-auth\.session_token=([^;]+)/) ||
    cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/);

  if (!sessionTokenMatch) {
    return res.status(401).json({ error: 'Unauthorized — no session cookie' });
  }

  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resp = await fetch(`${frontendUrl}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
    });

    if (!resp.ok) {
      return res.status(401).json({ error: 'Unauthorized — session invalid' });
    }

    const session = await resp.json();

    if (!session?.user) {
      return res.status(401).json({ error: 'Unauthorized — no user in session' });
    }

    req.user = session.user;
    next();
  } catch (err) {
    console.error('Session verification error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// Role-based middleware helpers
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden — requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

async function run() {
  try {
    await client.connect();

    const database = client.db("assignment-10-db");
    const addNewService = database.collection("new-service");
    const usersCollection = database.collection("user");

    // ── PUBLIC routes ───────────────────────────────────────────────────────

    // Anyone can browse services and lawyers
    app.get('/api/services', async (req, res) => {
      const result = await addNewService.find().toArray();
      res.send(result);
    });

    // Anyone can see users list (for browsing lawyers on the public page)
    app.get('/api/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // ── PROTECTED routes — must be authenticated ────────────────────────────

    // Only lawyers can add a service
    app.post('/api/add-new-service', verifySession, requireRole('lawyer', 'admin'), async (req, res) => {
      const newService = req.body;
      const result = await addNewService.insertOne(newService);
      res.send(result);
    });

    // Only admins or the owning lawyer can delete a service
    app.delete('/api/services/:id', verifySession, requireRole('admin', 'lawyer'), async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await addNewService.deleteOne(query);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`LegalEase API listening on port ${port}`);
});