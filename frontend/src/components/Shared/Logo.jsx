import logoLight from '../../assets/Attestr_light.svg'
import logoDark from '../../assets/Attestr_dark.svg'

// Brand wordmark. Two stacked <img>s swap with dark mode (Tailwind `dark:`
// can't switch an <img> src, so we toggle visibility instead).
//   Attestr_light.svg → light mode (dark text)
//   Attestr_dark.svg  → dark mode (light text)
// SVG = vector, so it stays perfectly crisp at any size.
export default function Logo({ className = 'h-7' }) {
  return (
    <span className="inline-flex items-center select-none">
      <img src={logoLight} alt="Attestr" className={`${className} w-auto block dark:hidden`} />
      <img src={logoDark}  alt="Attestr" className={`${className} w-auto hidden dark:block`} />
    </span>
  )
}

// Icon-only mark for compact spots (collapsed sidebar).
export function LogoMark({ size = 28 }) {
  return <img src="/Attestr_fav.svg" alt="Attestr" width={size} height={size} className="object-contain select-none" />
}
