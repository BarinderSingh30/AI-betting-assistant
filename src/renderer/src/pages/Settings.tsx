import { useEffect, useState } from 'react'

export function Settings(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'loading' | 'empty' | 'saved' | 'editing' | 'error'>(
    'loading'
  )

  useEffect(() => {
    window.api
      .getApiKey()
      .then((key) => {
        if (key) setApiKey(key)
        setStatus(key ? 'saved' : 'empty')
      })
      .catch(() => setStatus('error'))
  }, [])

  async function save(): Promise<void> {
    try {
      await window.api.setApiKey(apiKey.trim())
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      <label htmlFor="api-key">Anthropic API key</label>
      <p className="hint">
        This key lets the app use AI for research. Get one at console.anthropic.com → API keys. It
        is stored encrypted on this computer only.
      </p>
      <input
        id="api-key"
        type="password"
        value={apiKey}
        placeholder="sk-ant-..."
        onChange={(e) => {
          setApiKey(e.target.value)
          setStatus('editing')
        }}
      />
      <button onClick={save} disabled={status === 'loading' || apiKey.trim() === ''}>
        Save key
      </button>
      {status === 'saved' && <p className="status-ok">Saved. The app can now use AI features.</p>}
      {status === 'error' && (
        <p className="status-error">Something went wrong saving the key. Try again.</p>
      )}
    </div>
  )
}
