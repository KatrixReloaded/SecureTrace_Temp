import './App.css';
import { BrowserRouter, Route, Routes } from "react-router-dom";
import RecentTransactionsTable from './dashboard/recentTxs/TxTable.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RecentTransactionsTable />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;