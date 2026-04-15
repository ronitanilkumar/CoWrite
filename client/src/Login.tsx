import { useEffect, useState, useRef } from 'react'
import './Login.css'

const PHRASES = [
  'Write together, in real time.',
  'AI that edits alongside you.',
  'Every doc, always in sync.',
  'Your words. Smarter, faster.',
]

function LoginSub() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const cycle = () => {
      setVisible(false)
      timerRef.current = setTimeout(() => {
        setIndex(i => (i + 1) % PHRASES.length)
        setVisible(true)
      }, 420)
    }
    timerRef.current = setTimeout(() => {
      cycle()
      const interval = setInterval(cycle, 3200)
      return () => clearInterval(interval)
    }, 3200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return (
    <p className={`login-sub${visible ? ' login-sub--visible' : ''}`}>
      {PHRASES[index]}
    </p>
  )
}

export default function Login() {
  const error = new URLSearchParams(window.location.search).get('error')

  // Apply saved theme before render so there's no flash
  useEffect(() => {
    const saved = localStorage.getItem('cowrite-theme') as string
    const resolved = saved === 'light' ? 'light'
      : saved === 'dark' ? 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', resolved)
  }, [])

  return (
    <div className="login">
      <div className="login-left">
        <div className="login-brand">
          <img src="/cowrite_darkmode.svg" alt="CoWrite" className="login-logo login-logo--dark" />
          <img src="/cowrite_lightmode.svg" alt="CoWrite" className="login-logo login-logo--light" />
        </div>

        <div className="login-hero">
          <h1 className="login-headline">
            CoWrite
          </h1>
          <div className="login-sub-wrap" aria-live="polite">
            <LoginSub />
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <h2 className="login-card-heading">Sign in</h2>
          <p className="login-card-sub">
            Continue with your Google account.<br />
            New users are set up automatically.
          </p>

          {error && (
            <p className="login-error">Something went wrong. Please try again.</p>
          )}

          <a href="http://localhost:1234/auth/google" className="login-google-btn">
            <svg className="login-google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </a>
        </div>
      </div>
    </div>
  )
}
