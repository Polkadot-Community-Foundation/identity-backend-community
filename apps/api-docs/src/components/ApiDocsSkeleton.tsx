import { useId, useState } from 'react'
import { SkeletonBar } from './SkeletonBar'

export function ApiDocsSkeleton() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const headingId = useId()
  const searchId = useId()
  const navLabelId = useId()

  return (
    <div
      className='dark min-h-screen flex font-sans antialiased overflow-hidden relative bg-surface-main text-primary'
      style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {sidebarOpen && (
        <div
          className='fixed inset-0 bg-black/50 z-30 lg:hidden'
          onClick={() => setSidebarOpen(false)}
          aria-hidden='true'
        />
      )}

      <div className='lg:hidden fixed top-0 left-0 right-0 z-20 flex items-center border-b px-3 h-14 bg-surface-main border-border-default'>
        <button
          type='button'
          className='flex items-center justify-center size-8 rounded-lg p-2 mr-2 shrink-0 text-secondary'
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-expanded={sidebarOpen}
          aria-label='Toggle navigation sidebar'
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 256 256'
            fill='currentColor'
            className='size-full'
            aria-hidden='true'
          >
            <path d='M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z' />
          </svg>
          <span className='sr-only'>Open Menu</span>
        </button>
        <span className='flex-1 text-sm font-medium truncate text-primary'>
          <SkeletonBar width='w-32' height='h-4' />
        </span>
      </div>

      <aside
        aria-label='API navigation'
        className={`
          flex-col h-screen shrink-0 border-r overflow-hidden bg-surface-main border-border-default
          fixed lg:sticky top-0 left-0 z-40 w-[260px] transition-transform duration-300
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:flex'}
        `}
      >
        <div className='flex gap-1.5 px-3 pt-3 shrink-0'>
          <div
            className='flex items-center rounded border gap-1 pl-2 pr-1 h-8 w-full bg-surface-container border-border-default text-tertiary'
            role='search'
            aria-labelledby={searchId}
          >
            <span id={searchId} className='sr-only'>Search API documentation</span>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              viewBox='0 0 256 256'
              fill='currentColor'
              className='size-4 shrink-0'
              aria-hidden='true'
            >
              <path d='M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z' />
            </svg>
            <span className='flex-1 text-left text-sm text-tertiary'>
              Search
            </span>
            <span className='uppercase text-xs font-medium border rounded py-1 px-1.25 text-secondary border-border-default'>
              <span aria-hidden='true'>⌃</span> k
            </span>
          </div>
        </div>

        <nav aria-labelledby={navLabelId} className='flex flex-col p-3 gap-px overflow-y-auto flex-1 custom-scroll'>
          <span id={navLabelId} className='sr-only'>API endpoints navigation</span>

          <ul className='flex flex-col gap-px' role='list'>
            <li className='flex flex-col relative' role='listitem'>
              <div className='flex items-stretch rounded p-2 text-sm text-secondary'>
                <SkeletonBar width='w-3/4' height='h-4' rounded='rounded-sm' />
              </div>
            </li>

            <li className='flex flex-col gap-px relative' role='listitem'>
              <div className='flex items-stretch rounded p-2 text-sm cursor-pointer text-secondary'>
                <div className='flex items-center justify-center mr-2 shrink-0'>
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    viewBox='0 0 256 256'
                    fill='currentColor'
                    className='size-3 transition-transform rotate-90'
                    aria-hidden='true'
                  >
                    <path d='M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z' />
                  </svg>
                </div>
                <span className='flex-1 text-left'>
                  <SkeletonBar width='w-8' height='h-4' />
                </span>
              </div>
              <ul className='flex flex-col gap-px' role='list'>
                {Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className='flex flex-col relative' role='listitem'>
                    <div className='flex items-stretch rounded p-2 text-sm text-secondary'>
                      <div className='flex justify-center mr-2 shrink-0 w-4'>
                        <div className='absolute left-2 inset-y-0 w-px bg-border-default' />
                      </div>
                      <span className='flex-1 min-w-0 truncate'>
                        <SkeletonBar width='w-3/4' height='h-4' />
                      </span>
                      <SkeletonBar width='w-8' height='h-4' rounded='rounded-sm' />
                    </div>
                  </li>
                ))}
              </ul>
            </li>

            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className='flex flex-col gap-px relative' role='listitem'>
                <div className='flex items-stretch rounded p-2 text-sm cursor-pointer text-secondary'>
                  <div className='flex items-center justify-center mr-2 shrink-0'>
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      viewBox='0 0 256 256'
                      fill='currentColor'
                      className='size-3'
                      aria-hidden='true'
                    >
                      <path d='M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z' />
                    </svg>
                  </div>
                  <span className='flex-1 text-left'>
                    <SkeletonBar width='w-20' height='h-4' />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </nav>

        <div className='flex flex-col gap-3 px-3 pb-3 shrink-0 border-t border-border-default'>
          <div className='flex items-center pt-2'>
            <div className='flex-1 min-w-0 flex items-center text-xs text-secondary'>
              <SkeletonBar width='w-24' height='h-3' />
            </div>
            <div className='flex items-center'>
              <SkeletonBar width='w-10' height='h-5' rounded='rounded-full' />
            </div>
          </div>
        </div>
      </aside>

      <main className='flex-1 overflow-y-auto min-h-screen pt-14 lg:pt-0 bg-surface-main'>
        <div className='references-rendered'>
          <div className='narrow-references-container'>
            <div className='section-container'>
              <section className='section introduction-section z-1 gap-12' style={{ padding: '3rem 0' }}>
                <div className='section-content px-4 sm:px-6 lg:px-12 max-w-5xl mx-auto'>
                  <div className='flex gap-1.5 mb-4'>
                    <SkeletonBar width='w-16' height='h-6' rounded='rounded-md' />
                    <SkeletonBar width='w-20' height='h-6' rounded='rounded-md' />
                  </div>

                  <div className='section-header-wrapper mb-8'>
                    <h1 id={headingId} className='text-2xl sm:text-3xl font-semibold mb-4 text-primary'>
                      <SkeletonBar width='w-48' height='h-8' />
                    </h1>
                    <div className='flex flex-col sm:flex-row gap-2 mb-6'>
                      <SkeletonBar width='w-full sm:w-48' height='h-8' rounded='rounded-lg' />
                      <SkeletonBar width='w-full sm:w-48' height='h-8' rounded='rounded-lg' />
                    </div>
                  </div>

                  <div className='grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12'>
                    <div className='space-y-6'>
                      <div className='space-y-3'>
                        <SkeletonBar width='w-full' height='h-5' />
                        <SkeletonBar width='w-[90%]' height='h-5' />
                        <SkeletonBar width='w-[70%]' height='h-5' />
                      </div>
                    </div>

                    <div className='space-y-4'>
                      <div className='rounded-xl border overflow-hidden bg-surface-container border-border-default'>
                        <div className='flex items-center px-3 py-2 text-sm font-medium border-b bg-surface-container border-border-default text-primary'>
                          <SkeletonBar width='w-16' height='h-5' />
                        </div>
                        <div className='p-3'>
                          <SkeletonBar width='w-full' height='h-8' rounded='rounded-md' />
                        </div>
                      </div>

                      <div className='rounded-xl border overflow-hidden bg-surface-container border-border-default'>
                        <div className='flex items-center px-3 py-2 text-sm font-medium border-b bg-surface-container border-border-default text-primary'>
                          <SkeletonBar width='w-28' height='h-5' />
                        </div>
                        <div className='p-4 text-sm text-center text-tertiary'>
                          <SkeletonBar width='w-40' height='h-4' />
                        </div>
                      </div>

                      <div className='rounded-xl border overflow-hidden bg-surface-container border-border-default'>
                        <div className='flex items-center px-3 py-2 text-sm font-medium border-b bg-surface-container border-border-default text-primary'>
                          <SkeletonBar width='w-24' height='h-5' />
                        </div>
                        <div className='flex flex-wrap gap-2 p-3'>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <SkeletonBar key={i} width='w-16' height='h-8' rounded='rounded-md' />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className='section-container tag-section-container'>
              <section className='section' style={{ padding: '2rem 0' }}>
                <div className='px-4 sm:px-6 lg:px-12 max-w-5xl mx-auto'>
                  <div className='section-header-wrapper mb-6'>
                    <h2 className='text-xl sm:text-2xl font-semibold text-primary'>
                      <SkeletonBar width='w-16' height='h-7' />
                    </h2>
                  </div>

                  <div className='grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12'>
                    <div />
                    <div>
                      <div className='rounded-xl border overflow-hidden bg-surface-container border-border-default'>
                        <div className='flex items-center px-3 py-2 text-sm font-medium border-b bg-surface-container border-border-default text-primary'>
                          <SkeletonBar width='w-20' height='h-5' />
                        </div>
                        <div className='p-2 space-y-1 max-h-[60vh] overflow-y-auto custom-scroll'>
                          {Array.from({ length: 10 }).map((_, i) => (
                            <div
                              key={i}
                              className='flex items-center gap-2 px-2 py-1.5 rounded text-sm text-secondary'
                            >
                              <SkeletonBar width='w-8' height='h-4' rounded='rounded-sm' />
                              <SkeletonBar width='w-48' height='h-3' />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {Array.from({ length: 3 }).map((_, sectionIndex) => (
              <div key={sectionIndex} className='section-container'>
                <section className='section' style={{ padding: '2rem 0' }}>
                  <div className='px-4 sm:px-6 lg:px-12 max-w-5xl mx-auto'>
                    <div className='section-header-wrapper mb-6'>
                      <h3 className='text-lg sm:text-xl font-semibold text-primary'>
                        <SkeletonBar width='w-48' height='h-6' />
                      </h3>
                    </div>

                    <div className='grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12'>
                      <div className='space-y-6'>
                        <div className='space-y-3'>
                          <SkeletonBar width='w-full' height='h-5' />
                          <SkeletonBar width='w-[90%]' height='h-5' />
                        </div>

                        <div>
                          <div className='text-base font-medium mb-3 text-primary'>
                            <SkeletonBar width='w-32' height='h-5' />
                          </div>
                          <div className='space-y-2'>
                            <div className='rounded-lg border p-3 bg-surface-container border-border-default'>
                              <div className='flex items-center gap-2 mb-2 flex-wrap'>
                                <SkeletonBar width='w-20' height='h-4' />
                                <SkeletonBar width='w-16' height='h-4' rounded='rounded-full' />
                                <SkeletonBar width='w-12' height='h-4' rounded='rounded-full' />
                              </div>
                              <SkeletonBar width='w-3/4' height='h-3' />
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className='flex items-center justify-between mb-3'>
                            <div className='text-base font-medium text-primary'>
                              <SkeletonBar width='w-16' height='h-5' />
                            </div>
                            <SkeletonBar width='w-24' height='h-5' rounded='rounded-full' />
                          </div>
                          <div className='rounded-lg border overflow-hidden bg-surface-container border-border-default'>
                            <div className='p-3 space-y-2'>
                              {Array.from({ length: 2 }).map((_, j) => (
                                <div key={j} className='flex items-start gap-2 flex-wrap'>
                                  <SkeletonBar width='w-24' height='h-4' />
                                  <SkeletonBar width='w-20' height='h-4' rounded='rounded-sm' />
                                  <SkeletonBar width='w-16' height='h-4' rounded='rounded-sm' />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className='text-base font-medium mb-3 text-primary'>
                            <SkeletonBar width='w-24' height='h-5' />
                          </div>
                          <div className='space-y-2'>
                            {Array.from({ length: 4 }).map((_, codeIndex) => (
                              <div
                                key={codeIndex}
                                className='flex items-center gap-3 p-2 rounded cursor-pointer flex-wrap text-secondary'
                              >
                                <div className='flex items-center gap-2 shrink-0'>
                                  <svg
                                    xmlns='http://www.w3.org/2000/svg'
                                    viewBox='0 0 256 256'
                                    fill='currentColor'
                                    className='size-3 shrink-0'
                                    aria-hidden='true'
                                  >
                                    <path d='M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z' />
                                  </svg>
                                  <SkeletonBar width='w-6' height='h-4' />
                                </div>
                                <SkeletonBar width='w-32 sm:w-48' height='h-3' />
                                <div className='ml-auto sm:ml-auto'>
                                  <SkeletonBar width='w-20 sm:w-24' height='h-5' rounded='rounded-full' />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className='space-y-4'>
                        <div className='rounded-xl border overflow-hidden flex flex-col bg-surface-container border-border-default'>
                          <div className='flex items-center justify-between px-3 py-2 border-b shrink-0 flex-wrap gap-2 border-border-default'>
                            <div className='flex items-center gap-2 min-w-0'>
                              <SkeletonBar width='w-12' height='h-5' rounded='rounded-sm' />
                              <SkeletonBar width='w-40' height='h-4' />
                            </div>
                            <SkeletonBar width='w-20' height='h-6' rounded='rounded-md' />
                          </div>
                          <div className='p-0 overflow-auto'>
                            <div
                              className='p-3 font-mono text-xs overflow-x-auto bg-surface-main text-secondary'
                              style={{ minHeight: '200px' }}
                            >
                              <div className='space-y-1'>
                                <SkeletonBar width='w-full' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[90%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[80%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[85%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[70%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[60%]' height='h-3' className='bg-white/5' />
                              </div>
                            </div>
                          </div>
                          <div className='flex items-center px-3 py-2 border-t border-border-default bg-surface-nested'>
                            <SkeletonBar width='w-24' height='h-8' rounded='rounded-md' />
                          </div>
                        </div>

                        <div className='rounded-xl border overflow-hidden flex flex-col bg-surface-container border-border-default'>
                          <div className='flex items-center justify-between px-3 py-2 border-b shrink-0 flex-wrap gap-2 border-border-default'>
                            <div className='flex gap-1 flex-wrap'>
                              {Array.from({ length: 4 }).map((_, idx) => (
                                <SkeletonBar key={idx} width='w-8' height='h-6' rounded='rounded-md' />
                              ))}
                            </div>
                            <label className='flex items-center gap-1.5 text-xs cursor-pointer text-secondary'>
                              <input type='checkbox' className='sr-only' />
                              <span className='w-3.5 h-3.5 rounded border flex items-center justify-center border-border-default'>
                                <svg
                                  className='size-3 opacity-0'
                                  viewBox='0 0 24 24'
                                  fill='none'
                                  stroke='currentColor'
                                  strokeWidth='2'
                                  aria-hidden='true'
                                >
                                  <polyline points='20 6 9 17 4 12' />
                                </svg>
                              </span>
                              <SkeletonBar width='w-20' height='h-4' />
                            </label>
                          </div>
                          <div className='p-0 overflow-auto'>
                            <div
                              className='p-3 font-mono text-xs overflow-x-auto bg-surface-main text-secondary'
                              style={{ minHeight: '120px' }}
                            >
                              <div className='space-y-1'>
                                <SkeletonBar width='w-full' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[90%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[85%]' height='h-3' className='bg-white/5' />
                                <SkeletonBar width='w-[70%]' height='h-3' className='bg-white/5' />
                              </div>
                            </div>
                          </div>
                          <div className='px-3 py-2 border-t text-sm border-border-default text-secondary'>
                            <SkeletonBar width='w-3/4' height='h-4' />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
