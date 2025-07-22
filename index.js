// ✅ Load Dependencies
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRETE); 

// ✅ Setup Express
const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
// Enable CORS for specific origins and methods
app.use(cors({
    origin: ['http://localhost:5173', 'https://forumhive.web.app'],
    credentials: true,
    // methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json());
app.use(cookieParser());

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
let commentsCollection; 
let paymentCollection; 
let reportsCollection;

async function run() {
    try {
        // await client.connect();
        const db = client.db("forumHiveDB");
        userCollection = db.collection("users");
        postCollection = db.collection("posts");
        commentsCollection = db.collection('comments');
        paymentCollection = db.collection('payments');
        reportsCollection= db.collection('reports')

        console.log("✅ MongoDB connected");

        // Coustome middleware 
        const verifyJWT = (req, res, next) => {
            const token = req.cookies.jwtToken
            if (!token) return res.status(401).send({ message: 'Unauthorized access' });

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) return res.status(403).send({ message: 'Forbidden' });
                req.decoded = decoded;
                next();
            });
        };

        const verifyAdmin = async (req, res, next) => {
            try {
                const email = req.decoded?.email;
                if (!email) {
                    return res.status(401).json({ message: 'Unauthorized access' });
                }

                const user = await userCollection.findOne({ email });

                if (!user || user.role !== 'admin') {
                    return res.status(403).json({ message: 'Admin access only' });
                }

                next();
            } catch (err) {
                console.error('Admin check failed:', err.message);
                res.status(500).json({ message: 'Internal server error' });
            }
        }

        // 👉 Token Generation
        app.post('/auth/set-cookie', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });

            res
                .cookie('jwtToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production', // true on live
                    sameSite: 'none',
                    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                })
                .send({ success: true });
        });

        app.post('/auth/clear-cookies', (req, res) => {
            res
                .clearCookie('jwtToken', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'none',
                })
                .send({ success: true });
        });

        // 👉 Check if username exists
        app.get('/users/check-username/:username', async (req, res) => {
            const username = req.params.username;
            const user = await userCollection.findOne({ username });
            res.send({ exists: !!user });
        });

        // Get single Post By PostId 
        app.get('/post/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const post = await postCollection.findOne({ _id: new ObjectId(id) });

                if (!post) {
                    return res.status(404).send({ message: 'Post not found' });
                }
                res.send(post)
            } catch (error) {
                res.status(500).send({ message: 'Internal Server Error', error: error.message });
            }
        })
        
        // Get all Posts
        app.get('/posts', async (req, res) => {
            const { sortBy, order, current, limit:limitStr } = req.query;
            const skip = parseInt(current) * 5; 
            const limit = parseInt(limitStr) 
            
            // if user is send sort data then it will sort by there given data . 
            if (sortBy === 'popularity') {
                const posts = await postCollection.aggregate([
                    {
                        $addFields: {
                            voteDifference: { $subtract: ["$upVote", "$downVote"] }
                        }
                    },
                    {
                        $sort: { voteDifference: order === 'asc' ? 1 : -1 }
                    }, 
                ])
                .skip(skip)
                .limit(limit)
                .toArray(); 
                return res.send(posts);
            } else if (sortBy === 'date') {
                const posts = await postCollection.aggregate([
                    {
                        $sort: { createdAt: order === 'asc' ? 1 : -1 }
                    }
                ])
                    .skip(skip)
                    .limit(limit)
                    .toArray(); 
                
                return res.send(posts);
            }            
            // Default case: sort by createdAt in descending order
            const posts = await postCollection.find().sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
            res.send(posts);
        });

        app.get('/posts/count', async (req, res) => {
            
            try {
                const count = await postCollection.countDocuments();
                res.send({ count });
            } catch (error) {
                res.status(500).send({ error: 'Failed to get post count' });
            }
        })

        app.get('/posts/search', async (req, res) => {
            const { tag, limit: limitStr, current } = req.query;
            const tagSpecial = tag?.trim();
            const skip = parseInt(current) * 5;
            const limit = parseInt(limitStr) 
            try {
                const posts = await postCollection
                    .find({ tag: { $regex: new RegExp(`${tagSpecial}`, 'i') } })
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json(posts);
            } catch (error) {
                console.error('Search Error:', error);
                res.status(500).json({ message: 'Failed to fetch search results' });
            }
        });

        // Comments 
        app.get('/comment/:postId', async (req, res) => {
            const {postId} = req.params; 
            const query = {postId : new ObjectId(postId)}; 
            const cursor = await commentsCollection.find(query);
            const comments = await cursor
                .sort({ createdAt : -1})
            .toArray(); 

            res.send(comments)
        })
        app.post('/post/comment', async (req, res) => {
            const { postId:postIdStr , ...restData} = req.body; 
            const postId = new ObjectId(postIdStr); 
            const createdAt = new Date
            const commentData = {
                postId,
                ...restData, 
                createdAt
            }
            const result = await commentsCollection.insertOne(commentData); 
            res.status(201).send(result); 
        })

        // LIke Post 
        app.patch('/post/vote/:postId', async (req, res) => {
            const {postId} = req.params; 
            const {type} = req.body; 
            const query = {_id : new ObjectId(postId)}
            if(type === 'up') {
                const data = {
                    $inc : {upVote: 1}
                }
                 const result = await postCollection.updateOne(query, data)
                 return res.send(result)
            }
            if(type === 'down') {
                const data = {
                    $inc: { downVote: 1 }
                }
                const result = await postCollection.updateOne(query, data)
                return res.send(result)
            }
        })
        
        // 👉 Save new user
        app.post('/users', async (req, res) => {
            const userData = req.body;
            const emailExists = await userCollection.findOne({ email: userData?.email });

            // Check if username already exists
            const usernameExists = await userCollection.findOne({ username: userData?.username });
            if (!emailExists && usernameExists) {
                return res.status(200).send({ error: 'Username already exists' });
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
                return res.status(200).send({ message: 'Email already exists' });
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

        // GET /posts/user/:email
        app.get('/posts/user/:email', verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const email = req.params.email;
            let limit = req.query.limit; 
            limit = parseInt(limit)
            
            if (decodedEmail !== email) {
                return res.status(403).send({ message: 'Forbidden: email mismatch' });
            }; 

            if(limit) {
                const posts = await postCollection.find({ authorEmail: email }).limit(limit).sort({ createdAt : -1}).toArray();
                return res.send(posts)
            }

            const posts = await postCollection.find({ authorEmail: email }).toArray();
            res.send(posts);
        }); 

        app.get('/user/:email', async (req, res) => {
            const {email} = req.params; 
            const user = await userCollection.findOne({email}); 
            res.send(user)
        })
        // POST /posts
        app.post('/posts', verifyJWT, async (req, res) => {
            const postData = req.body;
            const decodedEmail = req.decoded.email;

            if (decodedEmail !== postData.authorEmail) {
                return res.status(403).send({ message: 'Forbidden: email mismatch' });
            }

            // Check post limit
            const postCount = await postCollection.countDocuments({ authorEmail: decodedEmail });

            const member = await userCollection.findOne({ email: decodedEmail });
            if (!member) {
                return res.status(403).send({ message: 'Forbidden: user not found' });
            }
            if (member.memberShip === 'member') {
                if (postCount > 10) {
                    return res.status(403).send({ message: 'Post limit exceeded' });
                }
            } else if (member.memberShip === 'non-member') {
                if (postCount > 5) {
                    return res.status(403).send({ message: 'Post limit exceeded' });
                }
            }

            const result = await postCollection.insertOne(postData);
            const updatedDoc = {
                $inc: { postLimit: -1 }
            }
            await userCollection.updateOne({ email: decodedEmail }, updatedDoc);
            res.send(result);
        });

        // Reports related api 
        app.get('/report/:id', async (req, res) => {
            const {id} = req.params;
            const query = { commentId: new ObjectId(id)}; 
            const result = await reportsCollection.findOne(query)
            res.send(result)
        }); 

        app.get('/reports',verifyJWT, verifyAdmin, async (req, res) => {
            const cursor = await reportsCollection.find(); 
            const result = await cursor.sort({createdAt: -1}).toArray(); 
            res.send(result); 
        })
        app.post('/reports', async (req, res) => {
            const { commentId, ...restReportsData } = req.body;
            const reportsData = {
                ...restReportsData, 
                commentId: new ObjectId(commentId)
            } 
            const query = { commentId : reportsData.commentId}; 
            const existingCommentReport = await reportsCollection.findOne(query); 
            if(existingCommentReport) {
                return res.send({message : "Report allready have on this comment"}); 
            }
            if(!reportsData) {
                return res.send({message : "Reports Data not found"})
            }
            const result = await reportsCollection.insertOne(reportsData); 
            res.send(result); 
        }); 
        app.patch('/reports/action', verifyJWT, verifyAdmin,  async (req, res) => {
            const { action, reportId, userEmail, commentId } = req.body;

            const reportFilter = { _id: new ObjectId(reportId) };

            if (action === 'ignore') {
                await reportsCollection.updateOne(reportFilter, { $set: { status: 'resolved' } });
            } else if (action === 'warn') {
                await userCollection.updateOne({ email: userEmail }, { $set: { warning: true } });
            } else if (action === 'delete-comment') {
                const query = { _id: new ObjectId(commentId) }
                const result = await commentsCollection.deleteOne(query);
                const reportDeleteQuery = {_id : new ObjectId(reportId)}; 
                const reportDeleteResult = await reportsCollection.deleteOne(reportDeleteQuery); 
            } else if (action === 'block') {
                await userCollection.updateOne({ email: userEmail }, { $set: { isBlocked: true } });
            }

            res.send({ modifiedCount: 1 });
        });

        
        // DELETE /posts/:id
        app.delete('/posts/:id', verifyJWT, async (req, res) => {
            const postId = req.params.id;
            const decodedEmail = req.decoded.email;

            const query = { _id: new ObjectId(postId) };
            const post = await postCollection.findOne(query);
            if (!post) {
                return res.status(404).send({ message: 'Post not found' });
            }

            if (post.authorEmail !== decodedEmail) {
                return res.status(403).send({ message: 'Forbidden: email mismatch' });
            }

            const result = await postCollection.deleteOne({ _id: new ObjectId(postId) });
            await userCollection.updateOne({ email: decodedEmail }, { $inc: { postLimit: 1 } });
            res.send({ success: true, message: 'Post deleted successfully', ...result });
        });

        // Accept Payment 
        app.post('/create-payment-intent', async (req, res) => {
            const { amount} = req.body; 
            const amountInSent = amount * 100 ; 
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInSent,
                    currency: 'usd',
                });
                return res.send({ client_secret: paymentIntent.client_secret })
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        })

        app.post('/membership', async (req, res) => {
            const {email , ...paymentRest} = req.body; 
            const paymentData = {
                ...paymentRest, 
                email
            }
            const result = await paymentCollection.insertOne(paymentData); 
            const updatedDoc = {
                $set: {
                    memberShip: 'member'
                }, 
                $inc : {
                    postLimit : 5
                }, 
                $addToSet : {
                    badges : 'Gold'
                }
            }
            await userCollection.updateOne({ email}, updatedDoc); 
            res.send(result)
        }); 

        // Admin related Route 
        app.get('/role', async (req, res) => {
            try {
                const email = req.query.email; 

                if (!email) {
                    return res.status(400).json({ error: 'Email is required' });
                }

                const user = await userCollection.findOne({ email });

                if (!user) {
                    return res.status(404).json({ error: 'User not found' });
                }

                res.json({ role: user.role });
            } catch (error) {
                console.error('Error fetching user role:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        }); 

        app.get('/admin/users',verifyJWT, verifyAdmin,  async (req, res) => {
            const search = req.query.search || '';
            const query = {
                $or: [
                    { username: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            };

            try {
                const users = await userCollection.find(query).toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch users' });
            }
        }); 

        app.patch('/makeAdmin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            try {
                const result = await userCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: 'admin' } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to make admin' });
            }
        })

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
