import { useState } from 'react'
import { Sidebar, type PageId } from './components/Sidebar'
import { Settings } from './pages/Settings'
import { Placeholder } from './pages/Placeholder'
import { Calculator } from './pages/Calculator'
import { Analyze } from './pages/Analyze'

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('analyze')
  return (
    <div className="app-shell">
      <Sidebar current={page} onNavigate={setPage} />
      <main className="content">
        {page === 'analyze' && <Analyze />}
        {page === 'calculator' && <Calculator />}
        {page === 'bankroll' && <Placeholder title="Bankroll" phase="Phase 4" />}
        {page === 'track-record' && <Placeholder title="Track Record" phase="Phase 4" />}
        {page === 'chat' && <Placeholder title="Chat" phase="Phase 5" />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
