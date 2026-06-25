// Admin-specific routes and functions for the API

// Function to check if user is admin
function isAdmin(user) {
  return user && user.role === 'admin';
}

// Function to set user role (only admins can do this)
async function setUserRole(req, res, usersCollection, verifySession, requireRole) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }

    const validRoles = ['user', 'lawyer', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    try {
      const { ObjectId } = await import('mongodb');
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
  };
}

// Function to block/unblock user (only admins can do this)
async function toggleUserBlock(req, res, usersCollection) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isBlocked } = req.body;

  if (!userId || isBlocked === undefined) {
    return res.status(400).json({ error: 'userId and isBlocked are required' });
  }

  try {
    const { ObjectId } = await import('mongodb');
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
}

// Function to get admin statistics
async function getAdminStats(req, res, database) {
  try {
    const usersCollection = database.collection('user');
    const servicesCollection = database.collection('new-service');

    const totalUsers = await usersCollection.countDocuments();
    const totalLawyers = await usersCollection.countDocuments({ role: 'lawyer' });
    const totalAdmins = await usersCollection.countDocuments({ role: 'admin' });
    const blockedUsers = await usersCollection.countDocuments({ isBlocked: true });
    const totalServices = await servicesCollection.countDocuments();

    res.json({
      totalUsers,
      totalLawyers,
      totalAdmins,
      blockedUsers,
      totalServices,
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  isAdmin,
  setUserRole,
  toggleUserBlock,
  getAdminStats,
};
