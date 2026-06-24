const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); // ✅ added ObjectId

require('dotenv').config();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const database = client.db("assignment-10-db");
    const addNewService = database.collection("new-service");
    const usersCollection = database.collection("user");

    // ----- SERVICES -----
    app.post('/api/add-new-service', async (req, res) => {
      const newService = req.body;
      const result = await addNewService.insertOne(newService);
      res.send(result);
    });

    app.get('/api/services', async (req, res) => {
      const result = await addNewService.find().toArray();
      res.send(result);
    });

    app.delete('/api/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }; 
      const result = await addNewService.deleteOne(query);
      res.send(result);
    });

    // ----- USERS -----
    app.get('/api/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
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
  console.log(`Example app listening on port ${port}`);
});