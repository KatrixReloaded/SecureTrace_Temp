// src/TokenTransfers.js
import React, { useState } from 'react';
import axios from 'axios';

const TokenTransfers = () => {
    const [address, setAddress] = useState('');
    const [txhash, setTxhash] = useState('');
    const [transfers, setTransfers] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchTransfers = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await axios.get(`http://localhost:3001/token-transfers/${address}`);
            setTransfers(response.data);
        } catch (err) {
            setError('An error occurred while fetching token transfers.');
            setTransfers(null);
        } finally {
            setLoading(false);
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
            {loading && <p>Loading...</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {transfers && (
                <div>
                    <h2>Transfers {address}</h2>
                    <pre>{JSON.stringify(transfers.from, null, 2)}</pre>
                    <h2>Transfers to {address}</h2>
                    <pre>{JSON.stringify(transfers.to, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export default TokenTransfers;
