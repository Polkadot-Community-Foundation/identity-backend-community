import { ApiReferenceReact } from '@scalar/api-reference-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import '@scalar/api-reference-react/style.css'

export const Docs: React.FC = () => {
  const navigate = useNavigate()
  const [specUrl, setSpecUrl] = useState<string | null>(null)

  useEffect(() => {
    const storedSpecUrl = sessionStorage.getItem('api_spec_url')
    if (!storedSpecUrl) {
      void navigate('/')
    } else {
      setSpecUrl(storedSpecUrl)
    }
  }, [navigate])

  const content = useMemo(() => {
    if (!specUrl) {
      return (
        <div
          className='flex items-center justify-center min-h-screen'
          role='status'
          aria-label='Loading API documentation'
        >
          <div
            className='w-8 h-8 border-4 border-action-primary border-t-transparent rounded-full animate-spin'
            aria-hidden='true'
          />
        </div>
      )
    }

    return (
      <>
        <title>Polkadot App - API Reference</title>
        <meta name='description' content='Interactive API documentation for the Polkadot App' />
        <meta property='og:title' content='Polkadot App - API Reference' />
        <meta property='og:description' content='Interactive API documentation for the Polkadot App' />
        <meta property='og:type' content='website' />
        <meta name='twitter:card' content='summary_large_image' />
        <meta name='twitter:title' content='Polkadot App - API Reference' />
        <meta name='twitter:description' content='Interactive API documentation for the Polkadot App' />
        <ApiReferenceReact
          configuration={{
            url: specUrl,
          }}
        />
      </>
    )
  }, [specUrl])

  return content
}

export default Docs
