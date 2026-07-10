export type PageId = 'analyze' | 'calculator' | 'bankroll' | 'track-record' | 'chat' | 'settings'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'bankroll', label: 'Bankroll' },
  { id: 'track-record', label: 'Track Record' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' }
]

export function Sidebar(props: {
  current: PageId
  onNavigate: (page: PageId) => void
}): React.JSX.Element {
  return (
    <nav className="sidebar">
      <h1 className="sidebar-title">Betting Assistant</h1>
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={p.id === props.current ? 'nav-item active' : 'nav-item'}
          onClick={() => props.onNavigate(p.id)}
        >
          {p.label}
        </button>
      ))}
    </nav>
  )
}
