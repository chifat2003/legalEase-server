const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// -- CORS ---------------------------------------------------------------------
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((u) => u.trim()).filter(Boolean)
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

// -- MongoDB (lazy singleton) --------------------------------------------------
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let isConnected = false;
async function getDb() {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
  }
  return client.db("assignment-10-db");
}

// -- Auth middleware -----------------------------------------------------------
async function verifySession(req, res, next) {
  const cookieHeader = req.headers["cookie"] || "";
  const sessionTokenMatch =
    cookieHeader.match(/better-auth\.session_token=([^;]+)/) ||
    cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/);

  if (!sessionTokenMatch) {
    return res.status(401).json({ error: "Unauthorized - no session cookie" });
  }

  if (allowedOrigins.length === 0) {
    return res.status(500).json({ error: "Server misconfiguration - FRONTEND_URL is not set" });
  }

  let session = null;
  let lastError = null;

  for (const frontendUrl of allowedOrigins) {
    try {
      const resp = await fetch(`${frontendUrl}/api/auth/get-session`, {
        headers: { cookie: cookieHeader },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.user) { session = data; break; }
    } catch (err) {
      lastError = err;
    }
  }

  if (!session?.user) {
    if (lastError) console.error("Session verification error:", lastError);
    return res.status(401).json({ error: "Unauthorized - session invalid" });
  }

  req.user = session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden - requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

// -- PUBLIC routes -------------------------------------------------------------
app.get("/", (req, res) => res.send("LegalEase API is running!"));

app.get("/api/users", async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection("user").find().toArray();
    res.send(result);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/services", async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection("new-service").find().toArray();
    res.send(result);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -- PROTECTED routes ----------------------------------------------------------
app.post("/api/add-new-service", verifySession, requireRole("lawyer", "admin"), async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection("new-service").insertOne(req.body);
    res.send(result);
  } catch (err) {
    console.error("Error adding service:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/services/:id", verifySession, requireRole("admin", "lawyer"), async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection("new-service").deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch (err) {
    console.error("Error deleting service:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -- ADMIN routes --------------------------------------------------------------
app.get("/api/admin/stats", verifySession, requireRole("admin"), async (req, res) => {
  try {
    const db = await getDb();
    const usersCollection = db.collection("user");
    const transactionsCollection = db.collection("transactions");

    const [totalUsers, totalLawyers, totalAdmins, blockedUsers, totalServices, transactionStats] =
      await Promise.all([
        usersCollection.countDocuments(),
        usersCollection.countDocuments({ role: "lawyer" }),
        usersCollection.countDocuments({ role: "admin" }),
        usersCollection.countDocuments({ isBlocked: true }),
        db.collection("new-service").countDocuments(),
        transactionsCollection.aggregate([{ $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenue: { $sum: "$amount" } } }]).toArray(),
      ]);

    res.json({
      totalUsers,
      totalLawyers,
      totalAdmins,
      blockedUsers,
      totalServices,
      totalTransactions: transactionStats[0]?.totalTransactions || 0,
      totalRevenue: transactionStats[0]?.totalRevenue || 0,
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/set-role", verifySession, requireRole("admin"), async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return res.status(400).json({ error: "userId and role are required" });
  const validRoles = ["user", "lawyer", "admin"];
  if (!validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });
  try {
    const db = await getDb();
    const result = await db.collection("user").updateOne({ _id: new ObjectId(userId) }, { $set: { role } });
    if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (err) {
    console.error("Error updating user role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/toggle-block", verifySession, requireRole("admin"), async (req, res) => {
  const { userId, isBlocked } = req.body;
  if (!userId || isBlocked === undefined) return res.status(400).json({ error: "userId and isBlocked are required" });
  try {
    const db = await getDb();
    const result = await db.collection("user").updateOne({ _id: new ObjectId(userId) }, { $set: { isBlocked } });
    if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, message: `User ${isBlocked ? "blocked" : "unblocked"} successfully` });
  } catch (err) {
    console.error("Error updating user block status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/users", verifySession, requireRole("admin"), async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.collection("user").find({}, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/transactions", verifySession, requireRole("admin"), async (req, res) => {
  try {
    const db = await getDb();
    const transactions = await db.collection("transactions").find({}).sort({ createdAt: -1 }).toArray();
    res.json(transactions.map((t) => ({
      id: t._id.toString(),
      hiringId: t.hiringId,
      stripePaymentIntentId: t.stripePaymentIntentId,
      userId: t.userId,
      userEmail: t.userEmail,
      lawyerId: t.lawyerId,
      lawyerEmail: t.lawyerEmail,
      lawyerName: t.lawyerName,
      amount: t.amount,
      currency: t.currency || "usd",
      serviceName: t.serviceName,
      specialization: t.specialization,
      status: t.status,
      createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    })));
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => console.log(`LegalEase API listening on port ${port}`));

module.exports = app;
