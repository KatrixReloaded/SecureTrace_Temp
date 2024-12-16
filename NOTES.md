# Pending Tasks  
- Integration of DB with Algorand PT  
- For price filter:  
    1. Fetch 1000 transfers
    2. Filter through the transfers to fetch first 100-200 transfers  
    3. If price filter, fetch first 100-200 transfers with value above given filter.  
    4. Would I have to check the price of every transfer token then??? Maybe recurring tokens could be cached...