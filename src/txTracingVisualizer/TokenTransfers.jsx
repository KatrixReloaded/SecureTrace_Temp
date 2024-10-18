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
            const response = await axios.get(`http://localhost:3001/fetch-transaction-details/${txhash}`);
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
                    value={txhash}
                    onChange={(e) => setTxhash(e.target.value)}
                    placeholder="Enter tx hash"
                    required
                />
                <button type="submit">Fetch Transfers</button>
            </form>
            {loading && <p>Loading...</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {transfers && (
                <div>
                    <h2>Transfers {txhash}</h2>
                    <pre>{JSON.stringify(transfers.transfers, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export default TokenTransfers;
