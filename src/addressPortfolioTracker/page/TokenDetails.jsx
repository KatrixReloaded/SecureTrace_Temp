import React, { useState } from 'react';
import axios from 'axios';

const TokenDetails = () => {
    const [address, setAddress] = useState('');
    const [tokenDetails, setTokenDetails] = useState([]);
    const [error, setError] = useState('');

    const fetchDetails = async () => {
        try {
            const response = await axios.post('http://localhost:3001/fetch-address-details', { address });
            setTokenDetails(response.data.tokenDetails);
            setError('');
        } catch (err) {
            setError('Failed to fetch token details');
            setTokenDetails([]);
        }
    };

    return (
        <div>
            <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter address"
            />
            <button onClick={fetchDetails}>Fetch Token Details</button>
            {error && <p>{error}</p>}
            <ul>
                {tokenDetails.map((token, index) => (
                    <li key={index}>
                        {token.balance} {token.name}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default TokenDetails;
