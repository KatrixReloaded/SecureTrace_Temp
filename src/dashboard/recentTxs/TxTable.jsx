import React, { useState, useEffect } from 'react';
import { getEthereumTransactions } from './networks/ethereum';
import { getSolanaTransactions } from './networks/solana';

const getRecentTransactions = async () => {
    const ethTransactions = await getEthereumTransactions();
    const solTransactions = await getSolanaTransactions();

    // Combine all transactions into a single array
    const allTransactions = [...ethTransactions, ...solTransactions];

    // Sort transactions by timestamp (newest first)
    return allTransactions.sort((a, b) => b.timestamp - a.timestamp);
};

const RecentTransactionsTable = () => {
  const [transactions, setTransactions] = useState([]);  // State to hold transactions
  const [loading, setLoading] = useState(true);  // State for loading indication

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
          const data = await getRecentTransactions();
          setTransactions(data); 
      } catch (error) {
        console.error('Error fetching transactions:', error);
      } finally {
        setLoading(false);  // Stop loading once fetch is done
      }
    };

    fetchTransactions();  // Call the async function to fetch transactions
  }, []);  // Empty array means it runs once on component mount

  if (loading) {
    return <div>Loading...</div>;  // Show loading state while data is being fetched
  }

  transactions.forEach((transaction) => {
    const date = new Date(transaction.timestamp * 1000);
    transaction.timestamp = date;
    
  })

  return (
      <table>
      <thead>
          <tr>
          <th>Chain</th>
          <th>Transaction Hash</th>
          <th>From</th>
          <th>To</th>
          <th>Value</th>
          <th>Timestamp</th>
          </tr>
      </thead>
      <tbody>
          {transactions.map((tx, index) => (
          <tr key={index}>
              <td>{tx.chain}</td>
              <td>{tx.hash}</td>
              <td>{tx.from}</td>
              <td>{tx.to}</td>
              <td>{tx.value} {tx.chain === "Ethereum" ? "ETH" : "SOL"}</td>
              <td>{tx.chain === "Solana" ? new Date(tx.timestamp/1000).toLocaleString() : (tx.timestamp).toLocaleString()}</td>
          </tr>
          ))}
      </tbody>
      </table>
  );
};

export default RecentTransactionsTable;
