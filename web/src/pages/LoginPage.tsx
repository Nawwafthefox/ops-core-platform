import React, { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function LoginPage() {
  const nav = useNavigate()

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'warning'; text: string } | null>(null)

  const envOk = useMemo(() => {
    return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setLoading(true)

    try {
      if (!envOk) {
        setMsg({
          variant: 'danger',
          text: 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Create web/.env from web/.env.example.',
        })
        return
      }

      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        nav('/')
      } else {
        if (fullName.trim().length < 2) {
          setMsg({ variant: 'warning', text: 'Full name is required.' })
          return
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })

        if (error) throw error

        setMsg({
          variant: 'success',
          text: 'Account created. If email confirmation is enabled, open Inbucket (http://localhost:54324) to confirm, then sign in.',
        })
        setMode('signin')
      }
    } catch (e) {
      const msgText = e instanceof Error ? e.message : String(e)
      setMsg({ variant: 'danger', text: msgText })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ocp-app d-flex align-items-center" style={{ minHeight: '100vh' }}>
      <Container>
        <Row className="justify-content-center">
          <Col md={8} lg={6} xl={5}>
            <Card className="ocp-card p-2">
              <Card.Body className="p-4">
                <div className="d-flex align-items-start justify-content-between mb-3">
                  <div>
                    <h4 className="mb-1">Operations Core Platform</h4>
                    <div className="text-muted small">Internal Operations Hub • Requests • Workflow • KPIs</div>
                  </div>
                  <div className="ocp-pill">{mode === 'signin' ? 'Sign in' : 'Create account'}</div>
                </div>

                {msg && (
                  <Alert variant={msg.variant} className="mt-3">
                    {msg.text}
                  </Alert>
                )}

                {!envOk && (
                  <Alert variant="warning" className="mt-3">
                    Missing env vars. Copy <span className="ocp-code">web/.env.example</span> →{' '}
                    <span className="ocp-code">web/.env</span> and paste your local Supabase keys.
                  </Alert>
                )}

                <Form className="mt-3" onSubmit={onSubmit}>
                  {mode === 'signup' && (
                    <Form.Group className="mb-3">
                      <Form.Label>Full name</Form.Label>
                      <Form.Control
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g., Ahmed Al-Qahtani"
                        autoComplete="name"
                      />
                    </Form.Group>
                  )}

                  <Form.Group className="mb-3">
                    <Form.Label>Email</Form.Label>
                    <Form.Control
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Password</Form.Label>
                    <Form.Control
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="••••••••"
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    />
                  </Form.Group>

                  <Button type="submit" className="w-100 rounded-pill" disabled={loading}>
                    {loading ? <Spinner size="sm" animation="border" /> : mode === 'signin' ? 'Sign in' : 'Sign up'}
                  </Button>

                  <div className="d-flex justify-content-between mt-3 small">
                    <button
                      type="button"
                      className="btn btn-link p-0"
                      onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                    >
                      {mode === 'signin' ? 'Create an account' : 'I already have an account'}
                    </button>
                    <span className="text-muted">Local MVP bootstrap</span>
                  </div>
                </Form>
              </Card.Body>
            </Card>

            <div className="text-center text-muted small mt-3">
              Tip: In local Supabase, auth emails appear in Inbucket at <span className="ocp-code">http://localhost:54324</span>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  )
}
