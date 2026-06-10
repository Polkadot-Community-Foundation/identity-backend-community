interface SkeletonBarProps {
  className?: string
  width?: string
  height?: string
  rounded?: string
  delay?: string
}

export function SkeletonBar({
  className = '',
  width = 'w-full',
  height = 'h-4',
  rounded = 'rounded-md',
  delay = '0s',
}: SkeletonBarProps) {
  return (
    <div
      className={`relative overflow-hidden bg-white/5 ${width} ${height} ${rounded} ${className}`}
      aria-hidden='true'
      role='presentation'
    >
      <div
        className='absolute inset-0 -translate-x-full animate-shimmer'
        style={{
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.02) 20%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.02) 80%, transparent 100%)',
          animationDelay: delay,
        }}
      />
    </div>
  )
}
