import { useMutation } from '@tanstack/react-query'
import { BookOpen, ChevronRight, Lock, User } from 'lucide-react'
import React, { useId } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'

interface FormValues {
  username: string
  password: string
}

interface AuthResponse {
  spec: object
  url: string
}

const FETCH_TIMEOUT = 3000

export const Landing: React.FC = () => {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      username: '',
      password: '',
    },
  })

  const usernameId = useId()
  const passwordId = useId()
  const usernameErrorId = `${usernameId}-error`
  const passwordErrorId = `${passwordId}-error`
  const formErrorId = useId()

  const authenticateMutation = useMutation({
    mutationFn: async (credentials: FormValues): Promise<AuthResponse> => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

      try {
        const base64Credentials = btoa(`${credentials.username}:${credentials.password}`)
        const response = await fetch('/api/swagger/json', {
          headers: {
            'Authorization': `Basic ${base64Credentials}`,
          },
          credentials: 'omit',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('That password is incorrect. Try again.')
        }

        const spec = await response.json()
        const blob = new Blob([JSON.stringify(spec)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)

        return { spec, url }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('This is taking too long. Check your connection or try again.')
        }
        throw error
      } finally {
        clearTimeout(timeoutId)
      }
    },
    onSuccess: (data) => {
      sessionStorage.setItem('api_spec_url', data.url)
      void navigate('/docs')
    },
  })

  const onSubmit: SubmitHandler<FormValues> = (data) => {
    authenticateMutation.mutate(data)
  }

  const getErrorMessage = () => {
    if (!authenticateMutation.error) return null

    const error = authenticateMutation.error
    const isTimeout = error instanceof Error &&
      error.message.includes('taking too long')

    if (isTimeout) {
      return `This is taking too long. Check your connection or try again.`
    }

    return error instanceof Error ? error.message : 'Something broke on our end. Try again in a few minutes.'
  }

  return (
    <>
      <title>Polkadot App - API Documentation</title>
      <meta name='description' content='Sign in to access the Polkadot App API documentation' />
      <meta property='og:title' content='Polkadot App - API Documentation' />
      <meta property='og:description' content='Sign in to access the Polkadot App API documentation' />
      <meta property='og:type' content='website' />
      <meta name='twitter:card' content='summary_large_image' />
      <meta name='twitter:title' content='Polkadot App - API Documentation' />
      <meta name='twitter:description' content='Sign in to access the Polkadot App API documentation' />
      <main className='flex flex-col items-center justify-center min-h-screen w-full bg-surface-main p-4'>
        <div className='w-full max-w-md px-8 py-10 bg-surface-container rounded-container shadow-1'>
          <div className='flex justify-center mb-8'>
            <div className='flex items-center space-x-2'>
              <img
                src='/logo-symbol_dark.svg'
                alt='Polkadot'
                className='w-10 h-10 object-contain block dark:hidden'
              />
              <img
                src='/logo-symbol_light.svg'
                alt='Polkadot'
                className='w-10 h-10 object-contain hidden dark:block'
              />
              <span className='text-2xl font-semibold leading-tight text-primary'>
                Polkadot App
              </span>
            </div>
          </div>
          <div className='flex items-center justify-center mb-6'>
            <BookOpen className='text-secondary mr-2' size={24} aria-hidden='true' />
            <h1 className='text-2xl font-semibold leading-tight text-center text-primary'>
              API Documentation
            </h1>
          </div>
          <p className='text-center text-secondary mb-8'>
            Sign in to access the Polkadot App API documentation
          </p>
          <div aria-live='polite' aria-atomic='true' className='sr-only'>
            {authenticateMutation.isPending
              ? 'Authenticating, please wait...'
              : authenticateMutation.error
              ? `Error: ${getErrorMessage()}`
              : ''}
          </div>
          {authenticateMutation.error && (
            <div
              id={formErrorId}
              role='alert'
              className='p-3 text-sm text-error bg-status-error/10 rounded-nested border border-error mb-6'
            >
              {getErrorMessage()}
            </div>
          )}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className='space-y-6'
            aria-busy={authenticateMutation.isPending}
            noValidate
          >
            <div className='space-y-2'>
              <label
                htmlFor={usernameId}
                className='block text-sm font-medium text-primary'
              >
                Username
              </label>
              <div className='relative'>
                <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                  <User size={18} className='text-tertiary' aria-hidden='true' />
                </div>
                <input
                  id={usernameId}
                  type='text'
                  className={`block w-full pl-10 pr-3 py-2 border bg-surface-container text-primary placeholder:text-tertiary rounded-nested transition-colors cursor-text ${
                    errors.username ? 'border-error' : 'border-default'
                  } hover:border-default-inverted focus-visible:outline-none`}
                  placeholder='Enter username'
                  aria-describedby={errors.username ? usernameErrorId : undefined}
                  aria-invalid={errors.username ? 'true' : 'false'}
                  aria-required='true'
                  {...register('username', {
                    required: 'Enter your username to continue.',
                  })}
                />
              </div>
              {errors.username && (
                <p className='mt-1 text-sm text-error' id={usernameErrorId} role='alert'>
                  {errors.username.message}
                </p>
              )}
            </div>
            <div className='space-y-2'>
              <label
                htmlFor={passwordId}
                className='block text-sm font-medium text-primary'
              >
                Password
              </label>
              <div className='relative'>
                <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                  <Lock size={18} className='text-tertiary' aria-hidden='true' />
                </div>
                <input
                  id={passwordId}
                  type='password'
                  className={`block w-full pl-10 pr-3 py-2 border bg-surface-container text-primary placeholder:text-tertiary rounded-nested transition-colors cursor-text ${
                    errors.password ? 'border-error' : 'border-default'
                  } hover:border-default-inverted focus-visible:outline-none`}
                  placeholder='Enter password'
                  aria-describedby={errors.password ? passwordErrorId : undefined}
                  aria-invalid={errors.password ? 'true' : 'false'}
                  aria-required='true'
                  {...register('password', {
                    required: 'Enter your password to continue.',
                  })}
                />
              </div>
              {errors.password && (
                <p className='mt-1 text-sm text-error' id={passwordErrorId} role='alert'>
                  {errors.password.message}
                </p>
              )}
            </div>
            <div>
              <button
                type='submit'
                aria-disabled={authenticateMutation.isPending}
                aria-describedby={authenticateMutation.error ? formErrorId : undefined}
                className='w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-small text-sm font-semibold text-primary-inverted bg-action-primary hover:bg-action-primary-hover transition-colors cursor-pointer aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'
              >
                {authenticateMutation.isPending && (
                  <>
                    <span
                      className='w-5 h-5 border-2 border-primary-inverted border-t-transparent rounded-full animate-spin mr-2'
                      aria-hidden='true'
                    />
                    <span className='sr-only'>Authenticating...</span>
                  </>
                )}
                Access API Documentation
                {!authenticateMutation.isPending && <ChevronRight size={16} className='ml-1' aria-hidden='true' />}
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  )
}
