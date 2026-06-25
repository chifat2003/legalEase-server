const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const adminRoutes = require('./admin-routes');

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

    // ── ADMIN routes ────────────────────────────────────────────────────────

    // Get admin statistics
    app.get('/api/admin/stats', verifySession, requireRole('admin'), async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalLawyers = await usersCollection.countDocuments({ role: 'lawyer' });
        const totalAdmins = await usersCollection.countDocuments({ role: 'admin' });
        const blockedUsers = await usersCollection.countDocuments({ isBlocked: true });
        const totalServices = await addNewService.countDocuments();

        // Get transactions stats
        const transactionsCollection = database.collection('transactions');
        const transactionStats = await transactionsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalRevenue: { $sum: '$amount' },
              },
            },
          ])
          .toArray();

        const totalTransactions = transactionStats[0]?.totalTransactions || 0;
        const totalRevenue = transactionStats[0]?.totalRevenue || 0;

        res.json({
          totalUsers,
          totalLawyers,
          totalAdmins,
          blockedUsers,
          totalServices,
          totalTransactions,
          totalRevenue,
        });
      } catch (err) {
        console.error('Error fetching admin stats:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Set user role (admin only)
    app.post('/api/admin/set-role', verifySession, requireRole('admin'), async (req, res) => {
      const { userId, role } = req.body;

      if (!userId || !role) {
        return res.status(400).json({ error: 'userId and role are required' });
      }

      const validRoles = ['user', 'lawyer', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, message: `User role updated to ${role}` });
      } catch (err) {
        console.error('Error updating user role:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Block/Unblock user (admin only)
    app.post('/api/admin/toggle-block', verifySession, requireRole('admin'), async (req, res) => {
      const { userId, isBlocked } = req.body;

      if (!userId || isBlocked === undefined) {
        return res.status(400).json({ error: 'userId and isBlocked are required' });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isBlocked } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        res.json({ 
          success: true, 
          message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully` 
        });
      } catch (err) {
        console.error('Error updating user block status:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get all users (admin only)
    app.get('/api/admin/users', verifySession, requireRole('admin'), async (req, res) => {
      try {
        const users = await usersCollection.find({}, { projection: { password: 0 } }).toArray();
        res.json(users);
      } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get all transactions (admin only)
    app.get('/api/admin/transactions', verifySession, requireRole('admin'), async (req, res) => {
      try {
        const transactionsCollection = database.collection('transactions');
        const transactions = await transactionsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        const serialized = transactions.map((t) => ({
          id: t._id.toString(),
          hiringId: t.hiringId,
          stripePaymentIntentId: t.stripePaymentIntentId,
          userId: t.userId,
          userEmail: t.userEmail,
          lawyerId: t.lawyerId,
          lawyerEmail: t.lawyerEmail,
          lawyerName: t.lawyerName,
          amount: t.amount,
          currency: t.currency || 'usd',
          serviceName: t.serviceName,
          specialization: t.specialization,
          status: t.status,
          createdAt: t.createdAt?.toISOString?.() || t.createdAt,
        }));

        res.json(serialized);
      } catch (err) {
        console.error('Error fetching transactions:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
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