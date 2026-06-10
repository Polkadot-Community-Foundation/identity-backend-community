import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/dm-serif-display/400.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ApiDocsSkeleton } from './components/ApiDocsSkeleton'
import { useSystemTheme } from './hooks/useSystemTheme'
import { Landing } from './Landing'

const Docs = lazy(() => import('./Docs'))

function SystemThemeProvider({ children }: { children: React.ReactNode }) {
  useSystemTheme()
  return children
}

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SystemThemeProvider>
          <Suspense fallback={<ApiDocsSkeleton />}>
            <Routes>
              <Route path='/' element={<Landing />} />
              <Route path='/docs' element={<Docs />} />
            </Routes>
          </Suspense>
        </SystemThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
