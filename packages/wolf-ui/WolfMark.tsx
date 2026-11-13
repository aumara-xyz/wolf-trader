import { useId } from 'react'
import './WolfMark.css'

/** An original, faceted wolf. The quiet motion is decorative, never a trading status. */
export function WolfMark() {
  const id = useId().replace(/:/g, '')
  return <span className="wolf-header-mark">
    <svg className="wolf-mark" viewBox="0 0 96 96" role="img" aria-label="Wolf Trader wolf" focusable="false">
      <defs>
        <linearGradient id={`${id}-gold`} x1="20" y1="15" x2="75" y2="84" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f2d49a" /><stop offset=".53" stopColor="#d5a75d" /><stop offset="1" stopColor="#9c7342" />
        </linearGradient>
        <linearGradient id={`${id}-shadow`} x1="30" y1="25" x2="65" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4c4358" /><stop offset="1" stopColor="#242632" />
        </linearGradient>
      </defs>
      <circle className="wolf-mark__halo" cx="48" cy="46" r="39" fill="none" stroke="currentColor" strokeWidth=".6" strokeDasharray="1 8" />
      <g className="wolf-mark__head" strokeLinejoin="round">
        <g className="wolf-mark__ear wolf-mark__ear--left">
          <path d="M19 43 15 8 38 25 35 42Z" fill={`url(#${id}-gold)`} />
          <path d="m21 18 2 22 10-13Z" fill="#383342" />
          <path d="m21 18 12 9-9 7Z" fill="#9d7f63" />
        </g>
        <g className="wolf-mark__ear wolf-mark__ear--right">
          <path d="m58 25 23-17-4 35-16-1Z" fill={`url(#${id}-gold)`} />
          <path d="m75 18-12 9 10 13Z" fill="#383342" />
          <path d="m75 18-12 9 9 7Z" fill="#9d7f63" />
        </g>
        <path d="m48 20 22 10 10 24-17 19-15 15-15-15-17-19 10-24Z" fill={`url(#${id}-gold)`} />
        <path d="m48 20-8 25 8 12 8-12Z" fill="#efd29b" />
        <path d="m26 30 14 15-17 9-7 0Z" fill="#bd925b" />
        <path d="m70 30-14 15 17 9 7 0Z" fill="#aa8052" />
        <path d="m26 30 14 15-7 12-10-3Z" fill={`url(#${id}-shadow)`} />
        <path d="m70 30-14 15 7 12 10-3Z" fill={`url(#${id}-shadow)`} />
        <path d="m16 54 17 3 15 25-15-9Z" fill="#846c59" />
        <path d="m80 54-17 3-15 25 15-9Z" fill="#68595a" />
        <path d="m40 45 8 12-10 14-5-14Z" fill="#e7c18a" />
        <path d="m56 45-8 12 10 14 5-14Z" fill="#cfa36d" />
        <path d="m48 57-10 14 10 17 10-17Z" fill="#e9d5b1" />
        <path d="m48 57 10 14-10 17Z" fill="#bca789" />
        <path d="m40 68 8-3 8 3-8 8Z" fill="#242632" />
        <path d="M48 76v6" fill="none" stroke="#625251" strokeWidth="1.2" />
        <g className="wolf-mark__eyes" fill="#b9e8d8">
          <path d="m27 46 10 3-6 3Z" /><path d="m69 46-10 3 6 3Z" />
        </g>
        <path d="m43 29 5-9 5 9" fill="none" stroke="#fff0cf" strokeOpacity=".55" strokeWidth=".8" />
      </g>
    </svg>
  </span>
}
