import './App.css';
import { BrowserRouter, Route, Routes } from "react-router-dom";
import RecentTransactionsTable from './dashboard/recentTxs/TxTable.jsx';
import TokenDetails from './addressPortfolioTracker/page/TokenDetails.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* <Route path="/" element={<RecentTransactionsTable />} /> */}
        <Route path="/" element={<TokenDetails />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;