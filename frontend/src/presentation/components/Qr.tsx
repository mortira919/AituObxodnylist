import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function verifyUrl(number: string) {
  return `${window.location.origin}/verify/${number}`
}

export function Qr({ text, size = 120, className = '' }: { text: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b1b33', light: '#0000' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''))
    return () => {
      live = false
    }
  }, [text])
  // SVG собирает библиотека из нашей же строки, пользовательского HTML здесь нет.
  return <div className={`qr ${className}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
