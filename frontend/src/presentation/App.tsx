import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireRole } from './auth'
import Account from './pages/Account'
import AdminAudit from './pages/admin/Audit'
import AdminSheets from './pages/admin/Sheets'
import AdminStaff from './pages/admin/Staff'
import AdminStudents from './pages/admin/Students'
import AdminTemplates from './pages/admin/Templates'
import Landing from './pages/Landing'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Office from './pages/Office'
import SheetDetail from './pages/SheetDetail'
import Student from './pages/Student'
import Verify from './pages/Verify'

// Публичные страницы открыты всем; кабинеты пускают только свою роль (сервер проверяет то же самое).
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:number" element={<Verify />} />

          <Route path="/student" element={<RequireRole roles={['student']}><Student /></RequireRole>} />
          <Route path="/office" element={<RequireRole roles={['officer']}><Office /></RequireRole>} />
          <Route path="/sheets/:number" element={<RequireRole roles={['officer', 'admin']}><SheetDetail /></RequireRole>} />
          <Route path="/admin" element={<RequireRole roles={['admin']}><AdminSheets /></RequireRole>} />
          <Route path="/admin/students" element={<RequireRole roles={['admin']}><AdminStudents /></RequireRole>} />
          <Route path="/admin/staff" element={<RequireRole roles={['admin']}><AdminStaff /></RequireRole>} />
          <Route path="/admin/templates" element={<RequireRole roles={['admin']}><AdminTemplates /></RequireRole>} />
          <Route path="/admin/audit" element={<RequireRole roles={['admin']}><AdminAudit /></RequireRole>} />
          <Route path="/account" element={<RequireRole roles={['student', 'officer', 'admin']}><Account /></RequireRole>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
