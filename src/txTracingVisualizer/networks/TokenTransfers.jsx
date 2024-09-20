// src/TokenTransfers.js
import React, { useState } from 'react';
import axios from 'axios';

const TokenTransfers = () => {
    const [address, setAddress] = useState('');
    const [transfers, setTransfers] = useState(null);
    const [error, setError] = useState(null);

    const fetchTransfers = async () => {
        try {
            const response = await axios.get(`http://localhost:3002/token-transfers/${address}`);
            setTransfers(response.data);
            setError(null);
        } catch (err) {
            setError('An error occurred while fetching token transfers.');
            setTransfers(null);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        fetchTransfers();
    };

    return (
        <div>
            <h1>Token Transfers</h1>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter wallet address"
                    required
                />
                <button type="submit">Fetch Transfers</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {transfers && (
                <div>
                    <h2>Transfers from {address}</h2>
                    <pre>{JSON.stringify(transfers.from, null, 2)}</pre>
                    <h2>Transfers to {address}</h2>
                    <pre>{JSON.stringify(transfers.to, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export default TokenTransfers;
