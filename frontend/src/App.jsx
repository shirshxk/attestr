import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import HomePage      from './pages/HomePage'
import LoginPage      from './pages/LoginPage'
import RegisterPage   from './pages/RegisterPage'
import MerkleDemo     from './pages/MerkleDemo'
import OfflineVerifier from './pages/OfflineVerifier'
import AdminDashboard from './pages/AdminDashboard'
import AuditorDashboard from './pages/AuditorDashboard'
import VendorDashboard  from './pages/VendorDashboard'

function PrivateRoute({ children, role }) {
  const { org, loading } = useAuth()
  if (loading) return null
  if (!org) return <Navigate to="/login" replace />
  if (role && org.role !== role) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/"           element={<HomePage />} />
      <Route path="/login"      element={<LoginPage />} />
      <Route path="/register"   element={<RegisterPage />} />
      <Route path="/demo/merkle" element={<MerkleDemo />} />
      <Route path="/verify"      element={<OfflineVerifier />} />

      <Route path="/admin/*" element={
        <PrivateRoute role="ca_admin"><AdminDashboard /></PrivateRoute>
      }/>
      <Route path="/auditor/*" element={
        <PrivateRoute role="auditor"><AuditorDashboard /></PrivateRoute>
      }/>
      <Route path="/vendor/*" element={
        <PrivateRoute role="vendor"><VendorDashboard /></PrivateRoute>
      }/>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
