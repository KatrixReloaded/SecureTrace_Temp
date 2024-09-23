import React, { useEffect, useState } from 'react';

const RecentTransactions = () => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchTransactions = async () => {
            try {
                const response = await fetch('http://localhost:3001/recent-txs');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const data = await response.json();
                setTransactions(data.txs);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchTransactions();
    }, []);

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
        <div>
            <h1>Recent Transactions</h1>
            <table>
                <thead>
                    <tr>
                        <th>Transaction Hash</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Value</th>
                        <th>Token</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((chainTxs, chainIndex) => (
                        chainTxs.map((tx, txIndex) => (
                            <tr key={`${chainIndex}-${txIndex}`}>
                                <td>{tx.hash}</td>
                                <td>{tx.from}</td>
                                <td>{tx.to}</td>
                                <td>{tx.value}</td>
                                <td>{tx.asset}</td>
                                <td>{tx.metadata.blockTimestamp}</td>
                            </tr>
                        ))
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default RecentTransactions;
