import React from 'react'
import { Navigate } from 'react-router-dom'
import { Spinner, Button, Alert } from 'react-bootstrap'
import { useAuth } from '../lib/AuthProvider'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, ctx, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '70vh' }}>
        <Spinner animation="border" role="status" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!ctx) {
    return (
      <div className="container py-5">
        <Alert variant="warning" className="ocp-card p-4">
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
            <div>
              <h5 className="mb-2">Account not provisioned</h5>
              <p className="mb-0">
                Your user exists in Supabase Auth, but it does not have a company membership yet.
                In local MVP, this usually means the seed data wasn’t applied or app_settings
                defaults are missing.
              </p>
              <hr />
              <ul className="mb-0">
                <li>
                  Run <span className="ocp-code">supabase db reset</span> to apply migrations + seed.
                </li>
                <li>
                  Confirm <span className="ocp-code">public.app_settings</span> has default_company_id
                  / default_department_id.
                </li>
              </ul>
            </div>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={() => location.reload()}>
                Retry
              </Button>
              <Button variant="outline-danger" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </Alert>
      </div>
    )
  }

  return <>{children}</>
}
