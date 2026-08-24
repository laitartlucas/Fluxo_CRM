import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { DashboardPage } from './pages/DashboardPage'
import { PipelinePage } from './pages/PipelinePage'
import { CompaniesPage } from './pages/CompaniesPage'
import { CompanyDetailPage } from './pages/CompanyDetailPage'
import { ContactsPage } from './pages/ContactsPage'
import { ContactDetailPage } from './pages/ContactDetailPage'
import { OpportunityDetailPage } from './pages/OpportunityDetailPage'
import { TasksPage } from './pages/TasksPage'
import { InviteMemberPage } from './pages/InviteMemberPage'
import { AgendaPage } from './pages/AgendaPage'
import { FinanceiroPage } from './pages/FinanceiroPage'
import { ConversasPage } from './pages/ConversasPage'
import { MarketingPage } from './pages/MarketingPage'
import { CustomerSuccessPage } from './pages/CustomerSuccessPage'
import { DisparosPage } from './pages/DisparosPage'
import { FluxosPage } from './pages/FluxosPage'
import { AtendenteIAPage } from './pages/AtendenteIAPage'
import { ContasPage } from './pages/ContasPage'
import { AjustesPage } from './pages/AjustesPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/financeiro" element={<FinanceiroPage />} />
          <Route path="/conversas" element={<ConversasPage />} />
          <Route path="/marketing" element={<MarketingPage />} />
          <Route path="/sucesso-cliente" element={<CustomerSuccessPage />} />
          <Route path="/disparos" element={<DisparosPage />} />
          <Route path="/fluxos" element={<FluxosPage />} />
          <Route path="/atendente-ia" element={<AtendenteIAPage />} />
          <Route path="/contas" element={<ContasPage />} />
          <Route path="/ajustes" element={<AjustesPage />} />
          <Route path="/invite" element={<InviteMemberPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
