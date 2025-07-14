// ✅ Load Dependencies
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// ✅ Setup Express
const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
// Enable CORS for specific origins and methods
app.use(cors({
    origin: ['http://localhost:5173', 'https://forum-hive-server.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json());
app.use(cookieParser());

// Coustome middleware 
const verifyJWT = (req, res, next) => {
    const token = req.cookies['jwtToken'];
    console.log('JWT Token:', token);
    if (!token) return res.status(401).send({ message: 'Unauthorized access' });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).send({ message: 'Forbidden' });
        req.decoded = decoded;
        console.log('Decoded JWT:', decoded);
        next();
    });
};


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
let postCollection;

async function run() {
    try {
        await client.connect();
        const db = client.db("forumHiveDB");
        userCollection = db.collection("users");
        postCollection = db.collection("posts");

        console.log("✅ MongoDB connected");

        // 👉 Token Generation
        app.post('/auth/set-cookie', (req, res) => {
            const user = req.body; 
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });

            res
                .cookie('jwtToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production', // true on live
                    sameSite: 'strict',
                    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                })
                .send({ success: true });
        });

        app.post('/auth/clear-cookies', (req, res) => {
            res
                .clearCookie('jwtToken', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                })
                .send({ success: true });
        });

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

        // Post realted route 

        // GET /posts/user/:email/count
        app.get('/posts/user/:email/count', verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const email = req.params.email;

            if (decodedEmail !== email) {
                return res.status(403).send({ message: 'Forbidden: email mismatch' });
            }

            const count = await postCollection.countDocuments({ authorEmail: email });
            res.send({ count });
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
