import type { Metadata } from 'next'
import { LoginForm } from '@/components/login-form'

export const metadata: Metadata = { title: 'Entrar | FinBot' }

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<{ expirada?: string }> }>) {
  const { expirada } = await searchParams
  return <LoginForm expirada={expirada === '1'} />
}
