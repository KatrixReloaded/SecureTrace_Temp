import React, { useEffect, useState } from 'react';
import axios from 'axios';

const RecentTransactions = () => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchTransactions = async () => {
            try {
                const response = await axios.get("https://caiman-wanted-fox.ngrok-free.app/recent-txs", {
                    headers: {
                        'ngrok-skip-browser-warning': 'true',
                        'Content-Type': 'application/json',
                    },
                });
                setTransactions(response.data); // Assuming response.data is the array of transactions
            } catch (err) {
                setError(err.message); // Capture error message
            } finally {
                setLoading(false); // Set loading to false regardless of success or failure
            }
        };

        fetchTransactions();
    }, []); // Empty dependency array means this effect runs once on mount

    if (loading) return <p>Loading...</p>;
    if (error) return <p>Error: {error}</p>;

    return (
        <div>
            <h1>Recent Transactions</h1>
            <ul>
                {transactions.length > 0 ? (
                    transactions.map((tx, index) => (
                        <li key={index}>{JSON.stringify(tx)}</li> // Display each transaction as JSON
                    ))
                ) : (
                    <li>No transactions found.</li>
                )}
            </ul>
        </div>
    );
};

export default RecentTransactions;
