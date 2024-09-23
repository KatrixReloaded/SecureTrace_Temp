const mongoose = require('mongoose');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/tokenDB', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Define a Token schema
const tokenSchema = new mongoose.Schema({
    symbol: String,
    name: String,
    address: String,
});

const Token = mongoose.model('Token', tokenSchema);

// Get the list of tokens
app.get('/api/tokens', async (req, res) => {
    const tokens = await Token.find();
    res.json(tokens);
});

// Add a token
app.post('/api/tokens', async (req, res) => {
    const newToken = new Token(req.body);
    await newToken.save();
    res.status(201).json(newToken);
});

// Remove a token
app.delete('/api/tokens/:symbol', async (req, res) => {
    await Token.deleteOne({ symbol: req.params.symbol });
    res.status(204).send(); // No content
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
