import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ComparePage } from './pages/ComparePage.tsx'
import { SessionHubPage } from './pages/SessionHubPage.tsx'
import { TemplateGalleryPage } from './pages/TemplateGalleryPage.tsx'
import { PromptsPage } from './pages/PromptsPage.tsx'
import { ConfigPage } from './pages/ConfigPage.tsx'
import { EvaluationConfigPage } from './pages/EvaluationConfigPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { ResultsPage } from './pages/ResultsPage.tsx'
import { SummaryPage } from './pages/SummaryPage.tsx'
import { EvalLayout } from './layouts/EvalLayout.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<SessionHubPage />} />
        <Route path="/eval/templates" element={<TemplateGalleryPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/app" element={<App />} />
        <Route path="/eval" element={<EvalLayout />}>
          <Route index element={<Navigate to="prompts" replace />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="config/:evalId" element={<EvaluationConfigPage />} />
          <Route path="run/:evalId" element={<DashboardPage />} />
          <Route path="results/:evalId" element={<ResultsPage />} />
          <Route path="summary/:evalId" element={<SummaryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
