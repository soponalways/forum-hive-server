// ✅ Load Dependencies
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

// ✅ Setup Express
const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

// ✅ MongoDB Connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

// ✅ Declare userCollection globally
let userCollection;

async function run() {
    try {
        await client.connect();
        const db = client.db("forumHiveDB");
        userCollection = db.collection("users");

        console.log("✅ MongoDB connected");

        // 👉 Check if username exists
        app.get('/users/check-username/:username', async (req, res) => {
            const username = req.params.username;
            const user = await userCollection.findOne({ username });
            res.send({ exists: !!user });
        });

        // 👉 Save new user
        app.post('/users', async (req, res) => {
            const userData = req.body;
            const emailExists = await userCollection.findOne({ email: userData?.email });
 
            // Check if username already exists
            const usernameExists = await userCollection.findOne({ username: userData?.username });
            if (usernameExists) {   
                return res.status(409).send({ error: 'Username already exists' });
            }

            if (emailExists) {
                try {
                    const updatedUserDoc = {
                        $set: {
                            lastSignIn: new Date().toISOString(),
                            lastSignInIp: req.ip,
                        }
                    };
                    await userCollection.updateOne({ email: userData.email }, updatedUserDoc);
                } catch (error) {
                    console.error('Error checking email existence:', error);
                    
                }
                return res.status(200).send({ message : 'Email already exists' });
            } else {
                try {
                    const newUserData = {
                        ...userData,
                        lastSignInIp: req.ip,
                    }
                    const result = await userCollection.insertOne(newUserData);
                    res.status(201).send({ message: 'User saved successfully', insertedId: result.insertedId });
                } catch (err) {
                    res.status(500).send({ error: 'Failed to save user', detail: err.message });
                }
            }
        });

        // Root route
        app.get('/', (req, res) => {
            res.send('ForumHive server is running');
        });

        app.listen(port, () => {
            console.log(`🚀 Server is running on port ${port}  http://localhost:${port}`);
        });
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
    }
}

run();
