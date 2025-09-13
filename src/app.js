require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const bodyParser = require('body-parser');
const cors = require('cors');

// Import routes, services, and models
const ingestionRoutes = require('./routes/ingestionRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const startConsumer = require('./consumers/ingestionConsumer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { connect: connectRabbit } = require('./services/rabbitmqService');
const { getCustomers, createCampaign, previewAudience, getCustomer } = require('./controllers/campaignController');

// Passport configuration
require('./utils/auth');

const app = express();

// ====== ENV VARS ======
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;

// ====== LOG ENV ======
console.log("Loaded .env from:", process.cwd() + "/.env");
console.log("MONGO_URI:", MONGO_URI);
console.log("RabbitMQ URL:", RABBITMQ_URL);
console.log("Frontend URL:", process.env.FRONTEND_URL);

// ====== MONGODB CONNECTION ======
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log(" MongoDB connected");
        startConsumer();
    })
    .catch(err => console.error(" MongoDB connection error:", err));

// ====== RABBITMQ CONNECTION ======
(async () => {
    try {
        await connectRabbit();
        console.log(" RabbitMQ connected");
    } catch (err) {
        console.error(" RabbitMQ connection failed:", err);
    }
})();

app.set('trust proxy', 1);

// ====== CORS CONFIGURATION - MUST COME BEFORE OTHER MIDDLEWARE ======
const allowedOrigins = [
    'https://xeno-frontend-eight.vercel.app',
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:3000',
    'https://localhost:3000'
];

// Remove undefined values
const filteredOrigins = allowedOrigins.filter(origin => origin);

console.log("Allowed CORS origins:", filteredOrigins);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        if (filteredOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log("CORS blocked origin:", origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With', 
        'Content-Type', 
        'Accept',
        'Authorization',
        'Cookie'
    ],
    exposedHeaders: ['Set-Cookie'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// ====== MIDDLEWARE ======
app.use(bodyParser.json());

// Session configuration - MUST come after CORS
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
        origin: req.headers.origin,
        cookies: req.headers.cookie ? 'present' : 'none',
        authenticated: req.isAuthenticated ? req.isAuthenticated() : 'unknown'
    });
    next();
});

// ====== AUTHENTICATION ROUTES ======
app.get('/auth/google',
    passport.authenticate('google', {
        scope: ['profile', 'email']
    })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        console.log("OAuth callback successful, redirecting to:", process.env.FRONTEND_URL);
        res.redirect(process.env.FRONTEND_URL);
    }
);

// Logout route
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.redirect(process.env.FRONTEND_URL); 
    });
});

// Added a route to check login status
app.get('/api/is-logged-in', (req, res) => {
    console.log("Login status check:", {
        authenticated: req.isAuthenticated(),
        user: req.user ? req.user.email : null,
        session: req.session.id || null
    });
    
    if (req.isAuthenticated()) {
        res.status(200).json({ success: true, user: req.user });
    } else {
        res.status(401).json({ success: false, message: 'Not authenticated' });
    }
});

// Debug route
app.get('/auth/debug', (req, res) => {
    res.json({
        isAuthenticated: req.isAuthenticated(),
        user: req.user || null,
        session: req.session || null,
        cookies: req.headers.cookie || null,
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
        frontendUrl: process.env.FRONTEND_URL,
        nodeEnv: process.env.NODE_ENV,
        allowedOrigins: filteredOrigins
    });
});

// ====== PROTECT API ROUTES WITH AUTHENTICATION ======
const isLoggedIn = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).send('Unauthorized. Please log in.');
};

app.use('/api/ingestion', isLoggedIn, ingestionRoutes);
app.use('/api/campaigns', isLoggedIn, campaignRoutes);
app.get('/api/customers', getCustomers);
app.get('/api/customers/:customerId', getCustomer);

app.post('/api/ai/text-to-rules', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ success: false, message: 'Prompt is required.' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const fullPrompt = `Convert the following natural language description into a valid JSON object for a query builder. The JSON must have a single top-level object with 'combinator' and 'rules' keys. The available fields are 'total_spend' (number), 'visit_count' (number), 'inactive_days' (number), and 'email' (text). The available operators are '=', '!=', '<', '<=', '>', '>=', and 'contains'. Do not add any text, markdown, or code block formatting before or after the JSON.
        
        Example 1: "spent over 500 dollars"
        Output:
        {
          "combinator": "and",
          "rules": [
            {
              "field": "total_spend",
              "operator": ">",
              "value": "500"
            }
          ]
        }
                
        Example 2: "visited more than 10 times and inactive for over 30 days"
        Output:
        {
          "combinator": "and",
          "rules": [
            {
              "field": "visit_count",
              "operator": ">",
              "value": "10"
            },
            {
              "field": "inactive_days",
              "operator": ">",
              "value": "30"
            }
          ]
        }
        
        Example 3: "spent between 500 and 1500 and not visited over 30 days"
        Output:
        {
          "combinator": "and",
          "rules": [
            {
              "field": "total_spend",
              "operator": ">=",
              "value": "500"
            },
            {
              "field": "total_spend",
              "operator": "<=",
              "value": "1500"
            },
            {
              "field": "inactive_days",
              "operator": "<=",
              "value": "30"
            }
          ]
        }
                
        Now, convert this: "${prompt}"
        `;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        // Parse the JSON and send it back to the frontend
        const jsonResponse = JSON.parse(text);
        res.status(200).json(jsonResponse);

    } catch (error) {
        console.error('Error generating rules:', error);
        res.status(500).json({ success: false, message: 'Failed to generate rules.' });
    }
});

// Root route
app.get('/', (req, res) => {
    res.send('Mini CRM Backend is running!');
});

// ====== START SERVER ======
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});