import './App.css';
import { BrowserRouter, Route, Routes } from "react-router-dom";
import RecentTransactions from './dashboard/recentTxs/TxTable.jsx';
import TokenDetails from './addressPortfolioTracker/page/TokenDetails.jsx';
import TokenTransfers from './txTracingVisualizer/TokenTransfers.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RecentTransactions />} />
        {/* <Route path="/" element={<TokenDetails />} /> */}
        {/* <Route path="/" element={<TokenTransfers />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;