import { useState } from 'react'
import { login } from '../api/auth'
import { PAGE_BACKGROUND, PAGE_CARD, PRIMARY_BUTTON } from '../theme'

interface LoginProps {
  /** Called once the password was accepted and the token is stored. */
  onAuthenticated: () => void
}

export function Login({ onAuthenticated }: LoginProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await login(password)
      setPassword('')
      onAuthenticated()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`min-h-screen ${PAGE_BACKGROUND}`}>
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
        <header className="text-center">
          <h1 className="text-3xl font-semibold text-gray-900">Piano Trainer</h1>
          <p className="mt-2 text-sm text-gray-600">This server is private. Enter its password to continue.</p>
        </header>

        <form
          className={`flex flex-col gap-3 p-5 ${PAGE_CARD}`}
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              // The one field on the screen, so focusing it beats making the
              // player tap before typing -- on a phone this also opens the
              // keyboard straight away.
              autoFocus
              autoComplete="current-password"
              className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={isSubmitting || password.length === 0} className={PRIMARY_BUTTON}>
            {isSubmitting ? 'Checking...' : 'Unlock'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500">
          Served over plain HTTP, so the password travels unencrypted -- fine on a network you trust.
        </p>
      </div>
    </div>
  )
}
